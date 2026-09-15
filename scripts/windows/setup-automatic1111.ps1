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
    3. Looks for Stable Diffusion checkpoints (.safetensors/.ckpt) already
       sitting in Downloads or Desktop and moves any found into the
       install's models folder. Then, unless -NoAutoModel is set, downloads
       whichever of two default checkpoints is still missing so both an
       illustration and a photorealistic option are available side by side
       (Fogbound's "Image model" field switches between them per world) --
       NoobAI-XL v1.1 (SDXL/anime/illustration, uncensored, ~7.1 GB) and
       RealVisXL V5.0 (photorealistic, uncensored, ~6.9 GB). -ModelUrl adds
       one further custom model on top of those two.
    4. Detects an RTX 50xx (Blackwell) GPU and, if found, overrides this
       webui's default (outdated) PyTorch install command so it actually
       runs on that hardware instead of crashing on the first generation --
       see the comment above that step for why this is needed.
    5. Pre-installs CLIP into the venv with a pinned setuptools version,
       working around a real, current (Sept 2026) compatibility break
       between setuptools 82+ and CLIP's legacy setup.py -- see the comment
       above that step for the full story and why the obvious PIP_CONSTRAINT
       fix doesn't actually work.
    6. Edits webui-user.bat to add the --api flag if it isn't already there
       (idempotent -- running this script again never adds it twice).
    7. Launches webui-user.bat and waits for its API to actually answer --
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
  Optional direct download URL for an additional Stable Diffusion checkpoint
  (.safetensors) to fetch on top of the two default profiles (illustration
  + photorealistic), e.g. a specific style you want alongside them.

.PARAMETER SdPort
  Port the WebUI's API should listen on. Defaults to 7860 (AUTOMATIC1111's
  own default) -- matches setup-ollama-bridge.ps1's default -SdPort, keep
  them in sync if you change one.

.PARAMETER NoAutoModel
  Skip downloading the two default checkpoints (illustration + photo-
  realistic, ~14 GB together) -- only moves in whatever's already sitting
  in Downloads/Desktop, and stops with manual instructions if that leaves
  the models folder empty. Use this if you'd rather pick your own model(s)
  without that download.

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
$WebUiStdinPath = Join-Path $WorkDir "automatic1111-stdin.empty"

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
# 3. Find (or fetch) checkpoints -- two default profiles are kept side by
#    side on purpose (illustration and photorealistic use different base
#    models; no single checkpoint does both well), same auto-detection
#    spirit: only ask you to do something by hand if you explicitly opted
#    out with -NoAutoModel.
# ---------------------------------------------------------------------------

Write-Step "Verification des modeles Stable Diffusion (illustration + photorealiste)"

function Get-ExistingCheckpointNames($dir) {
  # -Include only takes effect with -Recurse, or with a trailing wildcard on
  # -Path like this -- without either, PowerShell silently ignores -Include
  # and returns every file in the folder, not just checkpoints.
  return Get-ChildItem -Path (Join-Path $dir "*") -Include "*.safetensors","*.ckpt" -File -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Name
}

$existingNames = Get-ExistingCheckpointNames $ModelsDir
if ($existingNames.Count -gt 0) {
  Write-Ok "Modele(s) deja en place : $($existingNames -join ', ')"
}

Write-Info "Recherche de modeles supplementaires dans Telechargements et Bureau..."
$candidateRoots = @(
  (Join-Path $env:USERPROFILE "Downloads"),
  (Join-Path $env:USERPROFILE "Desktop")
) | Where-Object { Test-Path $_ }
$candidates = @()
foreach ($root in $candidateRoots) {
  $candidates += Get-ChildItem -Path $root -Include "*.safetensors","*.ckpt" -File -Recurse -Depth 1 -ErrorAction SilentlyContinue
}
foreach ($file in $candidates) {
  $dest = Join-Path $ModelsDir $file.Name
  if (-not (Test-Path $dest)) {
    Move-Item -Path $file.FullName -Destination $dest -Force
    Write-Ok "Deplace vers le dossier des modeles : $($file.Name)"
  }
}

