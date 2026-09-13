#!/bin/bash
# push-to-github.sh
# A executer UNE FOIS pour publier ce projet sur GitHub (via Git Bash).
# Comment l'utiliser : voir DEPLOY.md (option B).

set -e
echo "== Fogbound : publication sur GitHub =="

if ! command -v git &> /dev/null; then
  echo "Git n'est pas installe. Installe-le depuis https://git-scm.com/download/win puis relance ce script."
  exit 1
fi

read -p "Colle ici l'URL de ton depot GitHub VIDE (ex: https://github.com/tonpseudo/fogbound.git) : " REPO_URL

if [ -z "$REPO_URL" ]; then
  echo "Aucune URL fournie, arret du script."
  exit 1
fi

if [ ! -d ".git" ]; then
  git init
  git branch -M main
fi

git add .
git commit -m "Fogbound - version initiale" || true

git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"

echo "Envoi vers GitHub... une fenetre de connexion peut s'ouvrir dans ton navigateur."
git push -u origin main

echo "Termine. Va sur ton depot GitHub pour verifier que les fichiers sont bien la."
