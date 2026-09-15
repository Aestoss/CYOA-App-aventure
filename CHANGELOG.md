# Changelog — Fogbound

Historique des changements livrés, du plus récent au plus ancien. Pour ce
qui est prévu mais pas encore fait, voir `TODO.md`. Les dates suivent les
commits Git ; les entrées sont groupées par lot de fonctionnalités plutôt
que commit par commit.

## 2026-09-15 — Ajout de 2 modèles Gemini à la liste déroulante

Ajout de `gemini-3.5-flash-lite` (utilisé et confirmé fonctionnel pendant
les tests réels de ce jour) et `gemma-4-31b-it` (Gemma 4, sorti en avril
2026, servi via la même API Gemini) aux préréglages du menu déroulant de
modèle. L'ID exact de Gemma a été vérifié par recherche avant ajout,
après l'incident précédent où `gemini-3.6-pro` (un ID inventé/inexistant)
s'était retrouvé dans les préréglages. Le libellé de Gemma note
explicitement que le format de réponse attendu (chapitre + bloc META) n'est
pas fiablement respecté par ce modèle, observé pendant les tests.

## 2026-09-15 — Correctif : le chapitre affiché se terminait par "===META"

Signalé par l'utilisateur en conditions réelles (Haiku 4.5) : le texte
streamé se terminait quasiment systématiquement par un fragment du
marqueur de fin, du type "===MET" ou "===META", visible par le joueur.

Cause : `forwardChapterChunk` (`lib/gameEngine.js`) décidait si le texte
reçu jusqu'ici pouvait être affiché en cherchant `===META===` dans le
buffer accumulé (`indexOf`) -- mais tant que le marqueur n'est pas
*entièrement* arrivé, `indexOf` renvoie -1, exactement comme s'il n'allait
jamais arriver. Si la coupure entre deux morceaux du flux tombait pile au
milieu du marqueur (ex: un morceau se terminant par "...\n===MET", le
suivant commençant par "A===\n{...}"), le fragment "===MET" était
considéré comme du texte de chapitre normal et affiché au joueur -- sans
aucun moyen de le retirer une fois déjà affiché.

Corrigé en retenant systématiquement les 9 derniers caractères du buffer
tant que le marqueur complet n'a pas été trouvé (la longueur de
"===META===" moins un caractère) -- juste assez pour ne jamais pouvoir
afficher un préfixe du marqueur, avec un délai totalement imperceptible
pour le lecteur. Vérifié avec plusieurs découpages volontairement
pathologiques du marqueur (coupé en deux au milieu, coupé caractère par
caractère) contre la logique exacte du correctif : aucune fuite dans
aucun cas, texte final identique au cas de référence en un seul morceau.
Revérifié aussi de bout en bout via `playTurnStreaming` (fournisseur mock).

## 2026-09-15 — Correctif : les 3 actions suggérées disparaissaient parfois

Bug de fond dans le format streaming introduit ce jour même (chapitre en
texte brut + petit bloc JSON `===META===`), signalé par l'utilisateur après
plusieurs tours en conditions réelles : le texte du chapitre s'affichait
normalement mais les 3 actions suggérées en bas de tour n'apparaissaient
plus, sans erreur visible.