$existingNames = Get-ExistingCheckpointNames $ModelsDir

# The two default profiles Fogbound expects to be able to switch between
# per world (see providers/imageProviders.js's sd_model_checkpoint override
# and public/app.js's "Image model" field) -- their exact filenames matter,
# since that's what gets typed into that field.
$DefaultModels = @(
  @{ Label = "illustration (NoobAI-XL v1.1, anime/illustration, non censure, ~7.1 Go)"; File = "NoobAI-XL-v1.1.safetensors"; Url = "https://huggingface.co/Laxhar/noobai-XL-1.1/resolve/main/NoobAI-XL-v1.1.safetensors" },
  @{ Label = "photorealiste (RealVisXL V5.0, non censure, ~6.9 Go)"; File = "RealVisXL_V5.0_fp16.safetensors"; Url = "https://huggingface.co/SG161222/RealVisXL_V5.0/resolve/main/RealVisXL_V5.0_fp16.safetensors" }
)

if ($NoAutoModel) {
  if ($existingNames.Count -eq 0) {
    Write-Fail "Aucun modele trouve, et -NoAutoModel est actif."
    Write-Host "    Telechargez un modele Stable Diffusion (fichier .safetensors, plusieurs Go)"
    Write-Host "    depuis Civitai (https://civitai.com) ou Hugging Face (https://huggingface.co),"
    Write-Host "    placez-le dans :"
    Write-Host "      $ModelsDir"
    Write-Host "    puis relancez ce script -- il le detectera automatiquement."
    exit 1
  }
} else {
  $modelsToFetch = @($DefaultModels | Where-Object { $existingNames -notcontains $_.File })
  if ($ModelUrl) {
    $customName = Split-Path -Leaf ([Uri]$ModelUrl).LocalPath
    if (-not $customName) { $customName = "model.safetensors" }
    if ($existingNames -notcontains $customName) {
      $modelsToFetch = @($modelsToFetch) + @(@{ Label = "modele personnalise (-ModelUrl)"; File = $customName; Url = $ModelUrl })
    }
  }

  if ($modelsToFetch.Count -eq 0) {
    Write-Ok "Les deux profils par defaut (illustration + photorealiste) sont deja presents."
  }

  foreach ($m in $modelsToFetch) {
    Write-Info "Telechargement de $($m.Label)..."
    Write-Info "Cela peut prendre plusieurs minutes selon votre connexion."
    $dest = Join-Path $ModelsDir $m.File
    # Invoke-WebRequest's default progress-bar rendering makes large
    # downloads dramatically slower in Windows PowerShell 5.1 -- disabled
    # only for the duration of this call, restored right after.
    $prevProgressPreference = $ProgressPreference
    $ProgressPreference = "SilentlyContinue"
    try {
      Invoke-WebRequest -Uri $m.Url -OutFile $dest -UseBasicParsing
      Write-Ok "Modele telecharge : $($m.File)"
    } catch {
      Write-Fail "Le telechargement de $($m.File) a echoue -- $($_.Exception.Message)."
      Write-Host "    Si Hugging Face demande une connexion (modele marque 'contenu mature'),"
      Write-Host "    telechargez-le a la main depuis un navigateur ou vous etes connecte :"
      Write-Host "      $($m.Url)"
      Write-Host "    Placez le fichier dans $ModelsDir (sous le nom $($m.File)) puis relancez ce script."
    } finally {
      $ProgressPreference = $prevProgressPreference
    }
  }
}

