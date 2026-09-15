<#
.SYNOPSIS
  Sets up a secured bridge between a local Ollama install (on this PC) and the
  Fogbound app hosted on Railway, then validates the whole chain end to end.

.DESCRIPTION
  Fogbound stays hosted on Railway (single save/database source of truth --
  running it locally too would fork your saves into a second, unsynced
  database). Only the text-generation call needs to reach this PC's GPU.

  Ollama itself has NO built-in authentication -- exposing its port directly
  to the internet lets anyone who finds the URL use your GPU for free. So
  this script puts a small authenticated reverse proxy (Caddy) in front of
  it, and a Cloudflare Tunnel (no account/domain needed) in front of that,
  instead of exposing port 11434 directly:

      Phone -> Fogbound (Railway) -> Cloudflare Tunnel -> Caddy (checks a
      secret token) -> Ollama (127.0.0.1:11434)

  What it does, in order:
    1. Installs Ollama via winget if missing, makes sure its server is
       actually running, and pulls a default model if you don't have one yet.
    2. Downloads portable Caddy + cloudflared binaries into a local bin/
       folder (no winget PATH guesswork -- see notes below).
    3. Generates (once) or reuses a secret bearer token, writes a Caddyfile
       that only forwards requests carrying that token, and starts Caddy.
    4. Starts a Cloudflare "quick tunnel" pointing at Caddy and extracts the
       public https://xxxx.trycloudflare.com URL it gets assigned.
    5. Validates the FULL path from the public internet: confirms a request
       without the token is rejected (401) and a request with it reaches
       Ollama and gets a real completion back.
    6. Pushes the new tunnel URL + secret to Fogbound's own Settings via its
       API (POST /api/settings), then reads them back to confirm.
    7. Keeps running in the foreground (Caddy + the tunnel must stay alive
       for this to keep working) until you press Ctrl+C, then cleans up.

  Run it again any time you want to start a session -- the tunnel URL
  rotates every run (quick tunnels don't have a fixed hostname), so the
  script re-pushes the new URL to Fogbound automatically each time. The
  secret token is generated once and reused across runs, saved in
  config.json next to this script, so you never have to retype it in
  Fogbound's Settings after the first successful run.

.NOTES
  - Run from a normal PowerShell window: if execution policy blocks the
    script, run instead:
      powershell -ExecutionPolicy Bypass -File .\setup-ollama-bridge.ps1
  - If the Ollama install step fails, re-run this script from an
    Administrator PowerShell window and try again.
  - This script has not been run on a real Windows machine by the assistant
    that wrote it (no such access exists in that environment) -- it was
    built from verified package IDs and documented behavior, but please
    report back anything that errors so it can be fixed.

.PARAMETER FogboundUrl
  Base URL of your Fogbound deployment. Defaults to the Railway production URL.

.PARAMETER Model
  Ollama model to ensure is pulled and to use for the validation test.
  Defaults to qwen3:14b (the recommended sweet-spot model for a 16GB-VRAM
  card like the RTX 5080 -- see TODO.md/CHANGELOG.md for the reasoning).

.PARAMETER SkipFogboundUpdate
  If set, does everything except push settings to Fogbound automatically --
  use this if you'd rather copy the URL into Settings by hand.
#>

[CmdletBinding()]
param(
  [string]$FogboundUrl = "https://fogbound-production.up.railway.app",
  [string]$Model = "qwen3:14b",
  [switch]$SkipFogboundUpdate
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Setup / paths
# ---------------------------------------------------------------------------

$WorkDir      = Join-Path $env:USERPROFILE "FogboundOllamaBridge"
$BinDir       = Join-Path $WorkDir "bin"
$CaddyExe     = Join-Path $BinDir "caddy.exe"
$CloudflaredExe = Join-Path $BinDir "cloudflared.exe"
$ConfigPath   = Join-Path $WorkDir "config.json"
$CaddyfilePath = Join-Path $WorkDir "Caddyfile"
$TunnelLogPath = Join-Path $WorkDir "cloudflared.log"
$ProxyPort    = 8787
$OllamaPort   = 11434

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir  | Out-Null

$script:ChildProcesses = @()

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Write-Ok($msg) {
  Write-Host "    OK: $msg" -ForegroundColor Green
}

function Write-Fail($msg) {
  Write-Host "    ECHEC: $msg" -ForegroundColor Red
}

function Stop-Bridge {
  foreach ($p in $script:ChildProcesses) {
    try {
      if ($p -and -not $p.HasExited) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
}

# Make sure a previous, uncleanly-stopped run doesn't leave stale processes
# holding the ports this run needs.
function Stop-StaleBridge {
  if (Test-Path $ConfigPath) {
    try {
      $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
      foreach ($pidField in @('caddyPid', 'cloudflaredPid')) {
        $procId = $cfg.$pidField
        if ($procId) {
          $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
          if ($proc) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
        }
      }
    } catch {}
  }
}

function Get-BridgeConfig {
  if (Test-Path $ConfigPath) {
    return Get-Content $ConfigPath -Raw | ConvertFrom-Json
  }
  return [pscustomobject]@{ secret = $null; caddyPid = $null; cloudflaredPid = $null }
}

function Save-BridgeConfig($cfg) {
  $cfg | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8
}

# ---------------------------------------------------------------------------
# 1. Ollama: install, start, pull model
# ---------------------------------------------------------------------------

Write-Step "Verification d'Ollama"

$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollamaCmd) {
  Write-Host "    Ollama n'est pas installe -- installation via winget..."
  try {
    winget install --id Ollama.Ollama -e --silent --accept-package-agreements --accept-source-agreements
  } catch {
    Write-Fail "L'installation via winget a echoue. Relancez ce script depuis un PowerShell en mode Administrateur, ou installez Ollama manuellement depuis https://ollama.com puis relancez ce script."
    exit 1
  }
  # winget-installed apps sometimes need a fresh PATH to be visible in this
  # session -- add the common install location as a fallback.
  $env:PATH += ";$env:LOCALAPPDATA\Programs\Ollama"
  $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
  if (-not $ollamaCmd) {
    Write-Fail "Ollama a ete installe mais la commande 'ollama' n'est pas trouvee dans cette session. Fermez et rouvrez PowerShell, puis relancez ce script."
    exit 1
  }
}
Write-Ok "Ollama est installe."

function Test-OllamaRunning {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$OllamaPort" -TimeoutSec 3 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-OllamaRunning)) {
  Write-Host "    Le serveur Ollama ne repond pas encore -- demarrage..."
  Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
  $tries = 0
  while (-not (Test-OllamaRunning) -and $tries -lt 15) {
    Start-Sleep -Seconds 1
    $tries++
  }
}

if (-not (Test-OllamaRunning)) {
  Write-Fail "Impossible de joindre Ollama sur 127.0.0.1:$OllamaPort apres plusieurs tentatives."
  exit 1
}
Write-Ok "Le serveur Ollama repond sur le port $OllamaPort."

Write-Step "Verification du modele '$Model'"
$haveModel = $false
try {
  $listOutput = & ollama list 2>$null
  if ($listOutput -match [regex]::Escape($Model)) { $haveModel = $true }
} catch {}

if (-not $haveModel) {
  Write-Host "    Telechargement de '$Model' (peut prendre plusieurs minutes selon votre connexion)..."
  & ollama pull $Model
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "Le telechargement du modele a echoue. Verifiez le nom du modele (ollama pull $Model) et votre connexion internet."
    exit 1
  }
}
Write-Ok "Modele '$Model' disponible."

# ---------------------------------------------------------------------------
# 2. Caddy + cloudflared: portable binaries, no winget/PATH guessing
# ---------------------------------------------------------------------------

Write-Step "Verification de Caddy (proxy avec authentification)"

if (-not (Test-Path $CaddyExe)) {
  Write-Host "    Telechargement de Caddy..."
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/caddyserver/caddy/releases/latest"
  $asset = $release.assets | Where-Object { $_.name -match "windows_amd64\.zip$" } | Select-Object -First 1
  if (-not $asset) {
    Write-Fail "Impossible de trouver l'archive Windows de Caddy sur GitHub. Telechargez-la manuellement depuis https://github.com/caddyserver/caddy/releases/latest et placez caddy.exe dans $BinDir"
    exit 1
  }
  $zipPath = Join-Path $BinDir "caddy.zip"
  Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $BinDir -Force
  Remove-Item $zipPath -Force
  if (-not (Test-Path $CaddyExe)) {
    Write-Fail "L'archive Caddy ne contenait pas caddy.exe a l'emplacement attendu. Verifiez $BinDir manuellement."
    exit 1
  }
}
Write-Ok "Caddy pret ($CaddyExe)."

Write-Step "Verification de cloudflared (tunnel public)"

if (-not (Test-Path $CloudflaredExe)) {
  Write-Host "    Telechargement de cloudflared..."
  Invoke-WebRequest -UseBasicParsing `
    -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
    -OutFile $CloudflaredExe
}
Write-Ok "cloudflared pret ($CloudflaredExe)."

# ---------------------------------------------------------------------------
# 3. Secret token + Caddyfile
# ---------------------------------------------------------------------------

Write-Step "Configuration du jeton secret et du proxy"

Stop-StaleBridge

$cfg = Get-BridgeConfig
if (-not $cfg.secret) {
  $cfg.secret = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
  Save-BridgeConfig $cfg
  Write-Host "    Nouveau jeton secret genere (reutilise automatiquement la prochaine fois)."
} else {
  Write-Host "    Jeton secret existant reutilise."
}
$Secret = $cfg.secret

$caddyfileContent = @"
:$ProxyPort {
	@authorized header Authorization "Bearer $Secret"
	reverse_proxy @authorized 127.0.0.1:$OllamaPort

	respond "Unauthorized" 401
}
"@
Set-Content -Path $CaddyfilePath -Value $caddyfileContent -Encoding UTF8

& $CaddyExe validate --config $CaddyfilePath --adapter caddyfile
if ($LASTEXITCODE -ne 0) {
  Write-Fail "Le Caddyfile genere n'est pas valide (voir la sortie ci-dessus)."
  exit 1
}
Write-Ok "Caddyfile valide."

$caddyProcess = Start-Process -FilePath $CaddyExe -ArgumentList "run", "--config", $CaddyfilePath, "--adapter", "caddyfile" -WindowStyle Hidden -PassThru
$script:ChildProcesses += $caddyProcess
$cfg.caddyPid = $caddyProcess.Id
Save-BridgeConfig $cfg
Start-Sleep -Seconds 2

function Get-HttpStatus($uri, $headers) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $uri -Headers $headers -Method Post `
      -ContentType "application/json" `
      -Body '{"model":"__probe__","messages":[{"role":"user","content":"ping"}]}' `
      -TimeoutSec 15
    return [int]$resp.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return -1
  }
}

Write-Step "Verification locale du proxy (avant d'ouvrir le tunnel)"

$statusNoAuth = Get-HttpStatus "http://127.0.0.1:$ProxyPort/v1/chat/completions" @{}
if ($statusNoAuth -eq 401) {
  Write-Ok "Sans jeton : correctement rejete (401)."
} else {
  Write-Fail "Sans jeton, le proxy a repondu $statusNoAuth au lieu de 401 -- verifiez le Caddyfile."
  Stop-Bridge
  exit 1
}

# ---------------------------------------------------------------------------
# 4. Cloudflare quick tunnel
# ---------------------------------------------------------------------------

Write-Step "Ouverture du tunnel Cloudflare"

if (Test-Path $TunnelLogPath) { Remove-Item $TunnelLogPath -Force }

$cloudflaredProcess = Start-Process -FilePath $CloudflaredExe `
  -ArgumentList "tunnel", "--url", "http://127.0.0.1:$ProxyPort" `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardError $TunnelLogPath -RedirectStandardOutput $TunnelLogPath
$script:ChildProcesses += $cloudflaredProcess
$cfg.cloudflaredPid = $cloudflaredProcess.Id
Save-BridgeConfig $cfg

$TunnelUrl = $null
$tries = 0
while (-not $TunnelUrl -and $tries -lt 30) {
  Start-Sleep -Seconds 1
  if (Test-Path $TunnelLogPath) {
    $logContent = Get-Content $TunnelLogPath -Raw -ErrorAction SilentlyContinue
    if ($logContent -match "https://[a-zA-Z0-9-]+\.trycloudflare\.com") {
      $TunnelUrl = $Matches[0]
    }
  }
  $tries++
}

if (-not $TunnelUrl) {
  Write-Fail "Impossible de recuperer l'URL du tunnel apres 30s. Regardez $TunnelLogPath pour le detail."
  Stop-Bridge
  exit 1
}
Write-Ok "Tunnel public : $TunnelUrl"
Write-Host "    (l'annonce Cloudflare indique parfois un court delai avant que ce soit joignable partout)"

# ---------------------------------------------------------------------------
# 5. End-to-end validation through the PUBLIC tunnel
# ---------------------------------------------------------------------------

Write-Step "Validation de bout en bout via l'URL publique"

$publicStatusNoAuth = $null
$tries = 0
while ($tries -lt 10) {
  $publicStatusNoAuth = Get-HttpStatus "$TunnelUrl/v1/chat/completions" @{}
  if ($publicStatusNoAuth -eq 401) { break }
  Start-Sleep -Seconds 2
  $tries++
}

if ($publicStatusNoAuth -eq 401) {
  Write-Ok "Sans jeton via le tunnel public : correctement rejete (401)."
} else {
  Write-Fail "Sans jeton via le tunnel public : reponse $publicStatusNoAuth (attendu 401). Le tunnel met peut-etre encore quelques secondes a se propager -- reessayez ce script si ca persiste."
  Stop-Bridge
  exit 1
}

try {
  $body = @{
    model = $Model
    messages = @(@{ role = "user"; content = "Reponds uniquement par le mot OK, rien d'autre." })
  } | ConvertTo-Json -Depth 5

  $resp = Invoke-RestMethod -Method Post -Uri "$TunnelUrl/v1/chat/completions" `
    -Headers @{ Authorization = "Bearer $Secret" } `
    -ContentType "application/json" -Body $body -TimeoutSec 60

  $reply = $resp.choices[0].message.content
  Write-Ok "Avec jeton via le tunnel public : reponse recue d'Ollama -- '$reply'"
} catch {
  Write-Fail "Avec jeton via le tunnel public : la requete a echoue -- $($_.Exception.Message)"
  Stop-Bridge
  exit 1
}

# ---------------------------------------------------------------------------
# 6. Push settings to Fogbound automatically
# ---------------------------------------------------------------------------

if (-not $SkipFogboundUpdate) {
  Write-Step "Mise a jour automatique des reglages Fogbound ($FogboundUrl)"
  try {
    $settingsBody = @{
      ollamaBaseUrl = $TunnelUrl
      apiKeys = @{ ollama = $Secret }
    } | ConvertTo-Json -Depth 5

    Invoke-RestMethod -Method Post -Uri "$FogboundUrl/api/settings" `
      -ContentType "application/json" -Body $settingsBody -TimeoutSec 20 | Out-Null

    $confirm = Invoke-RestMethod -Method Get -Uri "$FogboundUrl/api/settings" -TimeoutSec 20
    if ($confirm.ollamaBaseUrl -eq $TunnelUrl) {
      Write-Ok "Fogbound confirme la nouvelle adresse Ollama."
    } else {
      Write-Fail "Fogbound n'a pas confirme la mise a jour (valeur lue : $($confirm.ollamaBaseUrl)). Verifiez manuellement dans Reglages."
    }
  } catch {
    Write-Fail "Impossible de contacter Fogbound pour mettre a jour les reglages -- $($_.Exception.Message). Vous pouvez le faire manuellement dans Reglages."
  }
} else {
  Write-Step "Mise a jour Fogbound ignoree (-SkipFogboundUpdate)"
  Write-Host "    Adresse a coller dans Reglages -> Adresse du serveur Ollama : $TunnelUrl"
  Write-Host "    Cle a coller dans Reglages -> Cle API Ollama : $Secret"
}

# ---------------------------------------------------------------------------
# Summary + keep running
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Yellow
Write-Host " Pont Ollama <-> Fogbound actif" -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Yellow
Write-Host " URL du tunnel   : $TunnelUrl"
Write-Host " Modele utilise  : $Model"
Write-Host " Fogbound        : $FogboundUrl"
Write-Host ""
Write-Host " Dernière étape (manuelle) : ouvrez Fogbound -> Reglages, mettez"
Write-Host " Fournisseur = 'Ollama (local)' et Modele = '$Model', puis Enregistrer."
Write-Host ""
Write-Host " Laissez cette fenetre ouverte tant que vous jouez avec Ollama."
Write-Host " Appuyez sur Ctrl+C pour tout arreter proprement."
Write-Host "=================================================================" -ForegroundColor Yellow

try {
  while ($true) { Start-Sleep -Seconds 5 }
} finally {
  Write-Host ""
  Write-Host "Arret du proxy et du tunnel..."
  Stop-Bridge
}
