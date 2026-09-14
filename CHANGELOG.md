# Changelog — Fogbound

Historique des changements livrés, du plus récent au plus ancien. Pour ce
qui est prévu mais pas encore fait, voir `TODO.md`. Les dates suivent les
commits Git ; les entrées sont groupées par lot de fonctionnalités plutôt
que commit par commit.

## 2026-09-14 — Portraits de personnage, éditeurs post-création, champs manquants

Termine la liste "vrais absents" de la repasse comparative avec Infinite
Worlds — seul reste volontairement de côté : Triggers/Keyword Instruction
Blocks (sous-système entier, effort trop élevé pour ce lot, en attente
d'un feu vert dédié).

- **Portrait par personnage jouable** : généré automatiquement à la
  création (monde et personnages IA) quand les images sont activées ;
  bouton "Régénérer le portrait" sinon ; affiché à l'écran de sélection et
  dans l'éditeur, jamais en jeu (comme Infinite Worlds). Génération
  d'images désactivée → erreur claire au lieu d'un plantage, génération
  automatique simplement sautée à la création.
- **Éditeur de tracked items après création** : ajouter/éditer/supprimer
  un objet suivi (inventaire, jauges...) sans repasser par une
  régénération complète du monde. Supprimer un objet nettoie les valeurs
  des sauvegardes existantes ; en ajouter un nouveau ne casse rien pour
  les parties en cours.
- **Éditeur de PNJ après création** : même chose pour les personnages non
  joueurs — les sauvegardes déjà commencées gardent leur propre copie.
- **Valeurs initiales de tracked items par personnage** : un personnage
  peut démarrer avec une valeur différente d'un objet suivi (ex. plus de
  confiance, plus d'argent) — appliqué au moment de choisir le personnage.
- **Champs directs** pour titre, skills, setting/tone/rules, conditions et
  textes de victoire/défaite (avant : retouche IA uniquement), texte
  additionnel à l'écran de sélection, notes de conception (idée d'origine,
  sans effet sur le jeu), modèle d'image par monde (Replicate ; Stability
  garde son endpoint fixe, pas de paramètre de modèle simple côté API).
- **Corrigé au passage** : l'estimation de coût Gemini (`lib/pricing.js`)
  utilisait un tarif obsolète, sous-évaluant le coût réel d'un facteur 10.

Vérifié de bout en bout : génération de portrait avec/sans images
activées, CRUD complet tracked items/PNJ via l'API et l'interface,
override de valeur initiale appliqué à la bonne sauvegarde (vérifié en
base), tous les nouveaux champs de l'éditeur pré-remplis et persistants,
texte de sélection de personnage affiché sur l'écran réel.

## 2026-09-14 — Éditeur de monde : champs jusque-là indirects rendus directement éditables

Suite à la repasse comparative avec Infinite Worlds (`docs/INFINITE_WORLDS_REFERENCE.md`,
section 5) : tout ce qui existait déjà dans le modèle de données mais
n'était éditable qu'en passant par la retouche IA (ou pas du tout visible)
a maintenant un champ dédié dans l'éditeur de monde.

- **Titre du monde** : champ texte direct (avant : renommer un monde exigeait
  une retouche IA).
- **Compétences (skills)** : petite liste éditable (ajouter/renommer/
  supprimer une compétence), au lieu de la retouche IA uniquement.
- **Setting / Ton / Règles du monde** : champs texte dédiés.
- **Conditions et textes de victoire/défaite** : quatre champs dédiés
  (vide = condition désactivée, comme avant).
- **Numéro de version** : affiché en lecture seule dans l'éditeur (existait
  déjà côté serveur, incrémenté à chaque édition, mais invisible jusqu'ici).
- **Image de couverture** : bouton pour la régénérer par IA après la
  création (avant : générée une seule fois, aucun moyen de la retoucher
  sans régénérer tout le monde).
- `background`/`firstAction` (popup d'intro + première action) rendus
  éditables également — oversight repéré en review juste après leur ajout.

Vérifié de bout en bout en navigateur réel : préremplissage de tous les
nouveaux champs à l'ouverture, sauvegarde, titre et version mis à jour
immédiatement après "Enregistrer", persistance confirmée après fermeture/
réouverture de l'éditeur, régénération de couverture (round-trip confirmé
avec le fournisseur factice, qui ne renvoie volontairement aucune image de
test).

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