$existingNames = Get-ExistingCheckpointNames $ModelsDir
if ($existingNames.Count -eq 0) {
  Write-Fail "Aucun modele n'est present dans $ModelsDir (recherche/telechargement infructueux ci-dessus) -- AUTOMATIC1111 ne pourra rien generer sans au moins un checkpoint. Corrigez le probleme ci-dessus puis relancez ce script."
  exit 1
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
# 5. Pre-install CLIP into the venv myself, working around a real,
#    reproduced-twice failure: setuptools 82.0 (Feb 2026) deleted
#    pkg_resources entirely, and OpenAI's CLIP package -- an unpinned
#    git-based dependency this webui installs into every fresh venv --
#    still imports it in its legacy setup.py. pip's isolated build
#    environment always grabs the newest setuptools regardless of what's
#    installed elsewhere, so CLIP's build fails with "ModuleNotFoundError:
#    No module named 'pkg_resources'" on any fresh install done today,
#    independent of GPU.
#
#    PIP_CONSTRAINT (this step's previous approach) turned out NOT to
#    apply here -- confirmed both by the identical failure on a real
#    re-run and by pip's own changelog: constraints files (including
#    PIP_CONSTRAINT) no longer affect isolated build environments as of a
#    recent pip version; PIP_BUILD_CONSTRAINT is the replacement, but
#    isn't guaranteed present in whatever pip version this venv's Python
#    bootstrapped. The combination below is what's actually confirmed
#    working in AUTOMATIC1111's own GitHub issues for this exact error:
#    pin an older setuptools IN the venv, then install CLIP with
#    --no-build-isolation so pip reuses that already-installed setuptools
#    instead of creating a fresh isolated env with the newest one. Doing
#    this ourselves, before webui-user.bat's own install step runs, means
#    that step finds CLIP already importable and skips reinstalling it.
#
#    Placed before -SkipLaunch's early exit further down (unlike an earlier
#    version of this fix) -- this is genuinely part of "setting everything
#    up", not something that should be skipped along with the actual launch.
# ---------------------------------------------------------------------------

Write-Step "Pre-installation de CLIP (contourne un bug reel de compatibilite setuptools)"

$VenvDir = Join-Path $ResolvedWebUiDir "venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

# Windows PowerShell 5.1 wraps ANY stderr output from a native command into
# an ErrorRecord the moment it's captured -- confirmed for real: even with
# 2>$null, py/pip/python writing anything at all to stderr (warnings,
# deprecation notices, pip's own progress chatter -- not necessarily a real
# failure) crashed this whole script, because $ErrorActionPreference =
# "Stop" (set at the top of this script) promotes that ErrorRecord to a
# terminating error regardless of the redirect target. Relaxed to
# "Continue" for just this block of native calls, restored right after --
# $LASTEXITCODE is still checked normally to detect real failures.
$prevErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
  if (-not (Test-Path $VenvPython)) {
    Write-Info "Pas encore de venv -- creation..."
    if ($PythonLauncher -eq "py -3.10") { & py -3.10 -m venv $VenvDir } else { & python -m venv $VenvDir }
  }

  if (Test-Path $VenvPython) {
    & $VenvPython -c "import clip" 2>$null
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "CLIP est deja installe dans le venv."
    } else {
      Write-Info "Fixation de setuptools a une version compatible (69.5.1) dans le venv..."
      & $VenvPython -m pip install "setuptools==69.5.1" --quiet 2>$null

      # Read the exact URL AUTOMATIC1111 itself would install, straight from
      # its own launch_utils.py, so this keeps working if that pinned commit
      # ever changes -- falls back to the last-known-good URL (the one seen
      # failing in a real log) only if that file's shape changed too much to
      # find it automatically.
      $ClipPackageUrl = "https://github.com/openai/CLIP/archive/d50d76daa670286dd6cacf3bcd80b5e4823fc8e1.zip"
      $LaunchUtilsPath = Join-Path $ResolvedWebUiDir "modules\launch_utils.py"
      if (Test-Path $LaunchUtilsPath) {
        $launchUtilsContent = Get-Content $LaunchUtilsPath -Raw
        $urlMatch = [regex]::Match($launchUtilsContent, "https://github\.com/openai/CLIP/archive/[a-f0-9]+\.zip")
        if ($urlMatch.Success) { $ClipPackageUrl = $urlMatch.Value }
      }

      Write-Info "Installation de CLIP avec --no-build-isolation..."
      & $VenvPython -m pip install $ClipPackageUrl --no-build-isolation --prefer-binary --quiet 2>$null
      if ($LASTEXITCODE -eq 0) {
        Write-Ok "CLIP installe avec succes."
      } else {
        Write-Info "Echec de la pre-installation de CLIP -- le lancement plus bas tentera quand meme (et affichera l'erreur reelle dans le journal si ca echoue encore)."
      }
    }
  } else {
    Write-Info "Venv introuvable meme apres tentative de creation -- ce correctif sera tente par le webui lui-meme au lancement."
  }
} finally {
  $ErrorActionPreference = $prevErrorActionPreference
}