Reproduit en isolant `splitNarrationResponse` (`lib/promptBuilder.js`) :
si le modèle ajoute le moindre texte après l'accolade fermante du JSON
`===META===` (un simple mot de politesse en fin de réponse -- un tic
courant chez beaucoup de modèles malgré la consigne "no other text before
or after"), `JSON.parse` échouait sur la totalité de la chaîne restante.
Le correctif précédent contre le plantage sur META tronqué (voir plus bas)
avalait alors silencieusement cette erreur et repartait sur les valeurs par
défaut (`suggested_actions: []`) -- sans le moindre log, donc invisible en
prod. C'est exactement le scénario du plantage initial, sauf que cette
fois-ci le JSON était parfaitement valide, juste suivi de texte parasite.

Corrigé en ajoutant une extraction robuste : si le `JSON.parse` direct
échoue, on cherche le premier objet `{...}` correctement équilibré dans le
texte restant (en ignorant les accolades à l'intérieur des chaînes) et on
retente dessus avant d'abandonner sur les valeurs par défaut. Un
`console.warn` avec le début du META brut est maintenant émis si
l'abandon a quand même lieu, pour que ce cas reste diagnosticable dans les
logs Railway au lieu d'être totalement silencieux.

Vérifié par 5 cas construits directement contre `splitNarrationResponse`
(texte parasite après le JSON, JSON encadré de ``` ```json ```, cas bien
formé de référence, META réellement tronqué, marqueur jamais reçu) puis par
un test de bout en bout via `playTurnStreaming` avec le fournisseur mock
(création de monde, tour joué, actions suggérées bien présentes en sortie).

## 2026-09-15 — Correctifs du pont PC (tunnel Cloudflare)

Trois bugs découverts en testant `setup-ollama-bridge.ps1` sur une vraie
machine Windows (jamais exécutable dans ce bac à sable) :

- **Mauvaise URL de tunnel capturée** : cloudflared écrit dans ses logs
  son propre point de terminaison de contrôle (`https://api.trycloudflare.com`)
  avant d'afficher le nom d'hôte réellement assigné au tunnel (toujours un
  sous-domaine à plusieurs mots séparés par des tirets, jamais un mot seul
  comme "api"). L'expression régulière capturait la première correspondance
  trouvée -- donc systématiquement la mauvaise URL -- et le script testait
  ensuite une adresse qui n'était jamais reliée au proxy local, d'où le
  405. Corrigé en exigeant au moins un tiret dans le sous-domaine et en
  prenant la dernière correspondance trouvée.
- **Jeton correct rejeté avec 401 (bug de fond, présent depuis le début)** :
  une fois le DNS résolu, l'appel authentifié via le tunnel échouait encore
  en 401 avec le *bon* jeton. Reproduit et confirmé en local (Caddy installé
  et testé dans le bac à sable) : Caddy trie les directives d'un bloc selon
  un ordre de priorité fixe qui lui est propre, **pas** selon l'ordre
  d'écriture dans le Caddyfile -- et `respond` est trié *avant*
  `reverse_proxy`. Le `respond "Unauthorized" 401` final (sans matcher, donc
  qui correspond à toute requête) s'exécutait donc en premier sur chaque
  requête, avant que `reverse_proxy` ait la moindre chance de s'exécuter --
  quel que soit le jeton fourni. Ce bug existait depuis la création du pont,
  jamais détecté car seul le rejet "sans jeton" avait été testé jusqu'ici, le
  test "avec jeton" ne s'exécutant qu'une fois arrivé au tunnel public.
  Corrigé en enveloppant les trois `reverse_proxy` et le `respond` final dans
  un bloc `route { }`, qui force l'exécution dans l'ordre écrit. Revalidé
  en local pour les trois routes (Ollama, `/bridge/status`, `/sdapi`) avec
  et sans jeton avant de pousser.
- **Diagnostic DNS automatique** : une fois l'URL correctement capturée,
  un nouveau cas est apparu en test réel -- « le nom distant n'a pas pu
  être résolu » -- typique d'un antivirus/pare-feu/DNS de routeur qui
  bloque spécifiquement `*.trycloudflare.com` (service parfois utilisé à
  des fins malveillantes, donc ciblé par certaines listes de blocage). Le
  script compare maintenant automatiquement la résolution DNS système à
  celle du DNS public 1.1.1.1 et indique directement si le blocage vient
  de l'antivirus/DNS local plutôt que de renvoyer un message générique.
  Première version de cette détection cassée à l'usage : elle comparait le
  message d'erreur à un texte français littéral (`"résol"`), mais
  PowerShell 5.1 Windows lit un fichier `.ps1` sans BOM avec le codepage
  ANSI du système -- les caractères accentués du script lui-même étaient
  donc corrompus au chargement et ne correspondaient plus jamais au
  message (correctement décodé, lui) renvoyé par .NET. Remplacé par une
  détection sur le type d'exception (`WebExceptionStatus.NameResolutionFailure`,
  `SocketError.HostNotFound`), indépendante de la langue de Windows.

- **Plantage à l'ouverture du tunnel** : `Start-Process` refuse que
  `-RedirectStandardOutput` et `-RedirectStandardError` pointent vers le
  même fichier. Le script écrivait les deux vers `cloudflared.log`, ce qui
  faisait planter la commande avant même que le tunnel s'ouvre. Corrigé en
  séparant en deux fichiers (`cloudflared.log` / `cloudflared.err.log`),
  fusionnés lors de la recherche de l'URL publique.
- **Vérification de bout en bout trop impatiente** : une fois le tunnel
  ouvert, le script vérifiait sous 20s (10 tentatives × 2s) que la route
  publique répond bien 401 sans jeton — insuffisant, le réseau Cloudflare
  peut mettre plus de temps à propager une URL `trycloudflare.com` toute
  fraîche. Porté à 60s (20 × 3s), avec un message de progression toutes les
  5 tentatives et le détail de la dernière erreur réseau en cas d'échec
  final, pour distinguer un problème réseau/pare-feu d'un vrai bug Caddy.

## 2026-09-15 — Génération d'image locale (Stable Diffusion)

Prépare l'utilisation d'un modèle d'image local sur le PC pendant que
l'utilisateur teste le pont Ollama de son côté — même logique que le texte
local, appliquée aux images.

- **Nouveau fournisseur d'image `localsd`** (`providers/imageProviders.js`) :
  cible l'API REST d'AUTOMATIC1111 (Stable Diffusion WebUI), choisi plutôt
  que ComfyUI pour la même raison qu'Ollama a été choisi côté texte — un
  seul endpoint synchrone (`/sdapi/v1/txt2img`), pas de graphe de nœuds ni
  de websocket à piloter.
- **Nouveaux réglages** : adresse du serveur (`localImageBaseUrl`, défaut
  `http://localhost:7860`) et clé optionnelle (`apiKeys.localsd`), même
  principe que pour Ollama — sélectionnable dans Réglages → Images sous
  "IA locale (Stable Diffusion)".
- **Pont PC étendu** (`scripts/windows/setup-ollama-bridge.ps1`) plutôt que
  dupliqué : une troisième route authentifiée (`/sdapi/*`) s'ajoute au même
  Caddyfile, protégée par le même jeton, exposée par le même tunnel — une
  seule adresse à coller dans Fogbound pour le texte ET l'image. AUTOMATIC1111
  lui-même n'est **pas** installé automatiquement par le script (contrairement
  à Ollama) : c'est une installation nettement plus lourde (environnement
  Python, plusieurs Go de modèles à télécharger soi-même) — le script ajoute
  seulement la route et détecte, sans bloquer, si un serveur répond déjà sur
  le port attendu (7860 par défaut, `-SdPort` pour changer).

