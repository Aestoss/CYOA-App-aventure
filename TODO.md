# TODO — Fogbound

Backlog de fonctionnalités demandées, à implémenter seulement quand
explicitement demandé (rien ici n'est fait tant que la case n'est pas cochée).
Ce fichier s'alimente au fil des demandes — ne pas hésiter à en rajouter.

## UX / Interface

- [ ] **Barre de progression pendant la génération d'un monde.** Actuellement
      juste un texte statique ("Création du monde...") le temps de l'appel IA.
- [ ] **Ouvrir l'éditeur de monde juste après la création**, avant la
      sélection de personnage / le premier tour, pour relire et ajuster tout
      ce que l'IA a généré (monde + personnages) avant de commencer à jouer.
- [ ] **Édition des personnages depuis l'écran de sélection de personnage**
      (pas seulement via l'éditeur de monde séparé).

## Personnages

- [ ] **Bouton "Ajouter un personnage"** dans l'éditeur de monde, pour créer
      un personnage jouable manuellement (nom, description, compétences).
- [ ] **Bouton "Générer un personnage par IA"** dans l'éditeur : l'utilisateur
      décrit le personnage en une phrase, l'IA génère la fiche complète
      (nom, description, compétences cohérentes avec les skills du monde).

## Édition IA du monde

- [ ] **Bouton "Retoucher avec l'IA"** dans l'éditeur de monde : l'utilisateur
      décrit un changement en langage naturel (ex. "rends le ton plus sombre",
      "ajoute un antagoniste"), l'IA modifie uniquement les champs concernés
      du monde — retouche légère, pas une régénération complète.

## Gestion des mondes / sauvegardes

- [ ] **Distinguer "monde" et "sauvegarde".** Un **monde** est un modèle
      réutilisable qui propose toujours une nouvelle aventure depuis le
      début ; une **sauvegarde** est une partie en cours qu'on reprend là où
      elle en était. Aujourd'hui les deux sont confondus : créer un "monde"
      démarre déjà une partie dès le tour 0.
- [ ] **Suppression des mondes/sauvegardes inutilisés** depuis la liste des
      histoires (bouton supprimer + confirmation).

## Coûts / observabilité

- [ ] **Suivi des coûts de génération** : tokens/coût estimé par appel IA,
      cumulés par monde et/ou globalement, visible quelque part dans l'app
      (Réglages ou par histoire).

---

## Notes pour plus tard (pistes, pas des décisions)

- La distinction monde/sauvegarde touche le cœur du modèle de données
  actuel (`world` = à la fois définition ET partie jouée en un seul objet) —
  probablement le chantier le plus structurant de la liste ; plusieurs
  autres items (suppression, "toujours une nouvelle aventure") en dépendent
  directement. À envisager en premier si on attaque plusieurs items d'un coup.
- Le suivi des coûts suppose de connaître un tarif par provider/modèle, pas
  trivial en général (clé perso de l'utilisateur) — à minima, compter les
  tokens envoyés/reçus dans `providers/textProviders.js` et afficher un
  ordre de grandeur plutôt qu'un montant exact.
- L'édition IA du monde peut réutiliser le mécanisme de création (un prompt
  qui prend le monde actuel + la demande de modif, renvoie les champs mis à
  jour) plutôt qu'un système séparé.
