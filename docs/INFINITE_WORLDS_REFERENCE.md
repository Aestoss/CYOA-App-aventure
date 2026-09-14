# Infinite Worlds — référence fonctionnelle & technique

Ce document analyse en détail le fonctionnement de **infiniteworlds.app**, le
produit que Fogbound cherche à égaler, à partir de :

1. la capture d'écran fournie de l'écran "Edit world" (187 champs visibles,
   tous décrits ci-dessous) ;
2. le wiki officiel du jeu (`infiniteworlds.mywikis.wiki`) ;
3. un guide de création de mondes détaillant le schéma JSON complet utilisé
   en interne (`github.com/sabreking/IWGameCreationGuide`) ;
4. un article de presse (Decrypt) sur l'architecture du moteur.

Sources citées à la fin. L'objectif : servir de cahier des charges pour
combler l'écart entre Fogbound (actuel) et Infinite Worlds (référence).

> **Statut : document d'analyse historique.** La feuille de route qu'il
> propose (section 6, Phases A à G) est entièrement implémentée — voir
> `CHANGELOG.md`. Conservé tel quel pour le contexte et l'analyse détaillée
> des mécaniques d'Infinite Worlds, utile en référence pour toute évolution
> future (ex. les "Trigger events / KIBs" de la section 2.8, jamais repris
> côté Fogbound).

---

## 1. Architecture générale du moteur

Trois IA distinctes travaillent ensemble à chaque tour :

| Rôle | Ce qu'elle fait |
|---|---|
| **Storyteller AI** | Génère le texte de l'issue du tour (narration), les actions suggérées, et les *prompts* d'illustration. C'est le modèle choisi dans "AI model" (GPT-4 par défaut selon Decrypt ; l'utilisateur peut probablement changer de modèle, à l'instar de notre `textProvider`). |
| **Summary AI** | Tourne en tâche de fond : résume les tours anciens, met à jour les notes de personnage, condense l'historique. Se déclenche environ tous les 6 tours à partir du tour 8 (comparer à notre `SUMMARIZE_EVERY = 10`, proche dans l'esprit). |
| **Image AI** | Génère les illustrations à partir des prompts écrits par le Storyteller AI (pas directement par le joueur). Modèles : Flux.1, DreamShaper, etc. |

**Ce qui est envoyé au Storyteller AI à chaque tour** (confirmé par le wiki) :
- les *Main instructions* complètes du monde ;
- l'action du joueur ;
- les **2 à 8 derniers tours, verbatim** (fenêtre glissante, paramétrable
  selon la source — chez nous fixe à 5, `RECENT_TURNS_WINDOW`) ;
- un **résumé** des tours plus anciens ;
- la liste des personnages rencontrés : résumé bref pour ceux absents
  récemment, fiche complète pour ceux présents dans les derniers tours.

Fogbound fait déjà cette architecture en couches (Master Prompt / World
Bible / Mémoire / Tours récents) — c'est le bon squelette. Ce qui manque,
ce sont les **couches de données structurées** que ce squelette est censé
transporter (skills, personnages, objets suivis, déclencheurs...).

---

## 2. Champs de configuration d'un monde — référence complète

Regroupés comme dans l'écran "Edit world" observé, avec le nom du champ
JSON interne (guide GitHub) entre parenthèses quand connu.

### 2.1 Introducing the story

