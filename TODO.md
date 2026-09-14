# TODO — Fogbound

Backlog de fonctionnalités demandées, à implémenter seulement quand
explicitement demandé (rien ici n'est fait tant que la case n'est pas cochée).
Ce fichier s'alimente au fil des demandes — ne pas hésiter à en rajouter.

## Fait (lot du 14/09 — monde/sauvegarde, éditeur, coûts)

- [x] Barre de progression pendant la génération d'un monde (indéterminée).
- [x] Ouvrir l'éditeur de monde juste après la création.
- [x] Édition des personnages depuis l'écran de sélection de personnage.
- [x] Bouton "Ajouter un personnage" dans l'éditeur de monde.
- [x] Bouton "Générer un personnage par IA" dans l'éditeur.
- [x] Bouton "Retoucher avec l'IA" dans l'éditeur de monde.
- [x] Distinguer "monde" (modèle réutilisable) et "sauvegarde" (partie en
      cours indépendante).
- [x] Suppression des mondes/sauvegardes (cascade + confirmation).
- [x] Suivi des coûts de génération (jetons + estimation $, Réglages → Coûts).

## Fait (second lot du 14/09 — pagination, retour en arrière, régénération)

- [x] **Pagination façon Infinite Worlds** : chaque tour est une page
      (`GET /api/saves/:id` renvoie tous les tours, un seul affiché à la fois),
      navigation ‹ › avec indicateur "Page N / Total".
- [x] **Longueur des chapitres réglable** : slider dans Réglages
      (court ~200 mots / moyen ~400 / long ~800 mots).
- [x] **Retour en arrière destructif** : depuis une page passée, "⏪ Reprendre
      à partir d'ici" supprime tout ce qui suit (tours, faits mémorisés) et
      restaure exactement l'état du jeu (objets suivis, personnages, secret)
      à cet instant, via un instantané stocké sur chaque tour
      (`turn.snapshot`, `rewindToTurn` dans `lib/gameEngine.js`).
- [x] **Régénérer un tour** (🔄 sur la dernière page uniquement) : soit en
      modifiant l'action envoyée à l'IA, soit en gardant l'action d'origine
      et en ajoutant une note de recadrage ("je veux qu'il se passe plutôt...")
      — les deux passent par `regenerateTurn` (rewind + rejoue).
- [x] **Sélection de la langue** des réponses (français/anglais) dans Réglages.
- [x] **Réussite/échec caché au joueur par défaut** — `outcome`/`skillUsed`
      ne sont plus renvoyés par l'API sauf en mode auteur.
- [x] **Mode auteur** (🔓 dans la vue histoire) : révèle secretInfo et les
      objets `ai_only` (par page, via l'instantané du tour), et transforme la
      zone de saisie en instruction directe au narrateur (hors-personnage,
      pas de jet de compétence) plutôt qu'une action du personnage.
- [x] **Mise en page plus lisible** : consigne de paragraphes courts dans le
      prompt + découpage du texte en `<p>` côté affichage (au lieu d'un bloc
      unique où les retours à la ligne ne s'affichaient pas).

Testé de bout en bout en navigateur réel (Playwright) : réglages langue/
longueur persistants → création → pagination (précédent/suivant, désactivation
aux bornes) → mode auteur (secretInfo visible + instruction directe) →
régénération (action modifiée, puis note seule) → retour en arrière destructif
depuis une page passée → victoire → continuer. Un vrai bug a été trouvé et
corrigé pendant le test (le conteneur des actions de la dernière page n'avait
pas de règle CSS `.hidden`, donc restait visible même masqué en JS).

## Pas encore fait

- [ ] **Pourquoi Infinite Worlds pagine par tour** — question de recherche
      devenue sans objet : on a implémenté la pagination directement sur
      demande, plutôt que d'étudier le rationnel avant. Retiré de la liste.

## Retours de relecture (14/09, session suivante)

- [ ] **La langue ne s'applique pas correctement.** Choisir "English" dans
      Réglages ne suffit pas si le monde a été créé à partir d'une idée
      tapée en français : le reste du contexte envoyé à l'IA à chaque tour
      (World Bible, instructions principales, scènes récentes) reste dans
      la langue de création du monde, et l'IA a tendance à continuer dans
      cette langue dominante malgré la consigne contraire. Diagnostic
      donné à l'utilisateur en session ; correctif proposé ci-dessous.
- [ ] **Emoji du mode auteur/secret à changer** : remplacer 🔓 (cadenas) par
      🔍 (loupe) — jugé plus esthétique. Concerne le bouton `#authorModeBtn`
      et le préfixe dans `#secretInfoBox` (`public/app.js`,
      `public/index.html`).

---

## Notes pour plus tard

- Le retour en arrière est volontairement destructif (pas de branches) —
  si le besoin de garder plusieurs versions en parallèle apparaît un jour,
  il faudra revoir `rewindToTurn` pour dupliquer la sauvegarde au lieu de
  tronquer `turns` sur place.
- Le mode auteur est une bascule de session (variable JS `debugModeOn`,
  jamais persistée) — s'il doit un jour survivre à un rechargement de page,
  prévoir un paramètre d'URL ou un stockage local.
- La régénération ne s'applique qu'à la dernière page (pas aux pages
  passées) — pour regénérer un tour plus ancien, il faut d'abord "reprendre
  à partir d'ici" juste avant, puis rejouer.
- **Correctif proposé pour la langue** : arrêter de traiter la langue comme
  un réglage global relu à chaque tour, et la figer sur le monde au moment
  de sa création (comme `tone` ou `skills`) — stocker `world.language` et
  toujours l'utiliser pour ce monde, plutôt que de laisser le réglage
  courant entrer en conflit avec un contexte déjà écrit dans une autre
  langue. Ça implique : ajouter un choix de langue au moment de créer un
  monde (pas seulement dans Réglages), passer `world.language` à
  `buildTurnPrompt` au lieu de `settings.language`, et assumer qu'un monde
  déjà créé garde sa langue (pas de traduction rétroactive du World Bible/
  des tours passés — trop coûteux et fragile pour la valeur apportée).
