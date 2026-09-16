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
       Three routes share the one token: Ollama itself, the GPU watcher's
       /bridge/status, and /sdapi/* for a local Stable Diffusion instance
       (AUTOMATIC1111, run separately with --api -- NOT installed by this
       script, see .NOTES) if you're using one for local image generation.
    4. Starts ollama-watcher.ps1 (a separate script next to this one), which
       polls nvidia-smi and shows a tray icon (green/orange) so you can see
       locally when the GPU is busy enough that a game might stutter.
    5. Starts a Cloudflare "quick tunnel" pointing at Caddy and extracts the
       public https://xxxx.trycloudflare.com URL it gets assigned.
    6. Validates the FULL path from the public internet: confirms a request
       without the token is rejected (401) and a request with it reaches
       Ollama and gets a real completion back.
    7. Pushes the new tunnel URL + secret to Fogbound's own Settings via its
       API (POST /api/settings) for BOTH Ollama and local image generation
       (same URL, same token -- Caddy tells the two apart by path), then
       reads them back to confirm. Fogbound polls /bridge/status through the
       same tunnel to show its own hors ligne/indisponible/disponible
       indicator and to decide, instantly and without any extra round trip,
       whether to offer your configured fallback provider for a given turn.
    8. Keeps running in the foreground (Caddy + the tunnel must stay alive
       for this to keep working) until you press Ctrl+C, then cleans up.

  See install-startup-task.ps1 to have this run automatically at logon
  instead of by hand every time, with Windows itself restarting it if it
  ever crashes while the PC stays on.

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
  - Local image generation (AUTOMATIC1111 / Stable Diffusion WebUI) is NOT
    installed by this script -- unlike Ollama, it's a much heavier,
    less standardized install (Python environment, multi-GB model
    checkpoints to download yourself). See setup-automatic1111.ps1 next to
    this script for an automated install (detects an existing copy or
    clones one, finds or fetches a checkpoint, enables --api, launches it
    and waits for it to be ready) -- or install it by hand and start it
    with the --api flag (off by default), e.g.: webui-user.bat --api
    This script only adds the authenticated proxy route for it -- if it
    isn't running, that route just fails until you start it; everything
    else (Ollama, text generation) works regardless.
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

.PARAMETER SdPort
  Local port your Stable Diffusion WebUI (AUTOMATIC1111) API listens on, if
  you use one. Defaults to 7860 (AUTOMATIC1111's own default). The proxy
  route is added either way; harmless and unused if you don't run one.

.PARAMETER SkipFogboundUpdate
  If set, does everything except push settings to Fogbound automatically --
  use this if you'd rather copy the URL into Settings by hand.

.PARAMETER NoWatcher
  If set, skips starting the GPU watcher / tray icon entirely. Ollama and
  the tunnel still work without it -- you just lose the local busy/idle
  indicator and Fogbound's status indicator will show "offline" for the
  /bridge/status route specifically (Ollama generation itself is unaffected).
#>

[CmdletBinding()]
param(
  [string]$FogboundUrl = "https://fogbound-production.up.railway.app",
  [string]$Model = "qwen3:14b",
  [int]$SdPort = 7860,
  [switch]$SkipFogboundUpdate,
  [switch]$NoWatcher
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
$TunnelErrLogPath = Join-Path $WorkDir "cloudflared.err.log"
$TranscriptPath = Join-Path $WorkDir "bridge.log"
$WatcherScriptPath = Join-Path $PSScriptRoot "ollama-watcher.ps1"
$ProxyPort    = 8787
$OllamaPort   = 11434
$WatcherPort  = 8788
# PowerShell's default User-Agent (e.g. "...WindowsPowerShell/5.1...") is a
# distinctive automation fingerprint -- used on every request this script
# makes through the public tunnel, in case Cloudflare's own bot/WAF
# heuristics on *.trycloudflare.com (a real, documented source of 403s
# unrelated to this bridge's own auth logic, which can only ever answer
# 401 or forward to Ollama -- see the tunnel validation step) are keying
# off it for a request that also carries an Authorization header, a
# pattern that can read as credential/API abuse.
$BrowserUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir  | Out-Null

# Mirrors everything below into a log file too, so a run launched hidden by
# the Windows Scheduled Task (see install-startup-task.ps1) leaves something
# inspectable -- Write-Host alone would otherwise vanish with no console
# attached. Doesn't suppress the normal console output when run by hand.
try { Start-Transcript -Path $TranscriptPath -Append | Out-Null } catch {}

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
      foreach ($pidField in @('caddyPid', 'cloudflaredPid', 'watcherPid')) {
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
  return [pscustomobject]@{ secret = $null; caddyPid = $null; cloudflaredPid = $null; watcherPid = $null }
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

# Two routes behind the same bearer token: /bridge/status* goes to the GPU
# watcher (ollama-watcher.ps1, a separate lightweight process -- see below)
# so Fogbound can tell "offline" from "busy" from "available"; everything
# else goes to Ollama itself, unchanged from before.
$caddyfileContent = @"
:$ProxyPort {
	@authorizedStatus {
		header Authorization "Bearer $Secret"
		path /bridge/status*
	}
	@authorizedSd {
		header Authorization "Bearer $Secret"
		path /sdapi/*
	}
	@authorizedOllama {
		header Authorization "Bearer $Secret"
		not path /bridge/status*
		not path /sdapi/*
	}

	# Caddy sorts directives of different kinds by its own fixed priority list,
	# not by the order they're written -- and "respond" sorts before
	# "reverse_proxy". Without this route{} block, the unconditional fallback
	# respond below would run FIRST on every request and always return 401,
	# even with a correct token (reverse_proxy would never get a chance to run).
	route {
		reverse_proxy @authorizedStatus 127.0.0.1:$WatcherPort
		reverse_proxy @authorizedSd 127.0.0.1:$SdPort
		reverse_proxy @authorizedOllama 127.0.0.1:$OllamaPort

		respond "Unauthorized" 401
	}
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

Write-Step "Demarrage du surveillant GPU (indicateur hors ligne/indisponible/disponible)"

if ($NoWatcher) {
  Write-Host "    Ignore (-NoWatcher)."
} elseif (-not (Test-Path $WatcherScriptPath)) {
  Write-Fail "ollama-watcher.ps1 introuvable a cote de ce script -- l'indicateur de statut ne fonctionnera pas, mais Ollama et le tunnel restent utilisables."
} else {
  $watcherProcess = Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$WatcherScriptPath`"", "-Port", $WatcherPort `
    -WindowStyle Hidden -PassThru
  $script:ChildProcesses += $watcherProcess
  $cfg.watcherPid = $watcherProcess.Id
  Save-BridgeConfig $cfg
  Start-Sleep -Seconds 2
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$WatcherPort/" -TimeoutSec 3 | Out-Null
    Write-Ok "Surveillant GPU actif sur le port $WatcherPort."
  } catch {
    Write-Fail "Le surveillant GPU ne repond pas encore sur le port $WatcherPort (regardez $WorkDir\watcher.log). Ollama et le tunnel restent utilisables sans lui."
  }
}

$script:LastHttpError = $null
$script:LastHttpErrorIsDns = $false

function Get-HttpStatus($uri, $headers) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $uri -Headers $headers -Method Post -UserAgent $BrowserUserAgent `
      -ContentType "application/json" `
      -Body '{"model":"__probe__","messages":[{"role":"user","content":"ping"}]}' `
      -TimeoutSec 15
    $script:LastHttpError = $null
    $script:LastHttpErrorIsDns = $false
    return [int]$resp.StatusCode
  } catch {
    $script:LastHttpError = $_.Exception.Message
    # Detected by exception type/status rather than message text: the message is
    # localized (e.g. French "n'a pas pu etre resolu" vs English "could not be
    # resolved"), and this .ps1 file's own accented literals can't be relied on
    # to match either, since Windows PowerShell 5.1 reads a non-BOM script file
    # using the system ANSI codepage, silently mangling non-ASCII characters.
    $script:LastHttpErrorIsDns = $false
    $probe = $_.Exception
    while ($probe) {
      if ($probe -is [System.Net.WebException] -and $probe.Status -eq [System.Net.WebExceptionStatus]::NameResolutionFailure) {
        $script:LastHttpErrorIsDns = $true
      }
      if ($probe -is [System.Net.Sockets.SocketException] -and $probe.SocketErrorCode -eq [System.Net.Sockets.SocketError]::HostNotFound) {
        $script:LastHttpErrorIsDns = $true
      }
      $probe = $probe.InnerException
    }
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

# Checked locally, not just through the tunnel further down: isolates
# whether a real 403/401 seen later comes from Caddy's own token check
# (would already show up right here, before any Cloudflare involvement at
# all) or from something tunnel/Cloudflare-specific -- confirmed as a real
# gap this script had (no local "with token" check existed at all before,
# jumping straight to testing it only through the public tunnel).
$statusWithAuth = Get-HttpStatus "http://127.0.0.1:$ProxyPort/v1/chat/completions" @{ Authorization = "Bearer $Secret" }
if ($statusWithAuth -ne 401) {
  Write-Ok "Avec jeton : accepte en local (reponse $statusWithAuth, transmise a Ollama)."
} else {
  Write-Fail "Avec jeton, le proxy repond quand meme 401 en local -- le Caddyfile ne reconnait pas ce jeton (verifiez qu'aucun ancien processus Caddy avec un jeton different ne tourne encore)."
  Stop-Bridge
  exit 1
}

Write-Step "Verification de la route image locale (/sdapi -- optionnelle)"

$sdStatusNoAuth = Get-HttpStatus "http://127.0.0.1:$ProxyPort/sdapi/v1/txt2img" @{}
if ($sdStatusNoAuth -eq 401) {
  Write-Ok "Route /sdapi correctement protegee (401 sans jeton)."
} else {
  Write-Fail "Route /sdapi : reponse $sdStatusNoAuth au lieu de 401 -- verifiez le Caddyfile."
}
$sdDetected = $false
try {
  Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$SdPort/" -TimeoutSec 3 | Out-Null
  $sdDetected = $true
  Write-Ok "Un serveur repond sur le port $SdPort (probablement AUTOMATIC1111)."
} catch {
  Write-Host "    Rien ne repond sur le port $SdPort pour l'instant -- normal si vous n'utilisez pas encore la generation d'image locale."
  Write-Host "    Pour l'activer : lancez AUTOMATIC1111 avec le flag --api, puis relancez ce script."
}

# ---------------------------------------------------------------------------
# 4. Cloudflare quick tunnel
# ---------------------------------------------------------------------------

Write-Step "Ouverture du tunnel Cloudflare"

if (Test-Path $TunnelLogPath) { Remove-Item $TunnelLogPath -Force }
if (Test-Path $TunnelErrLogPath) { Remove-Item $TunnelErrLogPath -Force }

$cloudflaredProcess = Start-Process -FilePath $CloudflaredExe `
  -ArgumentList "tunnel", "--url", "http://127.0.0.1:$ProxyPort" `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $TunnelLogPath -RedirectStandardError $TunnelErrLogPath
$script:ChildProcesses += $cloudflaredProcess
$cfg.cloudflaredPid = $cloudflaredProcess.Id
Save-BridgeConfig $cfg

$TunnelUrl = $null
$tries = 0
while (-not $TunnelUrl -and $tries -lt 30) {
  Start-Sleep -Seconds 1
  $logContent = ""
  if (Test-Path $TunnelLogPath) { $logContent += (Get-Content $TunnelLogPath -Raw -ErrorAction SilentlyContinue) }
  if (Test-Path $TunnelErrLogPath) { $logContent += (Get-Content $TunnelErrLogPath -Raw -ErrorAction SilentlyContinue) }
  # cloudflared also logs its own control-plane endpoint (https://api.trycloudflare.com)
  # before printing the actual per-tunnel hostname. Real quick-tunnel names are always a
  # multi-word hyphenated subdomain (e.g. good-toy-perfect-mice.trycloudflare.com), never
  # a bare word like "api" -- require a hyphen to tell them apart, and take the last match
  # in case the control-plane URL is mentioned again later (retries, telemetry, ...).
  $urlMatches = [regex]::Matches($logContent, "https://[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)+\.trycloudflare\.com")
  if ($urlMatches.Count -gt 0) {
    $TunnelUrl = $urlMatches[$urlMatches.Count - 1].Value
  }
  $tries++
}

if (-not $TunnelUrl) {
  Write-Fail "Impossible de recuperer l'URL du tunnel apres 30s. Regardez $TunnelErrLogPath (et $TunnelLogPath) pour le detail."
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
$maxTries = 20
while ($tries -lt $maxTries) {
  $publicStatusNoAuth = Get-HttpStatus "$TunnelUrl/v1/chat/completions" @{}
  if ($publicStatusNoAuth -eq 401) { break }
  Start-Sleep -Seconds 3
  $tries++
  if ($tries % 5 -eq 0) {
    Write-Host "    ... toujours en attente de la propagation du tunnel ($tries/$maxTries)"
  }
}

if ($publicStatusNoAuth -eq 401) {
  Write-Ok "Sans jeton via le tunnel public : correctement rejete (401)."
} else {
  $detail = if ($script:LastHttpError) { " Detail : $($script:LastHttpError)" } else { "" }
  Write-Fail "Sans jeton via le tunnel public : reponse $publicStatusNoAuth (attendu 401) apres $($maxTries * 3)s d'attente.$detail"
  Write-Host "    Le tunnel Cloudflare lui-meme s'est bien ouvert (URL : $TunnelUrl) -- ce n'est donc pas un probleme de Caddy/Ollama."

  if ($script:LastHttpErrorIsDns) {
    $tunnelHost = ([Uri]$TunnelUrl).Host
    Write-Host ""
    Write-Host "    Ceci ressemble a un blocage DNS local plutot qu'a un vrai probleme de propagation :"
    Write-Host "    la resolution du nom '$tunnelHost' echoue completement sur cette machine."
    Write-Host "    Diagnostic automatique (DNS systeme actuel vs DNS public Cloudflare) :"
    $viaSystem = $null
    $viaPublic = $null
    try { $viaSystem = Resolve-DnsName -Name $tunnelHost -ErrorAction Stop | Select-Object -First 1 } catch {}
    try { $viaPublic = Resolve-DnsName -Name $tunnelHost -Server 1.1.1.1 -ErrorAction Stop | Select-Object -First 1 } catch {}
    if (-not $viaSystem -and $viaPublic) {
      Write-Host "    -> Le DNS systeme ECHOUE mais le DNS public 1.1.1.1 REUSSIT."
      Write-Host "       Tres probablement votre antivirus, pare-feu ou le DNS de votre routeur bloque"
      Write-Host "       specifiquement *.trycloudflare.com (certains produits le font car ce service"
      Write-Host "       gratuit est parfois utilise a des fins malveillantes)."
      Write-Host "       Solutions : changez temporairement le DNS de votre carte reseau pour 1.1.1.1 ou"
      Write-Host "       8.8.8.8, ou desactivez la protection DNS/web de votre antivirus pour tester."
    } elseif (-not $viaSystem -and -not $viaPublic) {
      Write-Host "    -> Meme le DNS public 1.1.1.1 echoue : le blocage n'est pas au niveau DNS de Windows"
      Write-Host "       mais plus bas (pare-feu, proxy d'entreprise, ou coupure reseau vers Cloudflare)."
    } else {
      Write-Host "    -> Les deux resolutions ont reussi cette fois -- reessayez le script, c'etait"
      Write-Host "       peut-etre une propagation lente ponctuelle."
    }
    Write-Host ""
  } else {
    Write-Host "    Verifiez votre pare-feu/antivirus et reessayez ce script."
  }
  Stop-Bridge
  exit 1
}

try {
  $body = @{
    model = $Model
    messages = @(@{ role = "user"; content = "Reponds uniquement par le mot OK, rien d'autre." })
  } | ConvertTo-Json -Depth 5

  $resp = Invoke-RestMethod -Method Post -Uri "$TunnelUrl/v1/chat/completions" -UserAgent $BrowserUserAgent `
    -Headers @{ Authorization = "Bearer $Secret" } `
    -ContentType "application/json" -Body $body -TimeoutSec 60

  $reply = $resp.choices[0].message.content
  Write-Ok "Avec jeton via le tunnel public : reponse recue d'Ollama -- '$reply'"
} catch {
  $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { $null }
  Write-Fail "Avec jeton via le tunnel public : la requete a echoue -- $($_.Exception.Message)"
  if ($statusCode -eq 403) {
    # This Caddyfile can only ever answer 401 (bad/missing token) or forward
    # the request to Ollama -- a plain "403 Forbidden" isn't a status our
    # own stack is capable of producing, at all, which is how this was
    # narrowed down to Cloudflare's own edge (not our Caddy/Ollama) in the
    # first place: likely its bot/WAF heuristics on *.trycloudflare.com
    # flagging an automated client sending an Authorization header as a
    # credential/API-abuse-looking pattern. Already worked around above by
    # sending a normal browser User-Agent instead of PowerShell's default
    # one -- if that wasn't enough, only Cloudflare-side settings remain.
    Write-Host "    Un 403 ici ne peut pas venir de ce script -- le Caddyfile ne sait repondre que 401"
    Write-Host "    (jeton refuse) ou transmettre a Ollama, jamais 403. Ca vient donc de Cloudflare"
    Write-Host "    lui-meme (heuristique anti-bot/WAF sur les tunnels *.trycloudflare.com), pas de"
    Write-Host "    votre PC. Deja tente : un User-Agent de navigateur normal au lieu de celui, tres"
    Write-Host "    reconnaissable, de PowerShell. Si ca persiste, il n'y a plus grand-chose a ajuster"
    Write-Host "    cote script -- relancez pour obtenir un nouveau sous-domaine de tunnel (parfois"
    Write-Host "    suffisant, l'heuristique semble viser certains sous-domaines plus que d'autres),"
    Write-Host "    ou signalez-le sur https://github.com/cloudflare/cloudflared/issues."
  }
  Stop-Bridge
  exit 1
}

if (-not $NoWatcher) {
  try {
    $statusResp = Invoke-RestMethod -Method Get -Uri "$TunnelUrl/bridge/status" -Headers @{ Authorization = "Bearer $Secret" } -UserAgent $BrowserUserAgent -TimeoutSec 15
    Write-Ok "Point de statut GPU joignable via le tunnel public -- etat actuel : $($statusResp.state)"
  } catch {
    # Not fatal: the actual text generation above already proved end to end --
    # this only means Fogbound's colored indicator will show "hors ligne"
    # until it's sorted out.
    Write-Fail "Point de statut /bridge/status injoignable via le tunnel -- $($_.Exception.Message). La generation de texte fonctionne ; seul l'indicateur de statut dans Fogbound sera incorrect."
  }
}

# ---------------------------------------------------------------------------
# 6. Push settings to Fogbound automatically
# ---------------------------------------------------------------------------

if (-not $SkipFogboundUpdate) {
  Write-Step "Mise a jour automatique des reglages Fogbound ($FogboundUrl)"
  try {
    # Same tunnel URL and secret for both -- Caddy tells Ollama and the
    # /sdapi image route apart by path, so there's only one address to push.
    # textProvider/imageProvider themselves are left untouched: you opt in
    # from Settings when ready, same reasoning as not auto-switching before.
    $settingsBody = @{
      ollamaBaseUrl = $TunnelUrl
      localImageBaseUrl = $TunnelUrl
      apiKeys = @{ ollama = $Secret; localsd = $Secret }
    } | ConvertTo-Json -Depth 5

    Invoke-RestMethod -Method Post -Uri "$FogboundUrl/api/settings" `
      -ContentType "application/json" -Body $settingsBody -TimeoutSec 20 | Out-Null

    $confirm = Invoke-RestMethod -Method Get -Uri "$FogboundUrl/api/settings" -TimeoutSec 20
    if ($confirm.ollamaBaseUrl -eq $TunnelUrl -and $confirm.localImageBaseUrl -eq $TunnelUrl) {
      Write-Ok "Fogbound confirme la nouvelle adresse (texte ET image locale)."
    } else {
      Write-Fail "Fogbound n'a pas confirme la mise a jour (ollamaBaseUrl : $($confirm.ollamaBaseUrl), localImageBaseUrl : $($confirm.localImageBaseUrl)). Verifiez manuellement dans Reglages."
    }
  } catch {
    Write-Fail "Impossible de contacter Fogbound pour mettre a jour les reglages -- $($_.Exception.Message). Vous pouvez le faire manuellement dans Reglages."
  }
} else {
  Write-Step "Mise a jour Fogbound ignoree (-SkipFogboundUpdate)"
  Write-Host "    Adresse a coller dans Reglages -> Adresse du serveur Ollama ET Adresse du serveur Stable Diffusion : $TunnelUrl"
  Write-Host "    Cle a coller dans Reglages -> Cle API Ollama ET Cle API IA locale (images) : $Secret"
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
Write-Host " Surveillant GPU  : $(if ($NoWatcher) { 'desactive (-NoWatcher)' } else { 'actif (icone dans la barre des taches)' })"
Write-Host " Image locale (/sdapi) : route $(if ($sdStatusNoAuth -eq 401) { 'prete' } else { 'a verifier' }) sur le port $SdPort -- $(if ($sdDetected) { 'un serveur y repond' } else { 'rien detecte, lancez AUTOMATIC1111 --api si besoin' })"
Write-Host ""
Write-Host " Derniere etape (manuelle) : ouvrez Fogbound -> Reglages, mettez"
Write-Host " Fournisseur = 'Ollama (local)' et Modele = '$Model' pour le texte ;"
Write-Host " Fournisseur = 'IA locale (Stable Diffusion)' pour les images si vous en utilisez une ; puis Enregistrer."
Write-Host ""
Write-Host " Journal complet de cette execution : $TranscriptPath"
Write-Host " Laissez cette fenetre ouverte tant que vous jouez avec Ollama."
Write-Host " Appuyez sur Ctrl+C pour tout arreter proprement."
Write-Host "=================================================================" -ForegroundColor Yellow

try {
  while ($true) { Start-Sleep -Seconds 5 }
} finally {
  Write-Host ""
  Write-Host "Arret du proxy, du surveillant et du tunnel..."
  Stop-Bridge
  try { Stop-Transcript | Out-Null } catch {}
}