# ---------------------------------------------------------------------------
# 6. Make sure --api is enabled (idempotent: never adds it twice)
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
# 7. Launch and wait for the API to actually answer -- the first run
#    installs several GB of dependencies, so this is patient on purpose.
# ---------------------------------------------------------------------------

Write-Step "Lancement d'AUTOMATIC1111 (premier lancement = installation des dependances, soyez patient)"

# A previous run that hung (e.g. stuck on the "pause" prompt fixed above,
# from before this script redirected stdin) leaves its process alive on a
# re-run, still holding the log files open -- Remove-Item below would then
# fail with "used by another process" and abort the whole script, exactly
# as happened for real.
#
# Tracking a single PID (an earlier version of this fix) isn't enough:
# Start-Process -FilePath <webui-user.bat> returns cmd.exe's own PID, but
# cmd.exe runs python.exe as a child, and Stop-Process on a parent does NOT
# terminate its children on Windows -- the actual log-file handle is held
# by that orphaned python.exe, which would survive untouched. So instead of
# trusting one stored PID, this matches on command line (Win32_Process, not
# Get-Process, since only WMI/CIM exposes CommandLine) against this
# install's own path -- catching cmd.exe (whose command line is the .bat's
# path) and python.exe (whose command line is launch.py under this same
# folder) together, parent-child relationship or not.
$leftoverProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and ($_.CommandLine -like "*$ResolvedWebUiDir*") }
if ($leftoverProcesses) {
  foreach ($p in $leftoverProcesses) {
    Write-Info "Processus d'une execution precedente encore actif (PID $($p.ProcessId)) -- arret avant de relancer."
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
}

try {
  if (Test-Path $WebUiLogPath) { Remove-Item $WebUiLogPath -Force -ErrorAction Stop }
  if (Test-Path $WebUiErrLogPath) { Remove-Item $WebUiErrLogPath -Force -ErrorAction Stop }
} catch {
  Write-Fail "Impossible de supprimer les anciens journaux ($($_.Exception.Message)) -- un processus les a probablement encore ouverts. Fermez-le (verifiez le Gestionnaire des taches pour un python.exe ou cmd.exe lance depuis $ResolvedWebUiDir) puis relancez ce script."
  exit 1
}

# Two separate log files, not one shared by both streams: Start-Process
# refuses -RedirectStandardOutput and -RedirectStandardError pointing at the
# same file (hit and fixed for cloudflared in setup-ollama-bridge.ps1 --
# applied here from the start instead of re-discovering it the hard way).
#
# Redirecting stdin from an empty file matters just as much: webui-user.bat's
# own wrapper calls `pause` when a step fails, to keep a normal double-clicked
# window open so a person can read the error before it closes. Launched
# hidden with no redirected stdin, that pause instead waits forever for a
# keypress on a console window nobody can see or reach -- confirmed for
# real: a run that hit the pkg_resources failure above sat "still running"
# for 15+ minutes with no further progress, not because anything was slow,
# but because it was silently stuck at that prompt the whole time.
#
# -RedirectStandardInput "NUL" (the usual cmd.exe trick for this) does NOT
# work here -- also confirmed for real: PowerShell's Start-Process resolves
# "NUL" as a literal relative filename ("<workdir>\NUL") instead of the
# special device, and fails outright ("FileNotFoundException"). An actual
# empty file gives the same immediate-EOF result pause needs, without
# depending on that device-name resolution quirk.
if (-not (Test-Path $WebUiStdinPath)) { New-Item -ItemType File -Path $WebUiStdinPath -Force | Out-Null }
$webuiProcess = Start-Process -FilePath $WebUiUserBat -WorkingDirectory $ResolvedWebUiDir `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $WebUiLogPath -RedirectStandardError $WebUiErrLogPath -RedirectStandardInput $WebUiStdinPath

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
