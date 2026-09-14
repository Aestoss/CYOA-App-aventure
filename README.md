# Fogbound — ton app d'aventure IA (Phase 1-5 du plan)

## Ce qui est fait

- Backend complet (Node.js) : création de monde, tours de jeu, mémoire structurée, réglages
- Frontend complet (une seule page web, installable sur téléphone)
- Système de prompts en couches (Master Prompt / World Bible / Mémoire / Tours récents), comme détaillé dans le plan
- Mémoire réelle : faits extraits stockés en base + résumé automatique tous les ~15-20 tours
- Toggle images marche/arrêt, fonctionnel
- Changement de fournisseur IA (Anthropic, OpenAI, OpenRouter, Google Gemini) et de modèle d'image (Stability, Replicate) depuis les Réglages, sans toucher au code
- Testé de bout en bout avec un "fournisseur factice" (mock) qui simule des réponses IA sans clé — donc tout le mécanisme (création de monde, mémoire, résumé, réglages) est déjà vérifié comme fonctionnel

## État actuel — déjà en ligne

L'app est déployée sur Railway et fonctionne : **https://fogbound-production.up.railway.app**
(connectée au dépôt GitHub `Aestoss/CYOA-App-aventure`, redéploiement
automatique à chaque push sur `main`).

Il reste deux choses pour que ce soit vraiment "ton" app au quotidien :

1. **Coller une vraie clé API** dans Réglages ⚙ en ligne (Anthropic, OpenAI
   ou OpenRouter) — pour l'instant le service tourne en mode "Démo locale"
   (`mock`), donc les histoires ne sont pas encore générées par une IA
   réelle. Jamais dans le code, jamais sur GitHub.
2. **Stockage persistant** : le service Railway n'a pas encore de volume
   attaché. Sans ça, la base de données (fichier JSON local, voir
   `lib/db.js`) est réinitialisée à chaque redéploiement — tu perdrais tes
   histoires en cours à la prochaine mise à jour du code. Voir DEPLOY.md
   pour l'ajouter (5 min, quelques clics dans Railway).

Une fois ces deux points réglés : ouvre le lien sur ton téléphone →
"Ajouter à l'écran d'accueil".

## Comment j'ai testé (pour référence)

Avec le "fournisseur factice" (`mock`, actif par défaut, sans clé requise) :
- Créé un monde ("Le Phare de Verre") → World Bible générée et stockée
- Joué plusieurs tours → texte, mémoire de personnage, actions suggérées
- Joué 21 tours d'affilée → confirmé que le résumé automatique se déclenche
  et compresse l'historique ancien
- Changé de fournisseur texte/image et activé le toggle image via
  `/api/settings` → confirmé que le changement est pris en compte
- Vérifié qu'une clé API n'est jamais renvoyée en clair au frontend

## Essayer toi-même dès maintenant (optionnel, sans rien installer de neuf)

Si tu as déjà Node.js sur ton PC (celui qui fait tourner Ollama), tu peux
tester en local avant même la mise en ligne :

```
cd adventure-app
npm install
npm start
```

Puis ouvre `http://localhost:3000` dans le navigateur. Le mode "Démo locale
(sans clé)" fonctionne tout de suite. Pour utiliser Claude ou GPT-4 pour de
vrai, va dans Réglages ⚙, choisis le fournisseur et colle ta clé API.

## Structure du projet

```
server.js              → routes de l'API
lib/db.js               → base de données (fichier JSON local)
lib/promptBuilder.js    → assemblage des prompts en couches
lib/gameEngine.js       → logique de jeu : tours, mémoire, résumé
providers/textProviders.js   → Anthropic / OpenAI / OpenRouter / démo
providers/imageProviders.js  → Stability / Replicate / démo
public/                 → toute l'interface (HTML/CSS/JS), installable en PWA
```
