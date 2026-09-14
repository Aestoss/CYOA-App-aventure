# Fogbound — ton app d'aventure IA (Phase 1-5 du plan)

## Ce qui est fait

- Backend complet (Node.js) : création de monde, tours de jeu, mémoire structurée, réglages
- Compétences de personnage (4-6 par monde) + choix d'un personnage jouable avant de commencer + résolution de réussite/échec par l'IA selon la compétence pertinente (voir `docs/INFINITE_WORLDS_REFERENCE.md`, Phase A)
- Conditions de victoire/défaite générées avec chaque monde, évaluées par l'IA à chaque tour ; l'histoire se termine proprement (bannière + blocage des tours suivants) quand l'une d'elles est atteinte, avec possibilité de continuer à jouer après une victoire (Phase B)
- Objets/état suivis (« tracked items ») typés par monde : inventaire, jauges de relation, etc., avec instructions de mise à jour dédiées et visibilité joueur/IA ou IA seule (état caché) (Phase C)
- Instructions principales + style d'auteur générés à la création du monde, éditables ensuite depuis l'écran d'histoire (✏️) (Phase D)
- PNJ enrichis (fiche complète, résumé court, apparence, lieu) — fiche complète transmise à l'IA seulement quand le PNJ est apparu récemment, sinon juste le résumé — et état caché (« secret info ») cumulatif jamais exposé au client (Phase E)
- Style visuel par monde (description + préfixe/suffixe) appliqué automatiquement à chaque prompt d'image généré par le narrateur, pour des illustrations visuellement cohérentes d'un tour à l'autre ; éditable comme les instructions (Phase F)
- Confort auteur : description + objectif affiché au joueur + image de couverture (générée si les images sont activées) + contenu mature/avertissements + numéro de version qui s'incrémente à chaque édition (Phase G)

Toutes les phases de la feuille de route `docs/INFINITE_WORLDS_REFERENCE.md` (A à G) sont implémentées et testées de bout en bout avec le fournisseur mock.

**Depuis, un second lot de fonctionnalités (voir `TODO.md`) :**
- **Monde vs sauvegarde** : un monde est désormais un modèle réutilisable — chaque nouvelle aventure démarrée depuis un monde crée une sauvegarde indépendante (ses propres objets suivis, personnages rencontrés, état caché...), sans jamais toucher aux autres sauvegardes du même monde.
- **Éditeur de monde complet**, ouvert automatiquement juste après la création : instructions, style, personnages jouables (ajout manuel, génération par IA, édition en ligne, suppression), et un bouton **« Retoucher avec l'IA »** pour des ajustements légers en langage naturel.
- **Suppression** de mondes (en cascade sur leurs sauvegardes) et de sauvegardes individuelles, avec confirmation.
- **Suivi des coûts** : jetons + estimation en $ par appel IA, visible dans Réglages.
- Barre de progression pendant la génération d'un monde.

**Puis un troisième lot (pagination façon Infinite Worlds, voir `TODO.md`) :**
- **Une page par tour**, navigable (‹ ›), plutôt qu'un flux continu.
- **Retour en arrière destructif** : reprendre depuis une page passée efface tout ce qui suit et restaure l'état exact du jeu à cet instant.
- **Régénérer le dernier tour** : action modifiée, ou action d'origine + note de recadrage pour l'IA.
- **Langue des réponses** (français/anglais) et **longueur des chapitres** (court/moyen/long) réglables.
- **Réussite/échec caché au joueur** par défaut.
- **Mode auteur** (🔓) : révèle l'état caché (secretInfo, objets IA-seule) et permet d'envoyer une instruction directe au narrateur, hors-personnage.
- **Mise en page plus lisible** (paragraphes) pour le texte généré.

- Frontend complet (une seule page web, installable sur téléphone)
- Système de prompts en couches (Master Prompt / World Bible / Mémoire / Tours récents), comme détaillé dans le plan
- Mémoire réelle : faits extraits stockés en base + résumé automatique tous les ~15-20 tours
- Toggle images marche/arrêt, fonctionnel
- Changement de fournisseur IA (Anthropic, OpenAI, OpenRouter, Google Gemini) et de modèle d'image (Stability, Replicate) depuis les Réglages, sans toucher au code
- Testé de bout en bout avec un "fournisseur factice" (mock) qui simule des réponses IA sans clé — donc tout le mécanisme (création de monde, mémoire, résumé, réglages) est déjà vérifié comme fonctionnel

## État actuel — déjà en ligne

L'app est déployée sur Railway et fonctionne : **https://fogbound-production.up.railway.app**
(connectée au dépôt GitHub `Aestoss/CYOA-App-aventure`). Le redéploiement
automatique sur push GitHub s'est montré peu fiable en pratique — si le site
ne reflète pas le dernier commit après un push, un redéploiement manuel
depuis le dashboard Railway (ou en redemandant ici) est nécessaire.

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
server.js               → routes de l'API
lib/db.js               → base de données (fichier JSON local) — mondes, sauvegardes, personnages...
lib/promptBuilder.js    → assemblage des prompts en couches
lib/gameEngine.js       → logique de jeu : mondes (templates), sauvegardes (parties), tours, mémoire
lib/pricing.js          → tarifs approximatifs $/1M tokens par fournisseur
lib/costTracker.js      → enregistrement et agrégation des coûts d'appels IA
providers/textProviders.js   → Anthropic / OpenAI / OpenRouter / Gemini / démo
providers/imageProviders.js  → Stability / Replicate / démo
public/                 → toute l'interface (HTML/CSS/JS), installable en PWA
docs/INFINITE_WORLDS_REFERENCE.md → analyse de référence d'Infinite Worlds + feuille de route
TODO.md                 → backlog de fonctionnalités demandées, à faire au fil de l'eau
```