Vérifié : `callLocalSD` testé contre un faux serveur imitant l'API
AUTOMATIC1111 (requête/réponse/format data URL corrects) ; bout en bout via
`generateTurnImage` dans `lib/gameEngine.js` (image bien attachée au tour
persisté) ; réglages Images (fournisseur, adresse, clé) sauvegardés et
relus correctement en navigateur réel (Playwright). Le script PowerShell
n'a pas pu être testé sur une vraie installation AUTOMATIC1111 (aucun accès
à un tel environnement ici) — à valider par l'utilisateur.

## 2026-09-15 — Correctifs streaming (plantage META tronqué, pagination, régénération)

Retours utilisateur après un vrai test en conditions réelles (clé Anthropic,
Haiku 4.5) du lot streaming ci-dessous : la génération était bien rapide et
fluide, mais un plantage est apparu, avec un symptôme qui donnait
l'impression que la pagination par tour avait disparu.

- **Corrigé le plantage "Narration META was truncated"** : si le petit
  bloc JSON de fin (`===META===` — issue, compétence utilisée, victoire/
  défaite, actions suggérées) arrivait tronqué ou mal formé, toute la
  réponse était rejetée avec une erreur brute affichée au joueur, alors que
  le chapitre lui-même (déjà lu en direct) était intact.
  `splitNarrationResponse` (`lib/promptBuilder.js`) retombe maintenant sur
  des valeurs par défaut sûres pour les champs manquants au lieu de tout
  rejeter — seule une absence totale de texte de chapitre est encore une
  vraie erreur.
- **Corrigé "la pagination a disparu"** : ce n'était pas la pagination —
  sur un tour en échec, l'action affichée en écho et le texte en cours de
  streaming restaient accrochés en permanence sous la vraie dernière page
  au lieu d'être nettoyés, donnant l'impression d'un flux cassé.
  `playAction` (`public/app.js`) retire maintenant proprement ces éléments
  en cas d'échec confirmé, remet l'action tapée dans le champ de saisie, et
  affiche l'erreur via une alerte au lieu de la injecter dans le fil de
  lecture.
- **Régénération de tour passée sur le même chemin streamé** que la
  génération normale (demande explicite) : nouvelle route `POST
  /api/saves/:id/turns/:turnNumber/regenerate/stream` et fonction
  `regenerateTurnStreaming` (`lib/gameEngine.js`), même traitement en
  direct côté interface. L'ancienne route non streamée reste disponible et
  inchangée. Cohérent avec la demande : création/édition de monde restent
  volontairement non streamées, l'attente y est acceptable.
- Corrigé au passage : l'entrée « Gemini 3.6 Pro » du menu déroulant de
  modèles n'existe pas (404 côté API) — remplacée par un modèle réel.

