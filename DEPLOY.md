# Guide complet — de zéro à l'app installée sur ton téléphone

Ce guide est fait pour être suivi seul, sans que je sois là en direct.
Suis les étapes dans l'ordre ; chacune est indépendante, tu peux t'arrêter
et reprendre plus tard.

**Résumé en un coup d'œil :**

| Étape | Ce que tu fais | Temps |
|---|---|---|
| 0. Tester en local | Vérifier que tout marche sur ton PC + ton téléphone (via wifi) | ~5 min |
| 1. GitHub | Mettre le code en ligne dans un dépôt | ~5 min |
| 2. Railway | Héberger l'app pour de vrai, avec une adresse web | ~5 min |
| 3. Clés API | Connecter Claude (et une API d'image, en option) | ~5 min |
| 4. Téléphone | Installer l'app comme une icône sur ton écran d'accueil | ~1 min |

---

## Étape 0 — Tester en local (recommandé avant de mettre en ligne)

1. Dézippe `adventure-app.zip` (par ex. sur ton Bureau)
2. Ouvre VS Code → **Fichier → Ouvrir le dossier...** → choisis le dossier
   `adventure-app`
3. **Terminal → New Terminal** (en bas de VS Code)
4. Tape `npm install`, Entrée (une seule fois, ~10 sec)
5. Tape `npm start`, Entrée → tu dois voir *"Adventure app listening on
   port 3000"*
   - Si le pare-feu Windows demande une autorisation pour Node.js, clique
     **Autoriser l'accès**
6. Ouvre un deuxième terminal, tape `ipconfig`, note l'**Adresse IPv4** de
   ta machine (ex. `192.168.1.42`) — la même que celle que tu utilises déjà
   pour accéder à Ollama depuis ton téléphone
7. Sur ton téléphone (même wifi), ouvre `http://<cette-adresse>:3000`
8. Crée une histoire (mode "Démo locale", aucune clé requise), joue
   quelques tours, ouvre les Réglages ⚙ — vérifie que tout est confortable
   à l'usage sur l'écran

Si quelque chose coince ici, inutile d'aller plus loin — dis-le moi et on
corrige avant la mise en ligne.

---

## Étape 1 — Mettre le code sur GitHub

### Option A — la plus simple : VS Code (tu l'as déjà installé)

1. Dans VS Code (dossier `adventure-app` toujours ouvert), clique l'icône
   **Source Control** dans la barre de gauche (icône avec des branches)
2. Clique **"Publish to GitHub"**
3. La première fois, ton navigateur s'ouvre pour te connecter à GitHub —
   connecte-toi, ou crée un compte gratuit si besoin
4. Choisis **Private** (recommandé) ou Public
5. VS Code crée le dépôt et envoie tous les fichiers automatiquement

Aucune commande à taper. Passe à l'Étape 2.

### Option B — avec le script fourni

1. Crée un compte GitHub gratuit sur [github.com](https://github.com)
2. Clique **New repository**, donne-lui un nom (ex. `fogbound`), laisse-le
   **vide** (aucune case cochée), clique **Create repository**
3. Copie l'URL affichée (ex. `https://github.com/tonpseudo/fogbound.git`)
4. Dans le dossier `adventure-app` : clic droit → **"Git Bash Here"** (ou
   utilise le terminal déjà ouvert dans VS Code)
5. Lance :
   - Git Bash : `bash scripts/push-to-github.sh`
   - PowerShell : `powershell -ExecutionPolicy Bypass -File scripts\push-to-github.ps1`
6. Colle l'URL copiée à l'étape 3 quand demandé
7. Connecte-toi si une fenêtre GitHub s'ouvre dans ton navigateur

---

## Étape 2 — Héberger sur Railway

1. Va sur [railway.app](https://railway.app) → **Login** → connecte-toi
   avec ton compte GitHub (même identifiants, rien de nouveau à créer)
2. **New Project → Deploy from GitHub repo**
3. Choisis le dépôt `fogbound` (ou le nom donné à l'étape 1)
4. Railway détecte que c'est une app Node.js et la déploie automatiquement
   — attends que le statut passe au vert (~1-2 min)
5. Onglet **Settings** du service → **Networking** → **Generate Domain**
   → tu obtiens un lien du type `fogbound-production.up.railway.app`

Garde ce lien — c'est l'adresse permanente de ton app, accessible de
n'importe où (plus besoin d'être sur le même wifi que ton PC).

---

## Étape 3 — Connecter tes clés API

1. Ouvre le lien Railway obtenu à l'étape 2 (dans un navigateur, PC ou
   téléphone)
2. Va dans **Réglages ⚙**
3. **Texte** : choisis "Anthropic (Claude)", colle ta clé API Anthropic
4. **Images** (optionnel) : active le toggle, choisis "Stability AI" ou
   "Replicate", colle la clé correspondante
5. **Enregistrer**

Les clés sont stockées sur le serveur Railway uniquement — jamais dans le
code, jamais sur GitHub.

*(Tu n'as pas encore de clé Anthropic ? Crée un compte sur
[console.anthropic.com](https://console.anthropic.com), section API Keys —
je peux détailler cette partie si besoin.)*

---

## Étape 4 — Installer sur ton téléphone

1. Ouvre le lien Railway sur ton téléphone
2. Menu du navigateur → **"Ajouter à l'écran d'accueil"**
3. Une icône Fogbound apparaît, s'ouvre en plein écran comme une vraie app

---

## Mises à jour futures

Si je te donne une nouvelle version du code : republie-la avec la même
méthode qu'à l'Étape 1 (Option A ou B) — Railway redéploie automatiquement
à chaque nouvel envoi sur GitHub, sans rien faire de plus de ton côté.

---

## Pourquoi certaines étapes restent manuelles

Je n'ai pas accès à ton compte GitHub ni à un compte Railway — aucun
identifiant, aucun connecteur disponible ici pour le faire à ta place.
Chaque étape ci-dessus est réduite au minimum de clics possible ; aucune
n'exige d'écrire de code.
