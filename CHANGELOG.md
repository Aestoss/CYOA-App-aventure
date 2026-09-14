# Changelog — Fogbound

Historique des changements livrés, du plus récent au plus ancien. Pour ce
qui est prévu mais pas encore fait, voir `TODO.md`. Les dates suivent les
commits Git ; les entrées sont groupées par lot de fonctionnalités plutôt
que commit par commit.

## 2026-09-14 — Langue par monde, interface traduite, onglets, popup d'intro

- **Langue figée par monde** : choix de langue au moment de créer un monde
  (au lieu d'un réglage global relu à chaque tour, qui entrait en conflit
  avec un monde déjà écrit dans une autre langue).
- **Interface traduite** : les menus/boutons/labels suivent maintenant la
  langue choisie dans Réglages, pas seulement le texte généré par l'IA.
- **Page d'accueil en 3 onglets** : Créer un monde / Mes mondes / Mes
  sauvegardes, avec la création remontée en premier.
- **Popup "Background" + première action fixe** : à la sélection du
  personnage, une popup présente le contexte de l'histoire pendant que le
  vrai premier chapitre se génère par IA derrière (préchargé), plutôt que
  l'ancien chapitre d'ouverture générique et statique.
- Scroll automatique en haut de page à chaque nouveau tour généré.
- Emoji du mode auteur/secret : 🔓 → 🔍.

## 2026-09-14 — Correctifs pagination et robustesse réseau

- Correction d'un crash affichant une erreur JSON brute au joueur quand la
  réponse d'un appel IA long était tronquée par un problème réseau/proxy —
  le client détecte maintenant si le serveur a réussi malgré tout et
  affiche le vrai résultat au lieu d'une erreur.
- Correction des flèches de pagination (‹ ›) quasi invisibles sur une
  sauvegarde à une seule page.

## 2026-09-14 — Pagination façon Infinite Worlds, retour en arrière, régénération

- Chaque tour devient une page navigable (‹ ›) plutôt qu'un flux continu.
- Retour en arrière destructif : reprendre depuis une page passée efface
  tout ce qui suit et restaure l'état exact du jeu à cet instant.
- Régénération d'un tour : action modifiée, ou action d'origine + note de
  recadrage pour l'IA.
- Longueur des chapitres réglable (court/moyen/long) et langue des
  réponses (français/anglais) dans Réglages.
- Réussite/échec caché au joueur par défaut ; mode auteur (🔓) pour révéler
  l'état caché et parler directement au narrateur.
- Mise en page du texte généré plus lisible (paragraphes).

## 2026-09-14 — Monde vs sauvegarde, éditeur, coûts

- Séparation "monde" (modèle réutilisable) / "sauvegarde" (partie en cours
  indépendante) — un monde peut désormais lancer plusieurs aventures
  indépendantes.
- Éditeur de monde complet (instructions, style, personnages jouables :
  ajout manuel, génération IA, édition, suppression) ouvert automatiquement
  après la création.
- Retouche IA d'un monde existant (ajustements légers en langage naturel).
- Suppression de mondes (en cascade) et de sauvegardes individuelles.
- Suivi des coûts IA (jetons + estimation $) dans Réglages.
- Barre de progression pendant la génération d'un monde.

## 2026-09-14 — Fondations (Phases A à G)

Implémentation initiale de la feuille de route définie dans
`docs/INFINITE_WORLDS_REFERENCE.md` :

- **A** — Compétences de personnage, choix du personnage jouable,
  résolution de réussite/échec par l'IA.
- **B** — Conditions de victoire/défaite, possibilité de continuer à jouer
  après une victoire.
- **C** — Objets/état suivis typés (inventaire, jauges...), visibilité
  joueur/IA ou IA seule.
- **D** — Instructions principales et style d'auteur, éditables après
  création.
- **E** — PNJ enrichis (fiche complète vs résumé court selon la
  récence) et état caché (`secretInfo`) jamais exposé au client.
- **F** — Style visuel par monde appliqué automatiquement à chaque prompt
  d'image.
- **G** — Confort auteur : description, objectif, image de couverture,
  contenu mature, numéro de version.
- Ajout de Google Gemini comme fournisseur de texte.
- Correctif : modèle Gemini par défaut retiré par Google, remplacé.

## 2026-09-13 — Version initiale

- Backend Node.js/Express, mémoire structurée par couches (Master Prompt /
  World Bible / faits mémorisés / tours récents) avec résumé automatique.
- Frontend PWA (une page, installable sur téléphone).
- Fournisseurs texte (Anthropic, OpenAI, OpenRouter, Gemini, démo locale
  sans clé) et image (Stability, Replicate, démo) interchangeables depuis
  Réglages.
- Déploiement sur Railway, connecté à `Aestoss/CYOA-App-aventure`.