Vérifié avec de vrais appels Gemini (`gemini-3.5-flash-lite`, pour ménager
un quota de test limité) : tour joué, second tour, puis régénération du
premier via la nouvelle route streamée, les trois aboutissant correctement
sans troncature. Testé aussi le cas exact du bug rapporté (META tronqué
simulé) : le chapitre reste affiché, aucun plantage. Un modèle qui ignore
complètement le format demandé (Gemma 4 31B, testé à la demande de
l'utilisateur) confirme la robustesse : il ne fait plus planter
l'application, même s'il n'est pas utilisable pour un vrai test de rendu
narratif (il ignore l'instruction de format).

## 2026-09-15 — Chapitre affiché en direct, écho immédiat de l'action

Suite à l'analyse des temps de génération réels (mesurés via les métriques
Railway : ~20-30s par tour) et de ce qui fluidifie la lecture (comparaison
avec Infinite Worlds) — trois changements pour réduire l'attente perçue
sans attendre un chantier de refonte complet.

- **Écho immédiat de l'action jouée** : au clic, l'action du joueur
  s'affiche tout de suite dans le fil (au lieu de vider silencieusement le
  champ et attendre) — signal instantané que le clic a bien été pris en
  compte, avant même que le serveur ait répondu.
- **Le chapitre s'affiche au fur et à mesure qu'il s'écrit**, comme
  Infinite Worlds, au lieu d'apparaître d'un bloc à la toute fin :
  - Nouveau découpage du tour en deux appels IA séquentiels
    (`lib/promptBuilder.js` : `buildNarrationPrompt` / `buildStatePrompt`,
    `lib/gameEngine.js` : `playTurnStreaming`) — un appel rapide qui ne
    produit que le texte du chapitre + les actions suggérées + la
    victoire/défaite (streamé en direct), suivi d'un second appel,
    invisible pour le joueur, qui déduit du chapitre déjà écrit les mises à
    jour d'état (objets suivis, informations secrètes, nouveaux faits,
    prompt d'image) — jamais streamé, personne ne le regarde.
  - Nouvelle route `POST /api/saves/:id/turn/stream` (JSON en flux,
    ligne par ligne) et streaming réel implémenté pour tous les
    fournisseurs texte dans `providers/textProviders.js`.
  - L'ancienne route `POST /api/saves/:id/turn` (un seul appel, tout le
    JSON d'un coup) reste intacte et utilisée telle quelle par la
    régénération de tour — seul le parcours de jeu normal (`playAction`
    dans `public/app.js`) utilise le nouveau chemin streamé.

Vérifié avec de vrais appels à l'API Gemini (pas seulement le fournisseur
factice) : format de sortie texte du narrateur (`===CHAPTER===`/`===META===`)
et JSON de l'appel d'état tous deux corrects du premier coup ; streaming
réel confirmé de bout en bout (navigateur → route → Gemini → navigateur,
via Playwright) avec le texte qui s'affiche progressivement puis se
stabilise sur la version finale formatée ; premiers mots du chapitre
visibles en ~4-9s au lieu d'attendre les ~20-30s complets ; contenu diffusé en direct
identique (une fois débarrassé des espaces de fin) au texte persisté ;
objets suivis/secretInfo/faits mémorisés correctement dérivés du chapitre
par le second appel. Implémentations de streaming pour Anthropic, OpenAI,
OpenRouter et Ollama écrites selon leurs formats documentés respectifs mais
non testées avec de vraies clés dans cette session (seuls Gemini et le
fournisseur factice l'ont été) — repli automatique sur un envoi non
fragmenté en cas de souci avec un fournisseur donné.

## 2026-09-15 — Statut Ollama en direct, repli automatique, outillage PC

Complète le chantier Ollama : jusqu'ici, si le pont local (PC + tunnel)
tombait ou était surchargé, un tour ne faisait qu'échouer sans recours.

- **Indicateur de statut Ollama** (Réglages) : point coloré + texte —
  🔴 hors ligne (pont injoignable), 🟠 indisponible (GPU du PC sollicité —
  autre jeu en cours, ou génération déjà en route), 🟢 disponible. Mis à
  jour en tâche de fond toutes les 12s (`GET /api/ollama/status`), pas
  seulement quand Réglages est ouvert.
- **Liste des modèles installés remontée automatiquement** : le menu
  déroulant de modèle Ollama se peuple avec ceux réellement présents sur
  le PC (`GET /api/ollama/models`, via l'API OpenAI-compatible d'Ollama)
  au lieu d'une liste figée ; celle-ci reste utilisée si le pont est
  injoignable.
- **Fournisseur de secours** (Réglages) : si Ollama est hors ligne ou
  indisponible au moment de jouer un tour, une confirmation propose
  d'utiliser ce fournisseur pour ce tour précis (jamais enregistré comme
  réglage permanent). La décision utilise le dernier statut connu — aucune
  vérification réseau supplémentaire au moment d'envoyer l'action, donc
  aucune latence ajoutée.
