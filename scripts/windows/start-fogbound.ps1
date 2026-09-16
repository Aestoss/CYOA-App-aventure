<#
.SYNOPSIS
  One combined start/stop/verify script for Fogbound's whole local stack --
  stops anything already running, installs/verifies AUTOMATIC1111 and
  Ollama (downloading models/dependencies if needed), then starts the
  authenticated Tailscale Funnel bridge -- instead of juggling
  setup-automatic1111.ps1 and setup-ollama-bridge.ps1 by hand in the right
  order every time.

.DESCRIPTION
  This script does NOT reimplement setup-automatic1111.ps1 or
  setup-ollama-bridge.ps1 -- it calls them, in order, as the two of them
  already existed and were already debugged against a real machine over
  many rounds (CLIP/setuptools, the deleted Stability-AI repo, Blackwell/
  CUDA kernels, Tailscale Funnel, the Ollama Host-header rejection...).
  Every fix already made in either of them keeps applying here unchanged,
  with nothing to keep in sync by hand -- this script only adds the parts
  neither of them owned by itself: a clean stop-everything-first phase,
  running both in the right order, and one place to look when something
  fails.

  What it does, in order:
    1. STOP -- looks for anything from a previous run still active (Caddy,
       the GPU watcher, AUTOMATIC1111, or another copy of one of these
       scripts left open in a different window) and stops it, or confirms
       nothing was running. Deliberately does NOT touch Ollama's own server
       or Tailscale -- those are shared background services this script
       uses, not things it owns the lifecycle of; they're checked/started
       if needed in the next steps instead of being force-restarted every
       time.
    2. AUTOMATIC1111 (optional, never blocks the rest) -- runs
       setup-automatic1111.ps1: installs Python/Git if missing, finds or
       clones the WebUI, finds or downloads the default checkpoints,
       applies the Stability-AI mirror / Blackwell-CUDA / CLIP-setuptools
       fixes, enables --api, and launches it. A failure here is reported
       clearly but does not stop the rest of this script -- local text
       generation (Ollama) does not depend on it, and image generation is
       always best-effort throughout Fogbound.
    3. OLLAMA BRIDGE (final step -- this is what keeps the window open) --
       runs setup-ollama-bridge.ps1: installs/starts Ollama, pulls the
       requested model, starts Caddy (authenticated proxy) and the GPU
       watcher, verifies/starts the Tailscale Funnel tunnel, validates the
       whole chain end to end through the public URL (including reaching
       AUTOMATIC1111's /sdapi route if step 2 succeeded), and pushes the
       result to Fogbound's Settings automatically.

  Ctrl+C in this window stops the whole stack cleanly: the bridge script's
  own cleanup stops Caddy and the watcher, and this script's own cleanup
  (in a finally block) then also stops AUTOMATIC1111 if this run started
  it -- one script, one window, one Ctrl+C for everything.

.NOTES
  - Run from a normal PowerShell window: if execution policy blocks the
    script, run instead:
      powershell -ExecutionPolicy Bypass -File .\start-fogbound.ps1
  - First run can take 15-20+ minutes (AUTOMATIC1111's dependencies +
    checkpoints, Ollama's model pull) -- entirely normal, both underlying
    scripts print progress as they go. Later runs are much faster since
    everything is already installed and only gets verified.
  - See GUIDE-TAILSCALE.md (next to this script) for the one-time Tailscale
    account setup this all depends on, and
    setup-ollama-bridge.ps1 -Diagnose (or this script's own -Diagnose) if
    something looks wrong with the tunnel specifically.
  - This script has not been run on a real Windows machine by the assistant
    that wrote it (no such access exists in that environment) -- it only
    orchestrates the two already-verified scripts and adds its own stop/
    diagnose logic, built from their own documented behavior. Please report
    back anything that errors.

.PARAMETER FogboundUrl
  Base URL of your Fogbound deployment. Forwarded to setup-ollama-bridge.ps1.

.PARAMETER Model
  Ollama model to ensure is pulled and used. Forwarded to
  setup-ollama-bridge.ps1. Defaults to qwen3:14b.

.PARAMETER SdPort
  Local port AUTOMATIC1111's API listens on. Forwarded to both underlying
  scripts (keep this the only place you change it). Defaults to 7860.

.PARAMETER WebUiDir
  Skip AUTOMATIC1111 auto-detection and use this exact folder. Forwarded to
  setup-automatic1111.ps1.

.PARAMETER ModelUrl
  Optional extra Stable Diffusion checkpoint URL. Forwarded to
  setup-automatic1111.ps1.

.PARAMETER NoAutoModel
  Skip AUTOMATIC1111's default-checkpoint downloads. Forwarded to
  setup-automatic1111.ps1.

.PARAMETER SkipAutomatic1111
  Skip AUTOMATIC1111 entirely (no install/verify/launch/stop) -- use this
  if you only want local text generation (Ollama), not local images.

.PARAMETER SkipFogboundUpdate
  Don't push settings to Fogbound automatically. Forwarded to
  setup-ollama-bridge.ps1.

.PARAMETER NoWatcher
  Skip the GPU watcher tray icon / /bridge/status route. Forwarded to
  setup-ollama-bridge.ps1.

.PARAMETER Diagnose
  Report-only mode: checks Ollama, AUTOMATIC1111 and the Tailscale Funnel
  bridge (via setup-ollama-bridge.ps1 -Diagnose) without stopping,
  installing or launching anything.
#>

[CmdletBinding()]
param(
  [string]$FogboundUrl = "https://fogbound-production.up.railway.app",
  [string]$Model = "qwen3:14b",
  [int]$SdPort = 7860,
  [string]$WebUiDir = "",
  [string]$ModelUrl = "",
  [switch]$NoAutoModel,
  [switch]$SkipAutomatic1111,
  [switch]$SkipFogboundUpdate,
  [switch]$NoWatcher,
  [switch]$Diagnose
)

$ErrorActionPreference = "Stop"

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
function Write-Info($msg) {
  Write-Host "    $msg"
}

$Automatic1111Script = Join-Path $PSScriptRoot "setup-automatic1111.ps1"
$BridgeScript = Join-Path $PSScriptRoot "setup-ollama-bridge.ps1"
$WorkDir = Join-Path $env:USERPROFILE "FogboundOllamaBridge"
$BridgeConfigPath = Join-Path $WorkDir "config.json"
$A1111ConfigPath = Join-Path $WorkDir "automatic1111-config.json"

if (-not $SkipAutomatic1111 -and -not (Test-Path $Automatic1111Script)) {
  Write-Fail "setup-automatic1111.ps1 introuvable a cote de ce script ($PSScriptRoot) -- utilisez -SkipAutomatic1111 si c'est voulu, sinon replacez ce script a cote des autres."
  exit 1
}
if (-not (Test-Path $BridgeScript)) {
  Write-Fail "setup-ollama-bridge.ps1 introuvable a cote de ce script ($PSScriptRoot) -- impossible de continuer."
  exit 1
}

# ---------------------------------------------------------------------------
# Resolves AUTOMATIC1111's install directory the same way
# setup-automatic1111.ps1 itself does (explicit -WebUiDir, else its own
# cached config), so the stop-phase and the post-launch cleanup can find its
# process by command line without needing that script to expose a PID.
# ---------------------------------------------------------------------------
function Get-KnownWebUiDir {
  if ($WebUiDir -and (Test-Path (Join-Path $WebUiDir "webui-user.bat"))) { return $WebUiDir }
  if (Test-Path $A1111ConfigPath) {
    try {
      $a1111Cfg = Get-Content $A1111ConfigPath -Raw | ConvertFrom-Json
      if ($a1111Cfg.webuiDir -and (Test-Path (Join-Path $a1111Cfg.webuiDir "webui-user.bat"))) {
        return $a1111Cfg.webuiDir
      }
    } catch {}
  }
  return $null
}

# Confirmed for real on a live machine: Get-CimInstance's CommandLine can
# come back EMPTY for a perfectly real, running process -- Windows/WMI can
# silently withhold it when this script's own process doesn't have enough
# privilege relative to the target (e.g. one of the two was ever launched
# from an elevated window and the other wasn't). When that happens, the
# CommandLine-based match below finds nothing even though the process is
# very much alive -- confirmed directly: Get-CimInstance listed real
# python.exe/cmd.exe PIDs with a blank CommandLine, so "*$dir*" could never
# match them, and this function kept reporting nothing to stop. Port-based
# lookup (Get-NetTCPConnection) is the fix: it finds whatever process is
# actually LISTENING on AUTOMATIC1111's port via the network stack, not
# WMI's process table, so it doesn't depend on being able to read that
# process's command line at all. Both signals are combined -- CommandLine
# still catches a process before it's even bound to the port yet.
function Stop-A1111Processes($dir) {
  $pidsToStop = New-Object System.Collections.Generic.HashSet[int]

  if ($dir) {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$dir*") } |
      ForEach-Object { [void]$pidsToStop.Add($_.ProcessId) }
  }
  try {
    Get-NetTCPConnection -LocalPort $SdPort -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { [void]$pidsToStop.Add([int]$_.OwningProcess) }
  } catch {}

  if ($pidsToStop.Count -eq 0) { return $false }

  foreach ($procId in $pidsToStop) {
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
      Write-Info "Arret d'AUTOMATIC1111 (PID $procId)..."
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
  $waited = 0
  while ($waited -lt 10) {
    $stillRunning = $pidsToStop | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
    if (-not $stillRunning) { break }
    Start-Sleep -Milliseconds 500
    $waited += 0.5
  }
  return $true
}

# ---------------------------------------------------------------------------
# -Diagnose: report-only, no stop/install/launch of anything.
# ---------------------------------------------------------------------------

if ($Diagnose) {
  Write-Step "Diagnostic rapide (aucun arret, aucune installation, aucun lancement)"

  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:11434" -TimeoutSec 3 | Out-Null
    Write-Ok "Ollama repond sur le port 11434."
  } catch {
    Write-Fail "Ollama ne repond pas sur le port 11434."
  }

  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$SdPort/sdapi/v1/sd-models" -TimeoutSec 3 | Out-Null
    Write-Ok "AUTOMATIC1111 repond sur le port $SdPort."
  } catch {
    Write-Fail "AUTOMATIC1111 ne repond pas sur le port $SdPort (normal si vous n'utilisez pas la generation d'image locale, ou si -SkipAutomatic1111 a ete utilise)."
  }

  Write-Step "Diagnostic Tailscale / pont (delegue a setup-ollama-bridge.ps1 -Diagnose)"
  & $BridgeScript -Diagnose
  exit $LASTEXITCODE
}

# ---------------------------------------------------------------------------
# Phase 1/3 -- Stop anything already running, or confirm a clean start.
# ---------------------------------------------------------------------------

Write-Step "PHASE 1/3 -- Arret propre de tout ce qui tourne deja"

$stoppedAnything = $false

try {
  if (Test-Path $BridgeConfigPath) {
    $bridgeCfg = Get-Content $BridgeConfigPath -Raw | ConvertFrom-Json
    foreach ($pidField in @('caddyPid', 'watcherPid')) {
      $procId = $bridgeCfg.$pidField
      if ($procId -and (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
        Write-Info "Arret du processus $pidField (PID $procId)..."
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        $stoppedAnything = $true
      }
    }
  }
} catch {
  Write-Info "Impossible de lire $BridgeConfigPath ($($_.Exception.Message)) -- ignore, poursuite normale."
}

try {
  $preExistingWebUiDir = Get-KnownWebUiDir
  if (Stop-A1111Processes $preExistingWebUiDir) { $stoppedAnything = $true }
} catch {
  Write-Info "Verification des processus AUTOMATIC1111 impossible ($($_.Exception.Message)) -- ignore, poursuite normale."
}

# Another window still running one of these scripts directly (not just
# leftover child processes) -- e.g. a setup-ollama-bridge.ps1 launched by
# hand earlier and left open. Its own Caddy/watcher were likely just
# stopped above (same tracked PIDs); this also closes that now-idle window.
try {
  $lingeringScripts = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessId -ne $PID -and $_.CommandLine -and
      ($_.CommandLine -like "*setup-ollama-bridge.ps1*" -or $_.CommandLine -like "*setup-automatic1111.ps1*")
    }
  foreach ($p in $lingeringScripts) {
    Write-Info "Fermeture d'une fenetre de script Fogbound restee ouverte (PID $($p.ProcessId))..."
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    $stoppedAnything = $true
  }
} catch {
  Write-Info "Verification des fenetres de script restees ouvertes impossible ($($_.Exception.Message)) -- ignore."
}

if ($stoppedAnything) {
  Write-Ok "Anciens processus arretes."
  Start-Sleep -Seconds 1
} else {
  Write-Ok "Rien n'etait actif -- depart propre."
}

Write-Info "Ollama et Tailscale ne sont pas coupes ici : ce sont des services d'arriere-plan"
Write-Info "partages, pas quelque chose que ce script demarre/possede -- ils sont juste"
Write-Info "verifies (et demarres si besoin) dans les etapes suivantes."

# ---------------------------------------------------------------------------
# Phase 2/3 -- AUTOMATIC1111 (optional, never fatal to the rest).
# ---------------------------------------------------------------------------

$Automatic1111Ok = $false
$ResolvedWebUiDirAfterSetup = $null

if ($SkipAutomatic1111) {
  Write-Step "PHASE 2/3 -- AUTOMATIC1111 ignore (-SkipAutomatic1111)"
} else {
  Write-Step "PHASE 2/3 -- Installation/verification/lancement d'AUTOMATIC1111"
  $a1111Params = @{ SdPort = $SdPort }
  if ($WebUiDir) { $a1111Params.WebUiDir = $WebUiDir }
  if ($ModelUrl) { $a1111Params.ModelUrl = $ModelUrl }
  if ($NoAutoModel) { $a1111Params.NoAutoModel = $true }
  try {
    & $Automatic1111Script @a1111Params
    if ($LASTEXITCODE -eq 0) {
      $Automatic1111Ok = $true
      $ResolvedWebUiDirAfterSetup = Get-KnownWebUiDir
      Write-Ok "AUTOMATIC1111 pret."
    } else {
      Write-Fail "setup-automatic1111.ps1 a echoue (code $LASTEXITCODE) -- la generation d'image locale ne sera pas disponible cette fois. Le texte (Ollama) continue normalement ci-dessous."
    }
  } catch {
    Write-Fail "setup-automatic1111.ps1 a leve une erreur inattendue -- $($_.Exception.Message). La generation d'image locale ne sera pas disponible cette fois."
  }
}

# ---------------------------------------------------------------------------
# Phase 3/3 -- Ollama bridge. Final step: this is what keeps the window
# open (Ctrl+C to stop everything) -- see setup-ollama-bridge.ps1 itself.
# ---------------------------------------------------------------------------

Write-Step "PHASE 3/3 -- Pont Ollama <-> Fogbound (Tailscale, Caddy, surveillant GPU)"
if (-not $Automatic1111Ok) {
  Write-Info "AUTOMATIC1111 non disponible -- le pont continue quand meme (texte seul)."
}

$bridgeParams = @{ FogboundUrl = $FogboundUrl; Model = $Model; SdPort = $SdPort }
if ($SkipFogboundUpdate) { $bridgeParams.SkipFogboundUpdate = $true }
if ($NoWatcher) { $bridgeParams.NoWatcher = $true }

$bridgeExitCode = 0
try {
  & $BridgeScript @bridgeParams
  $bridgeExitCode = $LASTEXITCODE
} finally {
  if ($Automatic1111Ok) {
    Write-Step "Arret d'AUTOMATIC1111 (fin du pont)"
    if (Stop-A1111Processes $ResolvedWebUiDirAfterSetup) {
      Write-Ok "AUTOMATIC1111 arrete."
    } else {
      Write-Info "AUTOMATIC1111 n'etait deja plus actif."
    }
  }
}

exit $bridgeExitCode
