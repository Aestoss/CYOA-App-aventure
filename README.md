# Fogbound

Application d'aventure textuelle en choix multiples, générée par IA à
chaque tour, avec une vraie mémoire structurée (pas juste un historique de
chat qui grossit à l'infini). Inspirée d'[Infinite Worlds](https://infiniteworlds.app)
(voir `docs/INFINITE_WORLDS_REFERENCE.md` pour l'analyse détaillée qui a
guidé les choix de conception).

**En ligne : https://fogbound-production.up.railway.app**
(connecté au dépôt GitHub `Aestoss/CYOA-App-aventure`, déployé sur
Railway, stockage persistant).

## Fonctionnalités

- **Monde vs sauvegarde** : un monde est un modèle réutilisable (univers,
  personnages jouables, règles, style) ; chaque nouvelle aventure démarrée
  depuis un monde crée une sauvegarde indépendante (ses propres objets
  suivis, personnages rencontrés, état caché...).
- **Création de monde par IA** à partir d'une idée en une phrase, avec
  langue choisie à la création (figée sur ce monde ensuite) — génère
  personnages jouables, compétences, PNJ, objets suivis, conditions de
  victoire/défaite, style visuel, et un texte d'introduction ("background")
  montré au joueur au lancement de chaque nouvelle aventure.
- **Éditeur de monde** : tout ce que l'IA a généré est modifiable
  (instructions, style, personnages — ajout manuel, génération IA, édition,
  suppression), plus une retouche IA en langage naturel pour des ajustements
  légers.
- **Pagination par tour** (façon Infinite Worlds) : chaque tour est une
  page navigable, avec retour en arrière destructif ("reprendre à partir
  d'ici") et régénération d'un tour (action modifiée, ou note de recadrage
  pour l'IA en gardant l'action d'origine).
- **Compétences et résolution** : l'IA juge réussite/échec selon les
  compétences du personnage joué ; caché au joueur par défaut.
- **Mode auteur** (🔍) : révèle l'état caché (`secretInfo`, objets suivis
  IA-seule) et permet de parler directement au narrateur, hors-personnage.
- **Objets/état suivis** typés (inventaire, jauges de relation...),
  visibles par le joueur ou réservés à l'IA.
- **Mémoire structurée** : faits extraits stockés en base + résumé
  automatique des tours anciens, plutôt qu'un historique brut qui grossit
  indéfiniment.
- **Interface traduite** (français/anglais) suivant le réglage de langue,
  installable comme PWA sur téléphone.
- **Suivi des coûts** IA (jetons + estimation $) et fournisseurs
  interchangeables sans toucher au code : Anthropic, OpenAI, OpenRouter,
  Google Gemini, ou une démo locale sans clé pour tester sans rien payer.
  Images optionnelles via Stability AI ou Replicate.

Historique détaillé de ce qui a été livré : voir `CHANGELOG.md`.
Fonctionnalités demandées mais pas encore faites : voir `TODO.md`.

## Démarrer en local

```bash
npm install
npm start
```

Puis ouvre `http://localhost:3000`. Le fournisseur "Démo locale (sans
clé)" fonctionne immédiatement, sans configuration. Pour utiliser un vrai
modèle (Claude, GPT-4, Gemini...), va dans Réglages ⚙ une fois l'app
ouverte et colle ta clé API — elle est stockée côté serveur uniquement,
jamais dans le code.

Variables d'environnement optionnelles (voir `.env.example`) :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute du serveur |
| `DATA_DIR` | `./data` | Dossier du fichier `db.json` (base de données) |

## Structure du projet

```
server.js                    → routes de l'API Express
lib/db.js                    → base de données (fichier JSON local via lowdb)
lib/promptBuilder.js         → assemblage des prompts en couches envoyés à l'IA
lib/gameEngine.js            → logique de jeu : mondes, sauvegardes, tours, mémoire
lib/pricing.js               → tarifs approximatifs $/1M tokens par fournisseur
lib/costTracker.js           → enregistrement et agrégation des coûts d'appels IA
providers/textProviders.js   → Anthropic / OpenAI / OpenRouter / Gemini / démo
providers/imageProviders.js  → Stability / Replicate / démo
public/                      → interface (HTML/CSS/JS), installable en PWA
docs/INFINITE_WORLDS_REFERENCE.md → analyse de référence ayant guidé la conception
CHANGELOG.md                 → historique de ce qui a été livré
TODO.md                      → backlog de fonctionnalités demandées, pas encore faites
```

Pas de framework frontend (JS vanilla), pas de base de données externe
(fichier JSON local via [lowdb](https://github.com/typicode/lowdb)) —
volontairement simple, sans dépendance native qui pourrait échouer à
l'installation. Voir `lib/db.js` pour le détail du choix.

## Déploiement

Le service Railway (`fogbound-production.up.railway.app`) est connecté au
dépôt GitHub, branche `main`, avec un volume persistant monté sur `/data`
(`DATA_DIR=/data`) — les histoires survivent aux redéploiements.

Le redéploiement automatique sur push GitHub s'est montré peu fiable en
pratique ; si le site ne reflète pas le dernier commit après un push, un
redéploiement manuel depuis le dashboard Railway (bouton "Redeploy" sur le
dernier déploiement, ou reconnecter la source du service) est nécessaire.

Aucune clé API n'est configurée en variable d'environnement Railway — elles
se collent directement dans Réglages ⚙ de l'app en ligne, et restent
stockées côté serveur uniquement (jamais dans le code ni sur GitHub).
