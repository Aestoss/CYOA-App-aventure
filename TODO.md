# TODO — Fogbound

Backlog de fonctionnalités demandées, à implémenter seulement quand
explicitement demandé (rien ici n'est fait tant que la case n'est pas cochée).
Ce fichier s'alimente au fil des demandes — ne pas hésiter à en rajouter.

## Fait (lot du 14/09)

- [x] **Barre de progression pendant la génération d'un monde** (indéterminée,
      avec message d'étape qui tourne — pas de vraie progression puisque
      l'appel IA est unique et non streamé).
- [x] **Ouvrir l'éditeur de monde juste après la création**, avant la
      sélection de personnage / le premier tour.
- [x] **Édition des personnages depuis l'écran de sélection de personnage**
      (édition en ligne dans la carte du personnage).
- [x] **Bouton "Ajouter un personnage"** dans l'éditeur de monde.
- [x] **Bouton "Générer un personnage par IA"** dans l'éditeur.
- [x] **Bouton "Retoucher avec l'IA"** dans l'éditeur de monde (retouche
      légère, ne touche jamais aux personnages/objets/chapitre d'ouverture).
- [x] **Distinguer "monde" et "sauvegarde".** Un monde est un modèle
      réutilisable (`POST /api/worlds/:id/saves` démarre toujours une aventure
      neuve) ; une sauvegarde est une partie en cours et indépendante
      (compétences, objets suivis, personnages rencontrés, état caché —
      chacun a sa propre copie par sauvegarde).
- [x] **Suppression des mondes/sauvegardes** depuis la liste des histoires
      (avec confirmation ; supprimer un monde supprime en cascade toutes ses
      sauvegardes).
- [x] **Suivi des coûts de génération** : jetons + estimation $ par appel IA,
      visible dans Réglages → Coûts. Estimation approximative (tarifs
      éditables dans `lib/pricing.js`), OpenRouter affiché en jetons seuls
      (pas de tarif fixe possible).

Testé de bout en bout dans un vrai navigateur (Playwright) : création →
éditeur → ajout/génération/édition de personnages → retouche IA → sélection
avec édition en ligne → tour de jeu → victoire → continuer → deuxième
aventure indépendante depuis le même monde → suppression sauvegarde/monde
en cascade → coûts.

## Nouveau lot (demandé le 14/09, pas encore fait)

- [ ] **Sélection de la langue de sortie** des réponses de l'IA — prévoir
      anglais et français pour commencer.
- [ ] **Revenir en arrière sur les tours** : pouvoir sélectionner un tour
      passé et reprendre la partie à partir de là (annule les tours suivants,
      ou crée une branche — à trancher au moment de l'implémentation).
- [ ] **Cacher la réussite/l'échec au joueur.** Actuellement affiché comme un
      badge (✅/⚠️/❌) à côté de l'action — à retirer de l'interface tout en
      gardant `outcome`/`skill_used` en interne pour la narration.
- [ ] **Mode "auteur" / debug** : pouvoir afficher les informations
      normalement cachées (secretInfo, valeurs des objets `ai_only`) et
      envoyer une instruction directe à l'IA narratrice en contournant la
      case normale "que fais-tu ?" (équivalent d'un "quoi qu'il arrive,
      fais X" adressé au MJ plutôt qu'au personnage).
- [ ] **Étudier pourquoi Infinite Worlds affiche chaque tour comme une page
      séparée** (plutôt qu'un flux continu comme chez nous) — comprendre
      l'intérêt (lisibilité ? limite de contexte affiché ? rythme narratif ?)
      avant de décider si Fogbound doit faire pareil.
- [ ] **Les tours sont plus courts que sur Infinite World** — allonger le
      texte généré par tour (revoir la fourchette de mots dans le prompt).
- [ ] **Mise en page du texte à améliorer** : les réponses manquent de
      structure/retours à la ligne, ce qui les rend difficiles à lire —
      demander à l'IA une mise en forme plus lisible (paragraphes séparés,
      dialogues sur leur propre ligne...).

---

## Notes pour plus tard (pistes, pas des décisions)

- Le "retour en arrière sur les tours" et le mode "auteur" touchent tous les
  deux à la façon dont une sauvegarde est mutée — à concevoir ensemble plutôt
  que séparément si les deux sont demandés en même temps (ex. revenir en
  arrière doit aussi purger `memoryFacts`/`saveTrackedItemValues` postérieurs
  au tour choisi, pas seulement les lignes de `turns`).
- Cacher réussite/échec au joueur est un pur changement d'affichage
  (`renderChapters` dans `public/app.js`) — aucun changement côté serveur/IA
  nécessaire, l'info existe déjà, elle est juste actuellement montrée.
- Pour la longueur/mise en forme des tours : ajuster les instructions
  `chapter_text` dans `lib/promptBuilder.js` (`MASTER_PROMPT`) — fourchette de
  mots plus large + consigne explicite de paragraphes courts/retours à la
  ligne. Vérifier aussi que le rendu HTML (`escapeHtml` + `innerHTML`) affiche
  bien les sauts de ligne (actuellement le texte est mis dans un seul
  `<div>`, un `\n` ne s'affichera pas sans `white-space: pre-line` ou un
  découpage en `<p>`).