- **`scripts/windows/`** : trois scripts PowerShell pour la machine qui
  héberge Ollama —
  - `setup-ollama-bridge.ps1` (mis à jour) : ajoute la route
    `/bridge/status` au Caddyfile généré, démarre le nouveau surveillant
    GPU, journalise l'exécution dans un fichier (utile une fois lancé sans
    fenêtre visible).
  - `ollama-watcher.ps1` (nouveau) : icône dans la barre des tâches
    (verte/orange selon la charge GPU via `nvidia-smi`), et le point HTTP
    que Caddy expose sous `/bridge/status`.
  - `install-startup-task.ps1` (nouveau) : enregistre une tâche planifiée
    Windows pour lancer le pont automatiquement à l'ouverture de session,
    avec relance automatique par Windows si le script plante pendant que
    le PC reste allumé.

Vérifié : `providerOverride` sur un tour utilise bien le fournisseur de
secours pour cet appel précis sans toucher au réglage persistant (testé
avec un faux serveur Ollama) ; `/api/ollama/status` et `/api/ollama/models`
répondent correctement joignable/injoignable ; indicateur et repli testés
en navigateur réel (Playwright) sur les 4 cas — GPU occupé + accepté, hors
ligne + aucun secours configuré, hors ligne + refusé, fournisseur principal
non-Ollama (aucune popup). Les trois scripts PowerShell n'ont en revanche
pas pu être exécutés sur une vraie machine Windows (aucun accès dans cet
environnement) — à valider par l'utilisateur.

## 2026-09-14 — Sélecteur de modèle avec prix, fournisseur Ollama, correctif génération Anthropic

- **Corrigé un bug bloquant** : avec une vraie clé Anthropic, la génération
  ne répondait jamais (monde neuf ou sauvegarde existante). Cause réelle :
  `max_tokens` était fixé à 1024 côté appel Anthropic, trop bas pour le
  JSON complet d'un tour (voire pire pour la création de monde) — la
  réponse était tronquée avant la fin, et `JSON.parse` échouait
  silencieusement. Remonté à 8192, et le parseur détecte maintenant
  spécifiquement une réponse tronquée pour un message d'erreur clair au
  lieu d'un "Unexpected end of JSON input" opaque.
- **Corrigé au passage** : les erreurs serveur (500) n'étaient jamais
  loguées côté Railway, rendant ce genre de bug invisible ; la logique de
  nouvelle tentative automatique retentait aussi des erreurs qui n'avaient
  aucune chance de réussir au second essai (masquant le vrai problème
  derrière ~25s d'attente). Un souci réseau IPv6 pouvant ajouter un délai
  similaire côté conteneur a également été corrigé (IPv4 préféré).
- **Sélecteur de modèle avec indication de prix** : liste déroulante par
  fournisseur (Anthropic, OpenAI, OpenRouter, Gemini, Ollama) proposant les
  modèles courants avec leur tarif approximatif par million de jetons,
  tout en gardant le champ texte libre pour taper n'importe quel autre
  identifiant de modèle.
- **Support préparatoire d'Ollama (modèle local)** : nouveau fournisseur de
  texte ciblant l'API compatible OpenAI d'Ollama (`/v1/chat/completions`),
  avec adresse de serveur et clé optionnelle réglables dans Réglages.
  Gratuit par nature (aucun tarif à estimer), mais un Ollama tournant en
  local n'est joignable que si Fogbound tourne lui aussi en local ou via un
  tunnel, puisque l'app elle-même est déployée sur Railway.
- **Tarifs Anthropic affinés par génération de modèle** (`lib/pricing.js`) :
  les entrées génériques 'haiku'/'opus'/'sonnet' confondaient des modèles à
  prix très différents (ex. Sonnet 5 et Sonnet 4.6) ; des entrées plus
  spécifiques passent maintenant en priorité.

Vérifié : appel `callOllama` isolé contre un faux serveur imitant l'API
OpenAI d'Ollama (requête/réponse/usage corrects), persistance des nouveaux
réglages (`ollamaBaseUrl`, clé Ollama) via l'API, différenciation des tarifs
par modèle Anthropic, non-régression du parcours complet en fournisseur
factice (création de monde → sauvegarde → tour).

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
