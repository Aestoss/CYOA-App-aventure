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
- [ ] **Popup "Background" au lancement d'une aventure** (comme dans
      Infinite Worlds) : un nouveau champ de monde, long et distinct des
      champs existants —
      - différent de `description` (résumé court affiché dans la liste des
        mondes) ;
      - différent de `instructions` (s'adresse à l'IA, pas au joueur) ;
      - c'est un texte narratif adressé au **joueur**, montré dans une
        popup fixe (identique à chaque nouvelle aventure sur ce monde) qui
        explique le contexte de l'histoire, l'enjeu, pourquoi le
        personnage en est là.
      Généré une fois à la création du monde (comme le reste), éditable
      dans l'éditeur de monde.
- [ ] **"Première action" fixe par monde** : un texte d'action prédéterminé
      (généré/éditable comme le reste, toujours identique pour ce monde),
      utilisé pour déclencher la génération du tout premier tour réel par
      l'IA — au lieu du chapitre d'ouverture actuel, pré-écrit une seule
      fois à la création du monde et simplement recopié tel quel dans
      chaque nouvelle sauvegarde.
- [ ] **Pré-chargement pendant la lecture du background** : pendant que le
      joueur lit la popup, l'appel IA pour générer ce premier tour se
      lance déjà en parallèle, pour que le monde (texte + 3 actions
      suggérées) soit prêt dès qu'on ferme la popup — pas de temps de
      chargement visible après.
- [ ] **Réorganiser la page d'accueil** : remonter le bloc de création de
      monde tout en haut de la page (avant la liste des sauvegardes et des
      mondes, pas après).
- [ ] **Page d'accueil en onglets séparés** (une fois qu'il y aura beaucoup
      de mondes/sauvegardes, ça deviendra difficile à suivre en une seule
      page) : trois onglets navigables — "Créer un monde", "Mes mondes",
      "Mes sauvegardes" — le plus esthétique et intuitif possible plutôt
      qu'un simple `<select>` d'onglets basique.
- [ ] **Remonter automatiquement en haut de la page à chaque génération
      d'un nouveau chapitre/tour** — actuellement après avoir joué une
      action (ou une régénération), le scroll reste là où il était ; il
      faudrait que la vue histoire remonte en haut (scroll to top) dès
      que le nouveau tour s'affiche, pour commencer la lecture du chapitre
      depuis le début sans avoir à remonter manuellement.

## Fait (15/09 — crash JSON brut, flèches de pagination invisibles)

- [x] **Bug d'affichage : les flèches ‹ › de pagination étaient quasi
      invisibles.** Confirmé par capture d'écran de l'utilisateur (l'erreur
      brute apparaissait juste en dessous, voir point suivant). Cause :
      sur une sauvegarde à un seul tour, les DEUX flèches étaient
      désactivées en même temps à 30% d'opacité sur un gris déjà discret.
      Corrigé : la barre `#pageNav` est maintenant entièrement masquée
      quand il n'y a qu'une seule page, et les flèches actives ont un
      contour/texte couleur accent nettement visible par rapport à l'état
      désactivé. Vérifié en navigateur réel (Playwright) : masquée sur une
      sauvegarde fraîche (1 tour), visible avec un net contraste dès 2
      tours.
- [x] **Crash "Unexpected token 'u', "upstream error" is not valid JSON"
      affiché brut au joueur** (capture d'écran fournie par l'utilisateur).
      Cause réelle : un appel IA long peut voir sa réponse HTTP tronquée/
      remplacée par un texte d'erreur (proxy Railway, coupure réseau) alors
      même que le serveur a déjà fini et enregistré le tour avec succès —
      le `res.json()` non protégé plantait alors avec ce message brut.
      Corrigé : chaque appel réseau lié à une sauvegarde (jouer un tour,
      régénérer, continuer, revenir en arrière) analyse maintenant la
      réponse de façon défensive, et en cas d'échec, re-récupère la
      sauvegarde et compare `updatedAt` à sa valeur d'avant l'appel — si le
      serveur a bien réussi entre-temps, le vrai résultat s'affiche au lieu
      d'une erreur (sinon, un message lisible s'affiche, plus jamais
      l'erreur JS brute). Testé en navigateur réel avec une réponse
      simulée corrompue après un vrai succès serveur : la page se met bien
      à jour avec le contenu réel, sans erreur visible.
      Concernant "le mode page ne s'active pas avant de faire une
      régénération" : audit du code n'a trouvé aucune voie
      d'affichage concaténé/historique (rien de type `chapterFeed` ou
      boucle sur tous les tours) — et un test en navigateur réel confirme
      que la pagination est active dès le tour 1, sans lien avec une
      régénération. Hypothèse retenue : un onglet resté ouvert avec
      l'ancien JS chargé avant ce lot de fonctionnalités (une PWA ne
      recharge pas son script tant que l'onglet reste ouvert) — pas un
      problème d'architecture. À confirmer avec l'utilisateur après un
      rechargement complet de la page.

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
- **Background + première action** : ça change le modèle actuel où le
  chapitre d'ouverture est gratuit (pré-écrit une fois à la création du
  monde, recopié à l'identique dans chaque sauvegarde). Si le premier tour
  devient un vrai appel IA déclenché par la "première action", ça coûte un
  appel par nouvelle aventure — mais permet un tour d'ouverture qui connaît
  déjà le personnage choisi (plus personnalisé). Point à trancher avant
  d'implémenter : le choix du personnage doit-il se faire *avant* la popup
  background (pour que ce premier tour le connaisse), ou le premier tour
  reste-t-il générique comme aujourd'hui ? Ça détermine si "première
  action" doit rester neutre (comme `opening_chapter` actuellement) ou peut
  référencer le personnage.