| Champ | Description | État Fogbound |
|---|---|---|
| Title (`title`) | Nom du monde | ✅ (`world.title`) |
| Track version number / Version (`version`, `autoAdvanceVersion`) | Numéro de version du monde, incrémenté automatiquement à chaque édition — sert quand l'auteur republie des mises à jour d'un monde partagé | ❌ absent |
| Description (`description`) | Résumé affiché dans le menu de sélection, **n'affecte pas le gameplay** | ⚠️ on a `tone`, pas de description dédiée pure UI |
| "Show additional text on character selection screen" | Texte optionnel affiché à l'étape de choix du personnage | ❌ absent (pas d'étape de choix de personnage du tout) |
| Preview image + génération IA alternative / upload | Image affichée dans la liste des mondes | ❌ absent (pas d'image de couverture) |
| Background story (`background`) | Texte montré au joueur **avant** le début — influence la suite de l'histoire | ⚠️ proche de `setting`/`startingScene` mais moins riche |
| First action (`firstInput`) | Première action prise automatiquement par le personnage au démarrage (ex. "Look around and reflect on my new situation") | ❌ chez nous le tour 0 est généré directement en narration, pas comme une "action" rejouable |
| Objective (`objective`) | Objectif montré au joueur dès le premier tour ; l'IA narrative en a connaissance en continu | ❌ absent |

### 2.2 Main instructions

| Champ | Description | État Fogbound |
|---|---|---|
| Detail and instructions (`instructions`) | **Le champ le plus important** : contexte complet donné à l'IA — cadre, sujet du jeu, rôle du personnage joueur, instructions de narration. Convention : référer au perso joueur en "I" ("In this story I am trying to..."). Avertissement officiel : au-delà de quelques milliers de mots, le coût par tour augmente (mais certains mondes dépassent plusieurs milliers de mots sans problème) | ⚠️ `MASTER_PROMPT` fixe + World Bible générée, mais pas de zone libre longue éditable par l'utilisateur |
| Extra instruction blocks | Blocs nommés (ex. "Know", "Int") ajoutés à la fin des instructions principales avant envoi à l'IA — utile pour l'organisation ou pour servir de cible aux *triggers* | ❌ absent |
| Author style (`authorStyle`) | Style d'écriture : "a bestselling novelist", un auteur précis ("Neil Gaiman"), ou un genre ("a writer of Children's books") | ❌ absent (ton fixe imposé par le Master Prompt) |
| Design notes | Notes internes à l'auteur, sans effet sur le jeu — contient typiquement le prompt original tapé par l'utilisateur avant expansion par l'IA de génération de monde | ❌ absent |
| Mature content (`nsfw`) + Content warnings (`contentWarnings`) | Case à cocher "contenu mature (R)" déclenchant un avertissement au joueur, + liste libre de catégories de contenu sensible | ❌ absent |

### 2.3 Image style

| Champ | Description | État Fogbound |
|---|---|---|
| Image model (`imageModel`) | Modèle d'image actif (Flux.1, DreamShaper, ...) — bouton "Change image model" | ⚠️ on a un choix de *provider* (Stability/Replicate) mais pas de modèle précis exposé |
| Style details (`imageStyle`, `illustrationStyle*LowPriority/HighPriority`, `imageStyle*Pre/Post`) | Presets de style visuel, distincts pour "personnage" et "non-personnage" (décor), avec texte préfixe/suffixe ajouté automatiquement à chaque prompt d'image | ❌ absent — chez nous le `image_prompt` est généré en roue libre par le narrateur sans cadrage de style |

Le guide JSON précise deux approches de prompt d'image bien distinctes
selon le modèle (voir §4).

### 2.4 Player character options — le cœur manquant

C'est la section la plus structurante et **la plus absente chez Fogbound**.

> *"Every time the player takes an action, the game system considers what
> skill would be needed to succeed (perhaps intelligence, or strength). The
> game then looks at the player character's skill levels to decide whether
> they succeed in the action, taking account of how hard the action would
> be."* — texte exact de l'écran Edit world

**Skills** (`skills`) : liste de 4 à 6 attributs définis par monde (pas
fixes globalement) — ex. fantasy: "Magic", "Combat" ; Jane Austen: "Wealth",
"Wit". Recommandation officielle : 4 à 6 skills.

**Characters** (`possibleCharacters`) : liste de personnages jouables
proposés au choix du joueur avant de commencer. Chacun a :
- `name`, `description` (influence réellement le gameplay : si la fiche
  mentionne une compétence en philatélie ou aux armes de siège, l'IA en
  tiendra compte) ;
- `portrait` (+ génération IA alternative / upload) — **uniquement affiché
  à l'écran de sélection, jamais montré en jeu** ;
- `skills` : objet `{skillName: valeur numérique}`, avec un libellé
  qualitatif par palier observé dans la capture (2 = "Unskilled", 3 =
  "Competent", 4 = "Highly skilled", 5 = "Exceptional") ;
- `initialTrackedItemValues` : valeurs de départ des objets suivis
  spécifiques à ce personnage (inventaire, relations, etc.).

**Customization settings** : au niveau monde, quels champs le joueur a le
droit de modifier une fois le personnage choisi (`allowChangeCharacterName`,
`...Description`, `...Skills`, `...ItemValues`, `...Portrait`,
`...NewPortrait` dans le JSON — via `permissionsOnceShared`).

Chez Fogbound : **aucun choix de personnage, aucun skill, aucune
résolution de réussite/échec.** L'action du joueur est toujours acceptée
et narrée sans confrontation à une capacité. C'est la lacune la plus
citée par l'utilisateur ("l'app ne sert à rien sinon").

Note d'incertitude : aucune source consultée ne décrit de générateur
aléatoire (dés) explicite — tout indique que c'est le **modèle de langage
lui-même** qui juge, de façon narrative, le succès ou l'échec en tenant
compte de la valeur numérique du skill et de la difficulté implicite de
l'action, guidé par les instructions du monde (`descriptionRequest`). Pas
de RNG serveur documenté.

### 2.5 Items to track / Inventaire (`trackedItems`)

Fonctionnalité "optionnelle" (masquée derrière "Show optional features")
mais citée comme centrale pour tout ce qui dépasle les skills fixes :
inventaire, relations, préférences, jauges (faim, argent, réputation...).

Chaque *tracked item* a :
- **Data Type** (ex. Text, Number...) ;
- **Description** — à qui/quoi ça sert ;
- **Visibility** — visible au joueur seul, à l'IA seule, ou aux deux ;
- **Update Automatically** (oui/non) ;
- **Update Instructions** — texte libre très spécifique, ex. *"Update
  whenever I gain or lose an item. Only add an item if I have actually
  acquired it, not simply encountered it."*
- Limite : 10 000 caractères par tracked item (au-delà, troncature).

Le wiki avertit que l'IA n'est pas toujours fiable pour décider seule des
mises à jour — recommande de dupliquer le suivi dans le `secretInfo` (voir
2.6) pour plus de cohérence.

Chez Fogbound : `memoryFacts` est un fourre-tout de phrases libres, sans
typage, sans visibilité différenciée, sans instructions de mise à jour
dédiées par catégorie. C'est un embryon de la même idée mais sans structure.

### 2.6 Secret info — état caché

`secretInfo` + `secretInfoInstructions` : un bloc de données **jamais
montré au joueur**, mis à jour chaque tour par l'IA elle-même pour garder
la cohérence sur des éléments que le joueur ne voit pas :
temps qui passe, sous-intrigues en arrière-plan, pensées/réactions
internes des PNJ, besoins vitaux, relations à long terme, particularités
de lieux, etc. Le guide donne des catégories types : `CharCurrent`,
`CharPersona`, `CharPhilosophy`, `CharMotive`, `CharAbility`, `CharQuirk`,
`CharRelation`, `CharBody`, `CharNeeds`, `LocationDetails`.

Chez Fogbound : totalement absent. `memoryFacts` est toujours implicitement
visible/utilisable de la même façon, pas de distinction caché/visible.

### 2.7 NPCs (Other Characters)

Liste de personnages **non jouables** pré-écrits par l'auteur, que le
joueur peut rencontrer en jeu. Chaque NPC a : `name`, `detail` (fiche
complète), `one_liner` (résumé court utilisé quand le PNJ n'est pas apparu
récemment — cf. §1), `appearance`, `location` (lieu par défaut),
`secret_info` (motivations cachées), `names` (surnoms), et des champs
dédiés à l'image (`img_appearance`, `img_clothing`).

Chez Fogbound : `characters` existe en base mais seulement générés/mis à
jour dynamiquement par l'IA pendant le jeu — aucune fiche pré-écrite par
l'auteur au moment de la création du monde, pas de notion "vu récemment
→ fiche complète, sinon → résumé".

### 2.8 Trigger events / Keyword Instruction Blocks (KIBs)

Mécanisme avancé : après génération de l'issue principale du tour, le
système active les *triggers* pertinents selon la situation. Un trigger
peut **remplacer le texte d'un extra instruction block** (utile pour gérer
une transformation de personnage, un changement d'état majeur, une nouvelle
phase de jeu). Les "keyword instruction blocks" sont ajoutés en fin
d'instructions principales seulement quand certains mots-clés sont détectés
dans le contexte récent.

