# push-to-github.ps1
# A executer UNE FOIS pour publier ce projet sur GitHub.
# Comment l'utiliser : voir DEPLOY.md (option B).

Write-Host "== Fogbound : publication sur GitHub ==" -ForegroundColor Cyan

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git n'est pas installe sur cette machine." -ForegroundColor Red
    Write-Host "Installe-le depuis https://git-scm.com/download/win (installeur graphique, Suivant-Suivant-Terminer), puis relance ce script." -ForegroundColor Yellow
    exit 1
}

$repoUrl = Read-Host "Colle ici l'URL de ton depot GitHub VIDE (ex: https://github.com/tonpseudo/fogbound.git)"

if ([string]::IsNullOrWhiteSpace($repoUrl)) {
    Write-Host "Aucune URL fournie, arret du script." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path ".git")) {
    git init
    git branch -M main
}

git add .
git commit -m "Fogbound - version initiale" 2>$null

git remote remove origin 2>$null
git remote add origin $repoUrl

Write-Host "Envoi vers GitHub... une fenetre de connexion peut s'ouvrir dans ton navigateur, connecte-toi si demande." -ForegroundColor Yellow
git push -u origin main

Write-Host "Termine. Va sur ton depot GitHub pour verifier que les fichiers sont bien la." -ForegroundColor Green
