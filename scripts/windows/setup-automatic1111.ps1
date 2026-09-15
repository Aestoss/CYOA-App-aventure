<#
.SYNOPSIS
  Installs and starts AUTOMATIC1111 (Stable Diffusion WebUI) for Fogbound's
  local image generation, auto-detecting folders you may already have
  instead of asking you to type paths by hand.

.DESCRIPTION
  This is the missing piece for local image generation: setup-ollama-bridge.ps1
  already prepares an authenticated proxy route for it (/sdapi/*) and detects
  whether something answers on port 7860, but does NOT install AUTOMATIC1111
  itself -- that's what this script does. Run this first, then re-run
  setup-ollama-bridge.ps1 to wire it into the public tunnel and push the
  address to Fogbound's Settings.

  What it does, in order:
    1. Makes sure Python 3.10 and Git are installed (via winget if missing).
    2. Looks for an existing AUTOMATIC1111 install before cloning a new one --
       searches your user profile, Desktop, Downloads and Documents for a
       "webui-user.bat" file (the one file every real install has) up to 3
       folders deep, and remembers what it finds (or where it cloned a fresh
       copy) in a small config file next to setup-ollama-bridge.ps1's own, so
       later runs don't need to search again.
    3. Looks for a Stable Diffusion checkpoint (.safetensors/.ckpt) already
       sitting in Downloads or Desktop -- if your install has none yet and
       one turns up there, moves it into the install's models folder instead
       of asking you to place it by hand. If none exist anywhere and no
       -ModelUrl was given, downloads a default checkpoint automatically
       (NoobAI-XL v1.1, SDXL/anime/illustration, uncensored, ~7.1 GB) so the
       install finishes without you doing anything by hand -- use -ModelUrl
       to fetch a different model instead, or -NoAutoModel to stop and pick
       one yourself.
    4. Detects an RTX 50xx (Blackwell) GPU and, if found, overrides this
       webui's default (outdated) PyTorch install command so it actually
       runs on that hardware instead of crashing on the first generation --
       see the comment above that step for why this is needed.
    5. Edits webui-user.bat to add the --api flag if it isn't already there
       (idempotent -- running this script again never adds it twice).
    6. Launches webui-user.bat and waits for its API to actually answer --
       the very first launch installs several GB of dependencies (PyTorch
       etc.) and can take 10-15 minutes, so this polls patiently instead of
       declaring success too early.

.NOTES
  - Run from a normal PowerShell window: if execution policy blocks the
    script, run instead:
      powershell -ExecutionPolicy Bypass -File .\setup-automatic1111.ps1
  - This script has not been run on a real Windows machine by the assistant
    that wrote it (no such access exists in that environment) -- it was
    built from AUTOMATIC1111's documented install steps and verified winget
    package IDs, but please report back anything that errors so it can be
    fixed.
  - Leaves the WebUI running in this console window (Ctrl+C stops it, same
    as running webui-user.bat directly) -- it's a separate long-running
    process from the Ollama bridge, not something this script backgrounds.

.PARAMETER WebUiDir
  Skip auto-detection and use this exact AUTOMATIC1111 folder (must contain
  webui-user.bat). Use this if you already know where it's installed, or if
  auto-detection picked the wrong one of several installs.

.PARAMETER ModelUrl
  Optional direct download URL for a Stable Diffusion checkpoint
  (.safetensors). If given and no checkpoint is found anywhere, downloads
  this URL into the models folder instead of the built-in default.

.PARAMETER SdPort
  Port the WebUI's API should listen on. Defaults to 7860 (AUTOMATIC1111's
  own default) -- matches setup-ollama-bridge.ps1's default -SdPort, keep
  them in sync if you change one.

.PARAMETER NoAutoModel
  If no checkpoint is found anywhere and this is set, stop and print manual
  download instructions instead of automatically fetching the default
  Stable Diffusion 1.5 checkpoint. Use this if you'd rather pick your own
  model without an unplanned ~2 GB download.

.PARAMETER SkipLaunch
  Set everything up (install, detect, place model, add --api) but don't
  actually start the WebUI -- use this if you'd rather launch it yourself.
#>

[CmdletBinding()]
param(
  [string]$WebUiDir = "",
  [string]$ModelUrl = "",
  [int]$SdPort = 7860,
  [switch]$NoAutoModel,
  [switch]$SkipLaunch
)

# Default checkpoint used when nothing else is found and -ModelUrl isn't
# given -- NoobAI-XL v1.1 (Laxhar Lab), an SDXL/Illustrious-based anime and
# illustration checkpoint, epsilon-prediction (works with plain samplers,
# unlike the separate v-pred release which needs extra WebUI settings),
# uncensored, ~7.1 GB. Picked as the closest realistic match to the kind of
# AI-illustration look apps like Infinite Worlds use -- Infinite Worlds
# itself is closed-source and doesn't publish an exact checkpoint to match.
$DefaultModelUrl = "https://huggingface.co/Laxhar/noobai-XL-1.1/resolve/main/NoobAI-XL-v1.1.safetensors"

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Setup / paths -- reuses the same work folder as setup-ollama-bridge.ps1
# (this machine's one shared "Fogbound PC bridge" folder) rather than
# inventing a second one, since the two scripts are two halves of the same
# setup.
# ---------------------------------------------------------------------------

$WorkDir       = Join-Path $env:USERPROFILE "FogboundOllamaBridge"
$ConfigPath    = Join-Path $WorkDir "automatic1111-config.json"
$DefaultCloneParent = $env:USERPROFILE
$WebUiLogPath  = Join-Path $WorkDir "automatic1111.log"
$WebUiErrLogPath = Join-Path $WorkDir "automatic1111.err.log"

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

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

function Get-A1111Config {
  if (Test-Path $ConfigPath) {
    try { return Get-Content $ConfigPath -Raw | ConvertFrom-Json } catch {}
  }
  return [pscustomobject]@{ webuiDir = $null }
}
function Save-A1111Config($cfg) {
  $cfg | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8
}

# ---------------------------------------------------------------------------
# 1. Python 3.10 + Git
# ---------------------------------------------------------------------------

Write-Step "Verification de Python 3.10"

function Test-Python310 {
  try {
    $v = & py -3.10 --version 2>&1
    if ($LASTEXITCODE -eq 0 -and $v -match "3\.10") { return "py -3.10" }
  } catch {}
  try {
    $v = & python --version 2>&1
    if ($v -match "3\.10") { return "python" }
  } catch {}
  return $null
}

$PythonLauncher = Test-Python310
if (-not $PythonLauncher) {
  Write-Host "    Python 3.10 n'est pas installe -- installation via winget..."
  try {
    winget install --id Python.Python.3.10 -e --silent --accept-package-agreements --accept-source-agreements
  } catch {
    Write-Fail "L'installation via winget a echoue. Relancez ce script depuis un PowerShell en mode Administrateur, ou installez Python 3.10 manuellement depuis https://www.python.org/downloads/release/python-3106/ (cochez 'Add to PATH'), puis relancez ce script."
    exit 1
  }
  $env:PATH += ";$env:LOCALAPPDATA\Programs\Python\Python310;$env:LOCALAPPDATA\Programs\Python\Python310\Scripts"
  $PythonLauncher = Test-Python310
  if (-not $PythonLauncher) {
    Write-Fail "Python a ete installe mais n'est pas trouve dans cette session. Fermez et rouvrez PowerShell, puis relancez ce script."
    exit 1
  }
}
Write-Ok "Python 3.10 disponible ($PythonLauncher)."

Write-Step "Verification de Git"

$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
  Write-Host "    Git n'est pas installe -- installation via winget..."
  try {
    winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
  } catch {
    Write-Fail "L'installation via winget a echoue. Relancez ce script depuis un PowerShell en mode Administrateur, ou installez Git manuellement depuis https://git-scm.com/download/win, puis relancez ce script."
    exit 1
  }
  $env:PATH += ";$env:ProgramFiles\Git\cmd"
  $gitCmd = Get-Command git -ErrorAction SilentlyContinue
  if (-not $gitCmd) {
    Write-Fail "Git a ete installe mais n'est pas trouve dans cette session. Fermez et rouvrez PowerShell, puis relancez ce script."
    exit 1
  }
}
Write-Ok "Git est installe."

# ---------------------------------------------------------------------------
# 2. Find (or clone) AUTOMATIC1111 -- the "detection automatique des
#    dossiers" this script exists for: never make you type a path unless
#    auto-detection genuinely can't find one and none was cloned yet.
# ---------------------------------------------------------------------------

Write-Step "Recherche d'une installation d'AUTOMATIC1111 existante"

function Find-ExistingWebUi {
  $searchRoots = @(
    $env:USERPROFILE,
    (Join-Path $env:USERPROFILE "Desktop"),
    (Join-Path $env:USERPROFILE "Downloads"),
    (Join-Path $env:USERPROFILE "Documents")
  ) | Where-Object { Test-Path $_ } | Select-Object -Unique

  foreach ($root in $searchRoots) {
    $found = Get-ChildItem -Path $root -Filter "webui-user.bat" -Recurse -Depth 3 -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.Directory.FullName }
  }
  return $null
}

$cfg = Get-A1111Config
$ResolvedWebUiDir = $null

if ($WebUiDir) {
  if (-not (Test-Path (Join-Path $WebUiDir "webui-user.bat"))) {
    Write-Fail "Le dossier indique avec -WebUiDir ($WebUiDir) ne contient pas de webui-user.bat -- verifiez le chemin."
    exit 1
  }
  $ResolvedWebUiDir = $WebUiDir
  Write-Ok "Utilisation du dossier indique : $ResolvedWebUiDir"
} elseif ($cfg.webuiDir -and (Test-Path (Join-Path $cfg.webuiDir "webui-user.bat"))) {
  $ResolvedWebUiDir = $cfg.webuiDir
  Write-Ok "Installation deja connue d'une execution precedente : $ResolvedWebUiDir"
} else {
  Write-Info "Recherche dans le profil utilisateur, Bureau, Telechargements et Documents (jusqu'a 3 sous-dossiers de profondeur)..."
  $detected = Find-ExistingWebUi
  if ($detected) {
    $ResolvedWebUiDir = $detected
    Write-Ok "Installation existante trouvee : $ResolvedWebUiDir"
  } else {
    Write-Info "Aucune installation existante trouvee -- clonage d'une nouvelle copie."
    $cloneTarget = Join-Path $DefaultCloneParent "stable-diffusion-webui"
    if (Test-Path $cloneTarget) {
      Write-Fail "$cloneTarget existe deja mais ne contient pas de webui-user.bat valide -- renommez ou supprimez ce dossier, puis relancez ce script."
      exit 1
    }
    & git clone --depth 1 https://github.com/AUTOMATIC1111/stable-diffusion-webui.git $cloneTarget
    if ($LASTEXITCODE -ne 0) {
      Write-Fail "Le clonage a echoue (voir le detail ci-dessus). Verifiez votre connexion internet et relancez ce script."
      exit 1
    }
    $ResolvedWebUiDir = $cloneTarget
    Write-Ok "Clone dans $ResolvedWebUiDir."
  }
}

$cfg.webuiDir = $ResolvedWebUiDir
Save-A1111Config $cfg

$ModelsDir = Join-Path $ResolvedWebUiDir "models\Stable-diffusion"
New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

# ---------------------------------------------------------------------------
# 3. Find (or fetch) a checkpoint -- same auto-detection spirit: only ask you
#    to do something by hand if you explicitly opted out with -NoAutoModel.
# ---------------------------------------------------------------------------

Write-Step "Verification d'un modele Stable Diffusion"

# -Include only takes effect with -Recurse, or with a trailing wildcard on
# -Path like this -- without either, PowerShell silently ignores -Include
# and returns every file in the folder, not just checkpoints.
$existingCheckpoints = Get-ChildItem -Path (Join-Path $ModelsDir "*") -Include "*.safetensors","*.ckpt" -File -ErrorAction SilentlyContinue
if ($existingCheckpoints -and $existingCheckpoints.Count -gt 0) {
  Write-Ok "Modele(s) deja en place : $($existingCheckpoints.Name -join ', ')"
} else {
  Write-Info "Aucun modele dans $ModelsDir -- recherche dans Telechargements et Bureau..."
  $candidateRoots = @(
    (Join-Path $env:USERPROFILE "Downloads"),
    (Join-Path $env:USERPROFILE "Desktop")
  ) | Where-Object { Test-Path $_ }
  $candidates = @()
  foreach ($root in $candidateRoots) {
    $candidates += Get-ChildItem -Path $root -Include "*.safetensors","*.ckpt" -File -Recurse -Depth 1 -ErrorAction SilentlyContinue
  }

  if ($candidates.Count -gt 0) {
    foreach ($file in $candidates) {
      $dest = Join-Path $ModelsDir $file.Name
      Move-Item -Path $file.FullName -Destination $dest -Force
      Write-Ok "Deplace vers le dossier des modeles : $($file.Name)"
    }
  } elseif ($NoAutoModel) {
    Write-Fail "Aucun modele trouve, et -NoAutoModel est actif."
    Write-Host "    Telechargez un modele Stable Diffusion (fichier .safetensors, plusieurs Go)"
    Write-Host "    depuis Civitai (https://civitai.com) ou Hugging Face (https://huggingface.co),"
    Write-Host "    placez-le dans :"
    Write-Host "      $ModelsDir"
    Write-Host "    puis relancez ce script -- il le detectera automatiquement."
    exit 1
  } else {
    $downloadUrl = if ($ModelUrl) { $ModelUrl } else { $DefaultModelUrl }
    $label = if ($ModelUrl) { "l'URL fournie" } else { "le modele par defaut (NoobAI-XL v1.1, SDXL/anime/illustration, non censure, ~7.1 Go)" }
    Write-Info "Aucun modele trouve -- telechargement de $label..."
    Write-Info "Cela peut prendre plusieurs minutes selon votre connexion. Utilisez -ModelUrl pour un autre modele, ou -NoAutoModel pour choisir vous-meme."
    $destName = Split-Path -Leaf ([Uri]$downloadUrl).LocalPath
    if (-not $destName) { $destName = "model.safetensors" }
    $dest = Join-Path $ModelsDir $destName
    # Invoke-WebRequest's default progress-bar rendering makes large
    # downloads dramatically slower in Windows PowerShell 5.1 -- disabled
    # only for the duration of this call, restored right after.
    $prevProgressPreference = $ProgressPreference
    $ProgressPreference = "SilentlyContinue"
    try {
      Invoke-WebRequest -Uri $downloadUrl -OutFile $dest -UseBasicParsing
      Write-Ok "Modele telecharge : $destName"
    } catch {
      Write-Fail "Le telechargement a echoue -- $($_.Exception.Message)."
      if (-not $ModelUrl) {
        Write-Host "    Si Hugging Face demande une connexion (modele marque 'contenu mature'),"
        Write-Host "    telechargez-le a la main depuis un navigateur ou vous etes connecte :"
        Write-Host "      $downloadUrl"
      }
      Write-Host "    Placez le fichier dans $ModelsDir puis relancez ce script -- il le detectera."
      exit 1
    } finally {
      $ProgressPreference = $prevProgressPreference
    }
  }
}

# ---------------------------------------------------------------------------
# 4. RTX 50xx (Blackwell) needs a newer PyTorch than this webui pins by
#    default. AUTOMATIC1111's launch_utils.py still hardcodes torch==2.1.2
#    (CUDA 12.1), which has no compiled kernels for the 50-series' sm_120
#    architecture -- confirmed by real user reports, not assumed -- and
#    fails on the very first generation with "no kernel image is available
#    for execution on the device", well after the lengthy first-run install
#    already succeeded. Detected and overridden here via webui-user.bat's
#    own TORCH_COMMAND mechanism, which replaces that pinned install
#    command with one pointed at PyTorch's cu128 (Blackwell-compatible)
#    wheels -- everyone else's webui-user.bat is left untouched.
# ---------------------------------------------------------------------------

Write-Step "Verification de la compatibilite GPU (RTX 50xx / Blackwell)"

function Test-BlackwellGpu {
  try {
    $names = Get-CimInstance Win32_VideoController -ErrorAction Stop | Select-Object -ExpandProperty Name
    return [bool]($names | Where-Object { $_ -match "RTX 50\d0" })
  } catch {
    return $false
  }
}

$WebUiUserBat = Join-Path $ResolvedWebUiDir "webui-user.bat"
$batContent = Get-Content $WebUiUserBat -Raw

if (Test-BlackwellGpu) {
  Write-Info "GPU RTX 50xx (Blackwell) detecte -- le PyTorch installe par defaut par ce webui n'a pas de noyaux compiles pour cette architecture et plante a la premiere generation d'image."
  $torchLine = "set TORCH_COMMAND=pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128"
  if ($batContent -match "(?m)^set TORCH_COMMAND=[^\r\n]*cu128") {
    Write-Ok "TORCH_COMMAND est deja configure pour cu128 (compatible Blackwell)."
  } elseif ($batContent -match "(?m)^set TORCH_COMMAND=[^\r\n]*") {
    $batContent = $batContent -replace "(?m)^set TORCH_COMMAND=[^\r\n]*", $torchLine
    Set-Content -Path $WebUiUserBat -Value $batContent -Encoding ASCII
    Write-Ok "TORCH_COMMAND remplace par la version compatible cu128."
  } else {
    Add-Content -Path $WebUiUserBat -Value "`r`n$torchLine" -Encoding ASCII
    $batContent = Get-Content $WebUiUserBat -Raw
    Write-Ok "TORCH_COMMAND (cu128) ajoute a webui-user.bat."
  }
  Write-Info "Si le venv existant (dossier 'venv') a deja installe l'ancien torch, supprimez ce dossier avant de relancer pour forcer sa reinstallation."
} else {
  Write-Ok "Pas de GPU Blackwell (RTX 50xx) detecte -- aucun changement necessaire."
}

# ---------------------------------------------------------------------------
# 5. Make sure --api is enabled (idempotent: never adds it twice)
# ---------------------------------------------------------------------------

Write-Step "Activation du flag --api"

if ($batContent -match "(?m)^set COMMANDLINE_ARGS=[^\r\n]*--api") {
  Write-Ok "--api est deja active dans webui-user.bat."
} elseif ($batContent -match "(?m)^set COMMANDLINE_ARGS=([^\r\n]*)") {
  # [^\r\n]* instead of .* -- avoids swallowing the line's trailing \r into
  # the match (regex $ matches before \n, not \r), which would otherwise
  # leave this one line LF-only in an otherwise CRLF batch file.
  $existingArgs = $Matches[1].Trim()
  $newArgs = if ($existingArgs) { "$existingArgs --api" } else { "--api" }
  $newContent = $batContent -replace "(?m)^set COMMANDLINE_ARGS=[^\r\n]*", "set COMMANDLINE_ARGS=$newArgs"
  Set-Content -Path $WebUiUserBat -Value $newContent -Encoding ASCII
  Write-Ok "--api ajoute a la ligne COMMANDLINE_ARGS existante."
} else {
  Add-Content -Path $WebUiUserBat -Value "`r`nset COMMANDLINE_ARGS=--api" -Encoding ASCII
  Write-Ok "Ligne COMMANDLINE_ARGS=--api ajoutee (absente du fichier d'origine)."
}

if ($SkipLaunch) {
  Write-Step "Termine (-SkipLaunch)"
  Write-Host "    Tout est pret dans $ResolvedWebUiDir -- lancez webui-user.bat vous-meme quand vous voulez."
  exit 0
}

# ---------------------------------------------------------------------------
# 6. Launch and wait for the API to actually answer -- the first run
#    installs several GB of dependencies, so this is patient on purpose.
# ---------------------------------------------------------------------------

Write-Step "Lancement d'AUTOMATIC1111 (premier lancement = installation des dependances, soyez patient)"

if (Test-Path $WebUiLogPath) { Remove-Item $WebUiLogPath -Force }
if (Test-Path $WebUiErrLogPath) { Remove-Item $WebUiErrLogPath -Force }

# Two separate log files, not one shared by both streams: Start-Process
# refuses -RedirectStandardOutput and -RedirectStandardError pointing at the
# same file (hit and fixed for cloudflared in setup-ollama-bridge.ps1 --
# applied here from the start instead of re-discovering it the hard way).
$webuiProcess = Start-Process -FilePath $WebUiUserBat -WorkingDirectory $ResolvedWebUiDir `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $WebUiLogPath -RedirectStandardError $WebUiErrLogPath

Write-Info "Processus demarre (PID $($webuiProcess.Id)). Journal : $WebUiLogPath"
Write-Info "Cela peut prendre 10 a 15 minutes la toute premiere fois (telechargement de PyTorch et des dependances)."

$maxTries = 180  # 180 x 5s = 15 minutes
$tries = 0
$ready = $false
while ($tries -lt $maxTries) {
  Start-Sleep -Seconds 5
  $tries++
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$SdPort/sdapi/v1/sd-models" -TimeoutSec 3 | Out-Null
    $ready = $true
    break
  } catch {}
  if ($webuiProcess.HasExited) {
    Write-Fail "Le processus s'est arrete de lui-meme (code $($webuiProcess.ExitCode)). Regardez $WebUiErrLogPath pour le detail."
    exit 1
  }
  if ($tries % 12 -eq 0) {
    Write-Info "... toujours en attente ($($tries * 5)s ecoulees) -- consultez $WebUiLogPath si ca semble bloque"
  }
}

if (-not $ready) {
  Write-Fail "L'API ne repond toujours pas apres 15 minutes. Regardez $WebUiLogPath et $WebUiErrLogPath pour voir ou ca bloque -- le processus (PID $($webuiProcess.Id)) reste lance, il continuera peut-etre de son cote."
  exit 1
}

Write-Ok "AUTOMATIC1111 repond sur http://127.0.0.1:$SdPort avec --api actif."
Write-Host ""
Write-Host "    Prochaine etape : relancez setup-ollama-bridge.ps1 -- il detectera" -ForegroundColor Cyan
Write-Host "    ce serveur et poussera son adresse dans les reglages de Fogbound" -ForegroundColor Cyan
Write-Host "    (Images -> IA locale / Stable Diffusion)." -ForegroundColor Cyan
