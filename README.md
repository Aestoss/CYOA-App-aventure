# Fogbound — ton app d'aventure IA (Phase 1-5 du plan)

## Ce qui est fait

- Backend complet (Node.js) : création de monde, tours de jeu, mémoire structurée, réglages
- Frontend complet (une seule page web, installable sur téléphone)
- Système de prompts en couches (Master Prompt / World Bible / Mémoire / Tours récents), comme détaillé dans le plan
- Mémoire réelle : faits extraits stockés en base + résumé automatique tous les ~15-20 tours
- Toggle images marche/arrêt, fonctionnel
- Changement de fournisseur IA (Anthropic, OpenAI, OpenRouter) et de modèle d'image (Stability, Replicate) depuis les Réglages, sans toucher au code
- Testé de bout en bout avec un "fournisseur factice" (mock) qui simule des réponses IA sans clé — donc tout le mécanisme (création de monde, mémoire, résumé, réglages) est déjà vérifié comme fonctionnel

## Ce qui manque encore pour que ce soit "ton" app, en ligne

Ceci n'est pas encore déployé sur internet — c'est le code complet, testé
en local dans mon environnement de travail. Il reste une étape unique de
mise en ligne, que je peux faire avec toi pas à pas la prochaine fois :

1. Créer un compte gratuit sur Railway ou Render
2. Connecter ce code (je peux le pousser sur un dépôt GitHub pour toi)
3. Coller tes clés API (Anthropic, et Stability si tu veux les images) dans
   les réglages en ligne — jamais dans le code
4. Ouvrir le lien obtenu sur ton téléphone → "Ajouter à l'écran d'accueil"

Aucune de ces étapes ne demande de terminal ou de ligne de commande de ton
côté — seulement des clics dans des interfaces web.

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
