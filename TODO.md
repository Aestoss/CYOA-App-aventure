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

## Fait (15/09, second lot — langue baked-in, i18n menus, tabs, background popup)

- [x] **Langue de l'histoire figée par monde.** `world.language` est
      maintenant choisi au moment de la création (sélecteur sur l'onglet
      "Créer un monde", pré-rempli avec la langue courante des Réglages) et
      utilisé pour tous les tours suivants — au lieu de relire
      `settings.language` à chaque tour, qui pouvait entrer en conflit avec
      un World Bible déjà écrit dans une autre langue. La retouche IA
      (`aiEditWorld`) écrit aussi désormais dans la langue du monde. Les
      mondes déjà créés avant ce changement retombent sur `'fr'` par défaut.
- [x] **Menus/interface traduits (pas seulement le texte généré par l'IA).**
      Diagnostic confirmé par l'utilisateur : "pour l'anglais ça marche
      [le texte de l'histoire], mais pas le changement de langue dans les
      menus". Cause : tous les libellés (boutons, titres, placeholders)
      étaient codés en dur en français, `settings.language` ne pilotant que
      la langue demandée à l'IA. Ajout d'un petit système i18n côté client
      (`public/app.js` : dictionnaire `UI.fr`/`UI.en`, `t()`,
      `applyUiLanguage()`, attributs `data-i18n`/`data-i18n-placeholder`/
      `data-i18n-title` dans `public/index.html`) — Réglages → Langue des
      réponses bascule maintenant aussi la langue de toute l'interface,
      immédiatement, sans recharger la page.
- [x] **Emoji du mode auteur/secret changé** : 🔓 → 🔍 partout
      (`#authorModeBtn`, préfixe de `#secretInfoBox`, préfixe des objets
      suivis cachés en CSS).
- [x] **Page d'accueil réorganisée en 3 onglets** : "Créer un monde" / "Mes
      mondes" / "Mes sauvegardes" (`.home-tabs`), plutôt qu'un unique flux
      avec le bloc de création en bas. Onglet par défaut : "Mes
      sauvegardes" s'il y en a, sinon "Créer un monde".
- [x] **Popup "Background" + "première action" fixe + pré-chargement.**
      Le monde généré inclut maintenant `background` (texte long adressé au
      joueur, montré une fois dans une popup fixe après le choix du
      personnage) et `firstAction` (action fixe qui déclenche le vrai
      premier tour, généré par l'IA). Ordre retenu pour la question posée
      dans les notes : le personnage est choisi **avant** la popup, donc ce
      premier tour connaît déjà le personnage joué. L'appel IA du premier
      tour est lancé en parallèle dès l'affichage de la popup (pas seulement
      à sa fermeture) ; fermer la popup attend ce résultat s'il n'est pas
      encore prêt. Le chapitre d'ouverture gratuit (`opening_chapter`) reste
      utilisé tel quel pour les mondes créés avant ce changement (sans
      `background`) — pas de rupture rétroactive.
- [x] **Scroll automatique en haut à chaque nouveau tour/chapitre.**

Vérifié en navigateur réel (Playwright) : onglet par défaut correct,
sélecteur de langue à la création + ligne "Langue de ce monde" (non
éditable) dans l'éditeur, popup background affichée avec le texte généré
puis premier tour réel affiché après fermeture, bascule Réglages → English
traduisant immédiatement onglets/boutons/panneau de coûts, cycle complet
jeu/mode auteur/régénération/retour en arrière toujours fonctionnel, et
un monde "ancien" sans `background` repatché manuellement en base confirme
qu'il garde l'ancien chemin gratuit (aucune popup, aucun appel IA
supplémentaire).

## Pas encore fait

- [ ] **Pourquoi Infinite Worlds pagine par tour** — question de recherche
      devenue sans objet : on a implémenté la pagination directement sur
      demande, plutôt que d'étudier le rationnel avant. Retiré de la liste.
- [ ] **Barre de progression : la rendre réelle, pas juste cosmétique.**
      Actuellement (`startCreationProgress` dans `public/app.js`) c'est une
      barre en CSS qui glisse en boucle indéfiniment (`progress-slide`,
      1.2s) pendant que le texte défile sur 5 étapes fixes toutes les
      1.4s — aucun des deux n'est corrélé à ce qui se passe réellement côté
      serveur. Piste de correctif :
      - La génération d'un monde est aujourd'hui **un seul appel IA non
        streamé** (`callText` → attend la réponse JSON complète). Sans
        streaming, il n'existe strictement aucun signal de progression
        réel à afficher — n'importe quelle barre "réelle" basée sur ça
        serait en fait fausse elle aussi.
      - Pour une vraie progression, il faudrait faire streamer la
        génération (API Anthropic/OpenAI/Gemini le permettent toutes en
        SSE) et remonter les jetons reçus au fur et à mesure au client
        (SSE ou WebSocket depuis `server.js`), pour que la barre avance
        selon les jetons reçus / une estimation du total attendu (assez
        prévisible ici : le schéma JSON du monde a une taille à peu près
        stable). Ça permettrait aussi d'afficher un aperçu du texte qui
        s'écrit en direct plutôt qu'une barre abstraite — sans doute plus
        honnête et plus satisfaisant qu'un pourcentage approximatif.
      - Implique : streaming dans `providers/textProviders.js` (au moins
        pour le fournisseur utilisé à la création), une route ou un canal
        dédié pour pousser les deltas au client, et un calcul de
        progression approximatif côté client (jetons reçus vs. estimation).
        Changement non trivial ; à cadrer avant de s'y lancer (quel(s)
        fournisseur(s) prioriser, SSE vs WebSocket, que faire pour le
        fournisseur mock qui ne "streame" rien).
- [x] **Streamer le texte des chapitres au fur et à mesure, comme Infinite
      Worlds.** Fait le 15/09 — voir CHANGELOG.md. La barre de progression
      de création de monde (ci-dessus) pourrait réutiliser le même
      streaming maintenant que l'infrastructure existe côté
      `providers/textProviders.js`, mais ça reste à faire spécifiquement
      pour la route de création.
- [ ] **Slider de longueur des chapitres : granularité 100 → 1000 mots,
      par pas de 100.** Remplacer les 3 paliers actuels (court/moyen/long
      ≈ 200/400/800 mots, `CHAPTER_LENGTH_VALUES` dans `public/app.js`,
      `CHAPTER_LENGTHS` dans `lib/promptBuilder.js`) par un curseur
      continu de 100 à 1000 mots, un cran tous les 100 mots (10 positions).
      Implique de changer `chapterLength` de `'short'|'medium'|'long'`
      (enum) en nombre entier (mots cibles) partout où c'est utilisé :
      schéma par défaut (`lib/db.js`), validation dans `POST /api/settings`
      (`server.js`), et `buildMasterPrompt` (`lib/promptBuilder.js`) — qui
      demanderait alors une fourchette resserrée autour de N (ex. N-50 à
      N+50) au lieu d'une des 3 chaînes fixes actuelles. Côté UI : `<input
      type="range" min="100" max="1000" step="100">` avec le libellé
      affichant directement le nombre choisi.

---

## Notes pour plus tard

- ⚠️ **RAPPEL POUR LA SORTIE EN v1.0** (demandé explicitement par
  l'utilisateur — à faire quand il annoncera que le projet est fini, pas
  avant) : nettoyer Railway pour réduire les coûts d'utilisation —
  1. Supprimer l'historique des anciens déploiements du service
     `fogbound` (ne garder que le déploiement actif en production).
  2. Vérifier qu'aucun service/outil superflu ne tourne dans le projet
     Railway (ex. une solution de monitoring ou de gestion de logs
     ajoutée en cours de route qui coûterait sans être indispensable) —
     à l'heure de cette note, un seul service existe (`fogbound`), donc
     ça revient surtout à confirmer que rien d'autre n'a été ajouté
     depuis.
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