Chez Fogbound : absent. Le prompt est statique d'un tour à l'autre (à part
l'ajout de nouveaux faits).

### 2.9 Victory and defeat conditions

- **Victory** : case à cocher "Enable victory condition" + texte libre de
  la condition (ex. *"The player character has escaped the maze"*) + texte
  affiché au joueur quand la condition est remplie.
- **Defeat** : même structure, optionnelle.
- Avertissement du wiki : ces conditions "can be finicky, and are prone to
  misfires without careful wording" — donc à formuler prudemment côté
  prompt (l'IA évalue elle-même si la condition est remplie, tour après
  tour, vraisemblablement en incluant la condition dans le prompt système
  et en demandant un champ de sortie booléen).

Chez Fogbound : absent — aucune fin de partie n'est possible.

### 2.10 Show optional features

Six sections avancées supplémentaires sont masquées par défaut derrière
cette case. D'après le wiki, elles "ne sont pas nécessaires pour produire
un monde agréable" mais permettent des systèmes complexes, plus de
conditions de victoire/défaite, et un contrôle plus direct sur les sorties
et le résumé. La capture fournie ne montre pas leur contenu détaillé (la
case n'était pas cochée) — à explorer si besoin plus tard, non prioritaire.

---

## 3. Boucle de jeu (résumé opérationnel)

```
Tour N :
  entrée  = instructions principales (+ extra instruction blocks actifs)
          + action du joueur
          + 2-8 derniers tours (verbatim)
          + résumé des tours antérieurs
          + fiches des personnages présents récemment (complètes)
          + résumé bref des personnages absents récemment
          + secretInfo courant
  sortie  = texte de narration (descriptionRequest guide le format)
          + mise à jour de secretInfo (secretInfoInstructions)
          + mise à jour des tracked items concernés (leurs update instructions)
          + évaluation victoire/défaite si activées
          + prompt(s) d'illustration (imagePromptDetails)
          + actions suggérées

  Après la sortie : activation des triggers pertinents (peuvent réécrire
  des extra instruction blocks pour le tour suivant).

  Tous les ~6 tours à partir du tour 8 : Summary AI condense l'historique
  et met à jour les notes de personnages.
```

---

## 4. Prompt engineering — patterns observés

### `descriptionRequest` (équivalent de notre `MASTER_PROMPT`)
Doit spécifier : point de vue narratif (généralement 1ère personne),
niveau de détail (dialogues, descriptions, environnement), comment les
mécaniques de jeu s'intègrent dans le texte, ton, éléments à éviter
(clichés), ordre de présentation des informations critiques, réflexion de
l'état du personnage (température, vêtements, santé), actions autonomes
des PNJ/environnement au-delà de la seule réaction à l'action du joueur,
dialogues naturels multi-personnages, mise en forme Markdown (italique,
gras, MAJUSCULES) pour l'emphase.

### `summaryRequest`
Doit spécifier explicitement quels états doivent être conservés en
priorité : intrigue significative, règles/mécaniques à documenter
méticuleusement, motivations et relations des personnages, éléments propres
au monde (actions autonomes, états environnementaux). Principe : se
concentrer sur ce qui pilote les mécaniques ou l'intrigue, pas les détails
mineurs.

### Prompts d'image — deux approches distinctes selon le modèle
- **Modèles type Flux** : langage naturel long, détaillé, évocateur. Ne
  pas être concis. `illustrAppearance`, `illustrClothes`,
  `illustrExpressionPosition`, `illustrSetting` doivent chacun être
  développés en prose riche.
- **Modèles non-Flux (ex. DreamShaper)** : inverse — descriptions par tags
  courts séparés par virgules (ex. "young woman, long black hair"),
  qualificatifs type "hyper-realistic, 8k". `imageStyle` doit être mis à
  `null` pour ces modèles.
- Règles universelles : `illustrIsCharacter=true` quand un personnage est
  le sujet ; ne jamais désigner un objet/décor comme sujet principal si un
  personnage est présent ; mettre à jour l'apparence/les vêtements dès
  qu'ils changent en jeu plutôt que de laisser le prompt devenir obsolète.

---

## 5. Écart Fogbound → Infinite Worlds (synthèse priorisée)

| # | Fonctionnalité | Présent chez Fogbound | Impact si absent | Priorité |
|---|---|---|---|---|
| 1 | Skills par monde + résolution de réussite/échec | Non | Le jeu accepte toujours tout — pas de "jeu" à proprement parler | **Critique** |
| 2 | Sélection de personnage jouable avant de commencer (avec skills) | Non | Pas de rejouabilité, pas d'incarnation | **Critique** |
| 3 | Tracked items / inventaire typé avec instructions de mise à jour | Embryon (`memoryFacts` non typé) | Pas de suivi fiable d'objets/jauges | Haute |
| 4 | Conditions de victoire/défaite | Non | Les histoires n'ont jamais de fin | Haute |
| 5 | Zone "Main instructions" librement éditable par monde + Author style | Non (prompt fixe) | Tous les mondes sonnent pareil, pas de contrôle auteur | Haute |
| 6 | NPCs pré-écrits par l'auteur (fiche + secret_info) | Non (générés à la volée seulement) | Moins de cohérence/profondeur des PNJ | Moyenne |
| 7 | secretInfo (état caché structuré) | Non | Cohérence narrative plus fragile sur le long terme | Moyenne |
| 8 | Style d'image structuré (pré/suffixe, personnage vs décor) | Non (prompt libre) | Images incohérentes visuellement d'un tour à l'autre | Moyenne |
| 9 | Objectif de la partie affiché au joueur | Non | Moins de direction pour le joueur | Moyenne |
| 10 | Version/description/image de couverture du monde | Non | Confort de gestion multi-mondes | Basse |
| 11 | Triggers / Keyword Instruction Blocks | Non | Fonctionnalité avancée, pas bloquante au début | Basse |
| 12 | Contenu mature + avertissements | Non | Pertinent seulement si contenu adulte envisagé | Basse |

---

## 6. Feuille de route d'implémentation proposée

**Phase A — Le cœur du jeu (skills + personnages + résolution)**
- Étendre le schéma de monde : `skills: string[]` (4-6, définis à la
  création), `characters: [{name, description, skills: {skill: 1-5}, portrait?}]`.
- Écran de sélection de personnage avant le premier tour.
- Enrichir `MASTER_PROMPT`/`buildTurnPrompt` pour transmettre les skills du
  personnage actif et demander explicitement à l'IA de juger succès/échec
  en fonction du skill pertinent et de la difficulté perçue de l'action
  (champ de sortie `outcome: "success"|"partial"|"failure"` par ex.).

**Phase B — Fin de partie**
- Champs `victoryCondition`/`defeatCondition` (texte libre, optionnels) au
  niveau monde.
- Demander à l'IA un champ `game_over: {result: "victory"|"defeat"|null, text}`
  à chaque tour, affiché et bloquant la suite si non-null.

**Phase C — Objets/état suivis**
- Remplacer/étendre `memoryFacts` par des `trackedItems` typés (nom,
  description, visibilité, instructions de mise à jour), mis à jour par
  l'IA comme aujourd'hui les `new_facts` mais de façon structurée par item.

**Phase D — Personnalisation des instructions**
- Champ `instructions` libre et éditable par monde (au lieu du seul
  `MASTER_PROMPT` fixe), + `authorStyle`. Générés par défaut à la création
  (comme aujourd'hui) mais éditables ensuite.

**Phase E — PNJ enrichis + secretInfo**
- `npcs: [{name, detail, oneLiner, appearance, location, secretInfo}]`
  pré-écrits, injectés dans le prompt selon apparition récente ou non.
- Bloc `secretInfo` cumulatif, non montré au joueur, mis à jour chaque tour.

**Phase F — Image style structuré**
- Champs de style d'image par monde (préfixe/suffixe, ton visuel), utilisés
  pour cadrer le `image_prompt` généré par le narrateur.

**Phase G — Confort auteur**
- Description/version/image de couverture de monde, objectif affiché,
  contenu mature + avertissements.

Chaque phase est livrable indépendamment et n'exige pas de réécrire les
phases précédentes.

---

## Sources

- [How AI Generates Dynamic Text Adventures in 'Infinite Worlds' Game — Decrypt](https://decrypt.co/217340/infinite-worlds-generative-ai-text-adventure-game)
- [How Infinite Worlds works — wiki officiel](https://infiniteworlds.mywikis.wiki/wiki/How_Infinite_Worlds_works)
- [World editing — wiki officiel](https://infiniteworlds.mywikis.wiki/wiki/World_editing)
- [Trigger events — wiki officiel](https://infiniteworlds.mywikis.wiki/wiki/Trigger_events)
- [Creating an Inventory — wiki officiel](https://infiniteworlds.mywikis.wiki/wiki/Creating_an_Inventory)
- [Illustration Instructions — wiki officiel](https://infiniteworlds.mywikis.wiki/wiki/Illustration_Instructions)
- [AI models — wiki officiel](https://infiniteworlds.mywikis.wiki/wiki/AI_models)
- [Frequently Asked Questions — wiki officiel](https://infiniteworlds.mywikis.wiki/wiki/Frequently_Asked_Questions)
- [sabreking/IWGameCreationGuide — schéma JSON complet (GitHub)](https://github.com/sabreking/IWGameCreationGuide)
- Capture d'écran fournie par l'utilisateur : `screencapture-infiniteworlds-app-2026-09-13-19_42_34.pdf` (écran "Edit world", 5 pages)
