# Changelog — Fogbound

Historique des changements livrés, du plus récent au plus ancien. Pour ce
qui est prévu mais pas encore fait, voir `TODO.md`. Les dates suivent les
commits Git ; les entrées sont groupées par lot de fonctionnalités plutôt
que commit par commit.

## 2026-09-16 — Couverture/portraits éditables, purge d'images, suggestions non auto-envoyées, vrai bug de mémoire corrigé

- **Prompt d'image ouvrable/modifiable** : cliquer sur l'image de couverture
  d'un monde ou le portrait d'un personnage (ou le bouton "🔍 Voir/modifier
  le prompt" à côté) ouvre un panneau montrant le texte envoyé à l'IA pour
  la générer. Modifiable, puis "Générer un aperçu" — l'ancienne image n'est
  remplacée que si l'aperçu est explicitement validé ; "Rejeter" l'abandonne
  sans rien toucher. Le prompt validé est mémorisé et repropose la prochaine
  fois.
- **Portrait automatique pour un personnage ajouté à la main** : jusqu'ici
  seuls les personnages générés par IA (à la création du monde ou via
  "Générer avec l'IA") recevaient un portrait tout de suite — un personnage
  ajouté manuellement restait sans image jusqu'à un clic sur "Régénérer le
  portrait". Génère maintenant son portrait de la même façon, dès l'ajout.
- **Purge des images de tour** : les images générées pendant les tours sont
  des data URI base64 stockées telles quelles dans db.json (quelques
  centaines de Ko à plusieurs Mo chacune) — rien ne les limitait jusqu'ici,
  au risque de saturer le disque sur une longue partie. Seules les 10 images
  les plus récentes par sauvegarde sont désormais conservées automatiquement
  (les plus anciennes sont vidées, le texte du tour reste intact pour la
  pagination) ; un bouton 🗑️🖼️ dans la vue de jeu permet aussi de tout purger
  manuellement pour une sauvegarde si besoin.
- **Suggestions de l'IA : ne déclenchent plus un tour toutes seules** —
  cliquer sur une suggestion remplit maintenant le champ d'action (modifiable
  librement) au lieu d'envoyer le tour immédiatement ; l'envoi reste un geste
  volontaire (Entrée / bouton Envoyer), comme si le texte avait été tapé à la
  main.
- **Vrai bug de mémoire trouvé et corrigé** : la compression périodique
  (`maybeSummarize`) re-résumait TOUTE l'historique depuis le tout début à
  chaque déclenchement au lieu de ne traiter que les tours nouvellement
  sortis de la fenêtre récente — confirmé en le rejouant en local (deuxième
  résumé couvrant les tours 0-15 au lieu de seulement 16-25). Sur une partie
  longue, ça gonflait le coût de chaque résumé sans limite et empilait des
  faits de mémoire très redondants, qui pouvaient finir par pousser des faits
  distincts hors de la fenêtre des 20 faits les plus pertinents. Un nouveau
  champ `summarizedUpToTurn` sur la sauvegarde marque désormais jusqu'où la
  compression est vraiment allée ; "reprendre à partir d'ici" (rewind) le
  recale correctement pour ne pas se fier à un résumé qui vient d'être
  supprimé.
- **Piste principale pour les suggestions qui disparaissent parfois en
  partie longue** (signalé, pas encore confirmé à 100% sans accès à la
  machine réelle) : aucune limite explicite de contexte (`num_ctx`) ni de
  longueur de réponse (`max_tokens`) n'était envoyée à Ollama — les
  suggestions sont la toute dernière chose écrite par le modèle (dans le
  bloc `===META===` après tout le chapitre), donc les premières perdues si
  la réponse est tronquée faute de place. Envoie désormais explicitement
  `num_ctx: 8192` et `max_tokens: 4096`, largement au-dessus de ce qu'un
  tour Fogbound demande normalement.

## 2026-09-16 — Relecture complete demandee : deux bugs latents trouves avant qu'ils ne cassent quoi que ce soit

Suite a une demande explicite de ne plus livrer de bug evitable "a chaud" :
relecture ligne par ligne de tous les scripts touches recemment
(`Lancer-Fogbound.bat`, `start-fogbound.ps1`, `setup-automatic1111.ps1`,
`setup-ollama-bridge.ps1`, `install-startup-task.ps1`) avant toute nouvelle
livraison, plutot que de corriger seulement le fichier qui venait de casser.
Deux bugs latents trouves et corriges, aucun encore rapporte par un run reel :

- **`Lancer-Fogbound.bat`** : un refus ou un echec de la demande UAC
  (`Start-Process -Verb RunAs`) fermait la fenetre silencieusement, sans
  aucun message -- meme categorie de bug que le `-NoExit`/`exit` corrige
  juste avant. Corrige en enveloppant cet appel dans un `try/catch` avec un
  `exit 1` explicite dans le `catch`, puis un `if errorlevel 1` cote
  `cmd.exe` qui explique clairement ce qui s'est passe et attend une touche
  avant de fermer.
- **`setup-automatic1111.ps1`** (mise a jour de `--port` dans
  `webui-user.bat`) : le remplacement `-replace "--port\s+\d+", ...`
  n'etait pas ancre a la ligne `COMMANDLINE_ARGS`, contrairement a tous les
  autres remplacements de ce fichier -- un `--port 1234` qui apparaitrait
  ailleurs (un commentaire `rem` du template, par exemple) aurait ete
  remplace par erreur au lieu de la bonne ligne. Corrige en ancrant le
  remplacement a `(^set COMMANDLINE_ARGS=[^\r\n]*--port\s+)\d+` avec
  `${1}` (et non `$1` nu, qui aurait pu se faire happer par les chiffres du
  port suivant et etre lu comme un groupe de capture different).

Aucun autre probleme trouve dans les quatre autres scripts a cette
relecture -- balance des accolades/parentheses et absence de caracteres
non-ASCII revalidees sur chaque fichier modifie avant ce commit.

## 2026-09-16 — Lanceur double-clic : la fenetre se fermait instantanement

Rapporte immediatement apres l'ajout du lanceur : la fenetre se lancait
puis se coupait toute seule. Cause reelle : `-NoExit` sur la ligne
`powershell -NoExit -File ...` ne protege que contre une fin de script
"normale" (qui tombe en fin de fichier) -- `start-fogbound.ps1` appelle
`exit` explicitement sur chaque chemin (erreurs comme arret normal via
Ctrl+C), et un `exit` explicite a l'interieur d'un script `-File` ferme
toute la fenetre PowerShell meme avec `-NoExit`, sous Windows PowerShell.
Corrige dans `Lancer-Fogbound.bat` en retirant ce `-NoExit` inutile et en
ajoutant un `pause` cote `cmd.exe` juste apres l'appel -- `cmd.exe` n'est
pas affecte par le code de sortie du processus PowerShell qu'il a lance,
donc la fenetre reste desormais ouverte de maniere fiable quelle que soit
la façon dont le script s'est termine.

## 2026-09-16 — Generation d'image confirmee fonctionnelle + lanceur double-clic

Root cause du "CUDA error: no kernel image" confirmee : un processus
AUTOMATIC1111 elevé (lancé un jour depuis une fenetre PowerShell
administrateur) tournait en arriere-plan depuis un bon moment, invisible
et impossible a arreter depuis une session normale (`Stop-Process` y
echouait avec "Acces refuse", pas juste une ligne de commande vide comme
dans l'entree precedente) -- confirmant, avec une derniere preuve directe,
l'ecart de privileges deja diagnostique. Une fois ce process arrete depuis
une fenetre elevee, la generation d'image fonctionne.

Nouveau `Lancer-Fogbound.bat` : lanceur double-clic pour
`start-fogbound.ps1`, qui s'auto-eleve en administrateur (demande UAC) au
lieu de se lancer en mode normal -- tire directement la lecon de la
session de diagnostic ci-dessus : un script elevé peut toujours gerer
n'importe quel processus (eleve ou non) qu'un lancement precedent a pu
creer, dans un sens ou dans l'autre, ce qu'un script non-eleve ne peut
jamais garantir.

## 2026-09-16 — Vrai bug trouve : la detection de processus ne voit pas tout, pas le torch

Session de diagnostic en direct sur la machine reelle apres un echec
persistant en jeu malgre un torch verifie fonctionnel. Ecarte
methodiquement, avec preuve a chaque etape :
- Le dtype du checkpoint (fp32/fp16/bf16 testes individuellement, tous OK ;
  seul float8_e4m3fn echoue, avec une erreur differente et non liee).
- Le chemin meta-device -> cuda utilise par le chargement du checkpoint
  (reproduit isolement, fonctionne).
- Des processus GPU zombies accumules (hypothese avancee puis retiree :
  `nvidia-smi` ne montrait aucun processus Python actif au moment du test,
  preuve directe du contraire -- notee ici pour ne pas la reproposer).
- Le build PyTorch lui-meme : `torch.cuda.get_arch_list()` confirme
  `sm_120` (Blackwell) present dans les noyaux compiles -- le venv est
  reellement correct.

Ce qui EST confirme reel : `Get-CimInstance Win32_Process` peut renvoyer un
`CommandLine` totalement VIDE pour un processus pourtant bien actif
(observe directement : 3 PID reels listes, tous avec CommandLine vide) --
tres probablement un ecart de privilege/niveau d'integrite entre la
session qui interroge et le processus cible. Comme tout le nettoyage de
`start-fogbound.ps1` et `setup-automatic1111.ps1` reposait uniquement sur
cette correspondance de ligne de commande, il ratait silencieusement ces
processus -- confirme par des conflits de port 7860 systematiques a
chaque relancement, alors meme que le script rapportait "rien n'etait
actif".

Correctif dans les deux scripts : une deuxieme methode de detection,
independante des privileges WMI, cherchant directement quel processus
ecoute reellement sur le port d'AUTOMATIC1111 (`Get-NetTCPConnection
-LocalPort $SdPort -State Listen`). Les deux signaux (ligne de commande +
port) sont combines. `setup-automatic1111.ps1` factorise ça dans
`Get-A1111ProcessIds`/`Stop-A1111ProcessIds`, reutilisees a la fois avant
la reinstallation de torch et avant le lancement ; `start-fogbound.ps1`
applique le meme principe dans `Stop-A1111Processes`.

Cause du symptome original (CUDA "no kernel image") toujours pas
definitivement identifiee, mais desormais fortement soupconnee d'etre liee
a des lancements qui se chevauchaient reellement (confirme par des conflits
de port systematiques), plutot qu'a un probleme de torch -- a confirmer par
un test avec une seule instance desormais garantie propre.

## 2026-09-16 — La verification PyTorch/Blackwell passait alors que l'install restait cassee

Meme erreur CUDA reproduite en jeu (confirmee par les logs Railway) apres
un run de `start-fogbound.ps1` qui avait pourtant rapporte "OK: PyTorch
fonctionne correctement". Cause reelle : le test utilise jusqu'ici
(`torch.zeros(1) + 1`) est l'operation CUDA la plus simple possible -- trop
simple pour detecter une reinstallation partielle. AUTOMATIC1111 tourne en
continu depuis le debut de cette session ; la toute premiere reinstallation
de torch a tres probablement eu lieu pendant que ce processus tenait encore
les .dll de torch ouverts, empechant Windows de tous les remplacer malgre
`--force-reinstall` -- resultat : un melange de fichiers anciens/nouveaux,
sur lequel l'addition triviale passait quand meme, mais pas les vraies
convolutions utilisees par la generation d'image.

Deux correctifs dans `setup-automatic1111.ps1` :
- Le test verifie desormais une vraie convolution en demi-precision
  (`torch.nn.functional.conv2d`) suivie de `torch.cuda.synchronize()` --
  necessaire car torch lui-meme documente que les erreurs CUDA peuvent
  n'apparaitre qu'a un appel ulterieur, pas forcement celui qui les a
  causees.
- Avant toute reinstallation de torch, un processus AUTOMATIC1111 deja actif
  pour cette meme installation est desormais arrete (et son arret reellement
  attendu) en premier -- pour qu'une reinstallation ne puisse plus jamais
  se disputer les memes fichiers avec un processus vivant. La reinstallation
  ajoute aussi `--no-cache-dir` pour garantir un telechargement neuf plutot
  que de reutiliser un wheel mis en cache lors d'une tentative precedente
  partiellement ratee.

## 2026-09-16 — Nettoyage des anciens journaux AUTOMATIC1111 : non bloquant desormais

Meme apres le renforcement precedent (sondage de la fin reelle du processus
+ 4 tentatives), un run reel via `start-fogbound.ps1` a echoue au meme
endroit -- alors qu'aucun processus laisse par une execution precedente
n'avait meme ete detecte cette fois (donc rien a attendre). Preuve que ce
n'est pas (ou plus seulement) un processus AUTOMATIC1111 orphelin qui tient
ces journaux ouverts, mais autre chose (antivirus, visionneuse de journal,
synchronisation cloud sur ce dossier...) que ce script ne peut ni
identifier ni fermer de force.

Comme le contenu de l'ancien journal n'est jamais qu'un confort de lecture
apres coup (la boucle d'attente de disponibilite interroge l'API HTTP
directement, jamais le contenu du fichier), bloquer tout le run pour ca
n'avait pas de sens : l'echec de suppression est maintenant un simple
avertissement (tentatives portees a 6 x 1s), et le script continue vers le
lancement reel. Le lancement lui-meme (`Start-Process` avec les journaux en
sortie) est desormais protege par un try/catch avec un message clair et une
liste de causes plus large a verifier si, cette fois, ca echoue vraiment.

## 2026-09-16 — Un seul script pour tout arreter/verifier/relancer (start-fogbound.ps1)

Demande explicite apres plusieurs allers-retours entre `setup-automatic1111.ps1`
et `setup-ollama-bridge.ps1` lances separement et dans le bon ordre a la
main : un point d'entree unique. Nouveau `start-fogbound.ps1`, qui ne
réimplémente rien des deux scripts existants (tous leurs correctifs --
CLIP/setuptools, miroir Stability-AI, verification reelle du GPU Blackwell,
Tailscale Funnel, reecriture du Host vers Ollama, nettoyage de processus
avec sondage -- s'appliquent donc ici sans rien dupliquer) :

1. **Arret propre** : cherche tout ce qui tourne deja d'une execution
   precedente (Caddy/surveillant via les PID suivis dans `config.json`,
   AUTOMATIC1111 par correspondance de repertoire, une fenetre de l'un des
   deux scripts restee ouverte ailleurs) et l'arrete, ou confirme un depart
   propre. Ollama et Tailscale ne sont volontairement pas coupes ici -- ce
   sont des services partages, pas quelque chose que ce script possede ;
   ils sont juste verifies/demarres si besoin par la suite.
2. **AUTOMATIC1111** (optionnel via `-SkipAutomatic1111`, jamais bloquant) :
   appelle `setup-automatic1111.ps1` tel quel.
3. **Pont Ollama <-> Fogbound** (etape finale, garde la fenetre ouverte) :
   appelle `setup-ollama-bridge.ps1` tel quel ; un `finally` arrete aussi
   AUTOMATIC1111 quand ce pont s'arrete (Ctrl+C), pour un cycle complet
   demarrage/arret en un seul geste.

Ajoute aussi un mode `-Diagnose` (verifie Ollama, AUTOMATIC1111 et delegue
au `-Diagnose` deja existant de `setup-ollama-bridge.ps1`) sans rien
arreter ni installer. `install-startup-task.ps1` pointe desormais vers ce
script au lieu du seul pont, pour que le demarrage automatique a l'ouverture
de session couvre bien toute la pile, pas seulement Ollama.

## 2026-09-16 — Cause reelle de l'absence d'images en jeu : PyTorch sans noyaux Blackwell, pas un bug applicatif

Symptome remonte par l'utilisateur : un tour se joue normalement (texte,
objets suivis, actions) mais aucune image n'apparait, alors que la
generation d'images est activee et un modele reel est configure (dropdown
de detection automatique ajoute plus tot aujourd'hui). Premiere cause
trouvee et corrigee : `generateTurnImage` avalait silencieusement toute
erreur (`imageUrl = null`, rien journalise) -- corrige pour logger la vraie
erreur (voir entree precedente). Une fois deploye et un tour rejoue, le
vrai message est apparu dans les logs Railway :

    Local Stable Diffusion API error 500: {"errors":"CUDA error: no kernel
    image is available for execution on the device..."}

Root cause confirmee : `setup-automatic1111.ps1` detecte deja les GPU RTX
50xx (Blackwell) et redirige `TORCH_COMMAND` vers les roues cu128
compatibles dans `webui-user.bat` -- mais AUTOMATIC1111 ne consulte
`TORCH_COMMAND` que s'il juge torch pas encore installe. Sur un venv deja
existant (installe avant ce correctif, ou par tout autre chemin), le
serveur demarre et repond normalement a `--api` -- seule la toute premiere
generation reelle declenche l'erreur, bien apres la fin de l'installation.

Correctif dans `setup-automatic1111.ps1` : nouvelle etape (juste apres la
pre-installation de CLIP, une fois le venv connu) qui exécute reellement
une operation GPU triviale (`torch.zeros(1, device='cuda')` puis une
addition) au lieu de deviner depuis des numeros de version -- fragile,
un futur GPU pourrait avoir besoin d'un autre index cu1xx. Si ce test
echoue (avec ou sans le message exact "no kernel image"), force une
reinstallation de torch/torchvision/torchaudio depuis l'index cu128 avec
`--force-reinstall`, puis revérifie. S'applique aussi bien a un venv deja
casse qu'a un tout premier install (torch pas encore installe a ce stade
du script) -- dans les deux cas, le venv se retrouve avec un torch reellement
verifie fonctionnel avant meme le premier lancement du webui, au lieu de
compter sur le mecanisme lazy de webui-user.bat.

## 2026-09-16 — Cause reelle du 403 trouvee : la protection anti-DNS-rebinding d'Ollama, pas Cloudflare ni Tailscale

Root cause confirmee, apres des semaines a soupconner tour a tour Cloudflare
(heuristique WAF) puis un antivirus/DLP local sur ce PC : **aucun des deux**.
Un `curl.exe -v` fait pendant que le pont restait actif (voir l'entree
precedente) a montre l'en-tete `Via: 1.1 Caddy` sur la reponse 403. Verifie
directement dans le source de Caddy (`modules/caddyhttp/reverseproxy/reverseproxy.go`) :
cet en-tete n'est ajoute QUE par la directive `reverse_proxy`, jamais par un
`respond` statique -- la preuve que la requete avait bien traverse notre
Caddy et atteint le service derriere, et que ce service avait lui-meme
repondu 403.

Verifie ensuite dans le source d'Ollama (`server/routes.go`,
`allowedHostsMiddleware`/`allowedHost`) : Ollama refuse par defaut (403, corps
vide) toute requete dont l'en-tete `Host` n'est pas `localhost`, une IP
loopback/privee, ou le nom de la machine -- une protection anti-DNS-rebinding
qui existe depuis longtemps et n'a jamais ete declenchee tant qu'Ollama
n'etait joint qu'en local. Des qu'on passe par un tunnel public (Cloudflare
hier, Tailscale aujourd'hui), l'en-tete `Host` de la requete devient le nom
public du tunnel -- exactement ce qu'Ollama refuse. Meme mecanisme, exactement
le meme symptome (sans jeton = 401, avec jeton = 403) sur deux infrastructures
de tunnel totalement differentes : la cause a toujours ete Ollama lui-meme,
jamais Cloudflare ni un logiciel de securite local.

Correctif dans `setup-ollama-bridge.ps1` : chacune des trois directives
`reverse_proxy` du Caddyfile recoit desormais `header_up Host localhost`,
qui reecrit l'en-tete Host envoye a l'upstream sans toucher a la
configuration d'Ollama (qui reste strictement local, aussi securise
qu'avant). Le message de diagnostic sur un 403 post-tunnel distingue
maintenant ce cas confirme (en-tete Via presente -> Ollama/Caddy ont
repondu, pas un blocage exterieur) de l'hypothese generique
antivirus/DLP, desormais reléguée en repli si l'en-tete Via est absente.

**Confirme par un run reel complet** : tunnel Tailscale stable, "sans
jeton" rejete (401), "avec jeton" via l'URL publique -> reponse reelle
d'Ollama recue ('OK'), `/bridge/status` joignable via le tunnel, reglages
Fogbound mis a jour et confirmes automatiquement. Le pont Ollama <->
Fogbound via Tailscale Funnel est operationnel de bout en bout.

## 2026-09-16 — 403 "avec jeton" via Tailscale Funnel : meme symptome qu'avec Cloudflare, diagnostic etendu

Run reel : le tunnel Tailscale Funnel s'ouvre desormais correctement
(`https://<machine>.tailxxxxx.ts.net`), "sans jeton" est bien rejete (401),
mais "avec jeton" echoue en 403 -- exactement le meme symptome deja observe
avec l'ancien tunnel Cloudflare (voir plus bas), sur une infrastructure
totalement différente. Ni Caddy ni Tailscale (verifie dans leurs sources
respectives -- Caddy ne sait repondre que 401 ou transmettre, et rien dans
`ipn/ipnlocal/serve.go` ne renvoie 403 sur ce chemin) ne peuvent produire ce
403 : la reponse vient forcement d'ailleurs, avant meme d'atteindre l'un ou
l'autre. Deux infrastructures sans rapport produisant le meme symptome sur
la meme requete (present uniquement quand l'en-tete `Authorization: Bearer`
est envoye) pointe plus probablement vers ce PC lui-meme (logiciel de
securite avec inspection HTTPS/DLP) que vers Cloudflare ou Tailscale.

Plutot que de deviner un correctif supplementaire, `setup-ollama-bridge.ps1`
capture et affiche desormais le VRAI corps de la reponse et l'en-tete
`Server` de tout echec post-tunnel (nouvelle fonction
`Get-HttpErrorDetail`, geree pour Windows PowerShell 5.1 comme pour
PowerShell 7+) -- jusqu'ici seul le message d'exception generique de
PowerShell etait affiche, jamais le contenu reel de la reponse qui
identifierait qui a repondu a la place de Caddy. Sur un 403 specifiquement,
le script suggere maintenant deux verifications concretes : desactiver
temporairement la protection web de l'antivirus, ou tester depuis un autre
appareil sur un autre reseau pour isoler si le blocage est local a ce PC.

## 2026-09-16 — Correctif Tailscale Funnel : syntaxe CLI obsolete + diagnostic muet

Premier run réel de la version Tailscale : le diagnostic (`-Diagnose`)
passait tout au vert, mais l'exécution complète échouait sur
`'tailscale funnel' a echoue (code 1)`, sans aucun détail affiché — le
script redirigeait `2>&1` puis jetait la sortie avec `Out-Null`, donc le
vrai message d'erreur de Tailscale n'était jamais montré.

Plutôt que de deviner un deuxième correctif, clonage en lecture seule du
dépôt source `tailscale/tailscale` pour lire directement le code du CLI
(`cmd/tailscale/cli/funnel.go`, `serve_v2.go`, `ipn/serve.go`) et confirmer
la cause exacte :
- La syntaxe utilisée, `tailscale funnel 443 on` (positionnelle,
  `<serve-port> {on|off}`), correspond à une implémentation encore présente
  dans le dépôt mais **plus branchée** par le CLI actuel (commentaire du
  code source lui-même : "previously used to serve legacy
  newFunnelCommand... TODO: cleanup"). Le CLI actif fusionne désormais
  `serve` et `funnel` en une seule commande avec des flags
  (`tailscale funnel --bg --https=<port> <cible>`), ce qui explique
  l'échec immédiat (erreur d'usage) sur la syntaxe positionnelle.
- Le diagnostic Funnel (`Test-FunnelPrerequisites`) ne vérifiait en réalité
  rien du tout côté capacités du compte : il analysait le texte de
  `tailscale funnel status --json`, qui ne fait que refléter la config de
  routage déjà en place (vide avant le premier succès), jamais si le nœud a
  réellement les droits `https`/`funnel`. D'où le "OK" affiché alors que la
  cause réelle restait inconnue. Remplacé par une lecture directe de
  `tailscale status --json` -> `Self.CapMap`/`Self.Capabilities`, exactement
  le signal que `ipn.NodeCanFunnel` verifie en interne côté Tailscale.

Corrections dans `setup-ollama-bridge.ps1` :
- Un seul appel `tailscale funnel --bg --https=443 http://127.0.0.1:8787`
  remplace les deux anciens appels (`serve` puis `funnel ... on`).
- En cas d'échec, le message d'erreur réel de Tailscale est maintenant
  capturé et affiché ligne par ligne, au lieu d'être jeté.
- `Test-FunnelPrerequisites` vérifie désormais les vraies capacités du
  nœud (`https`, `funnel`) au lieu d'un texte d'erreur supposé.

## 2026-09-16 — Migration du tunnel public : Cloudflare quick tunnel → Tailscale Funnel

Le tunnel Cloudflare anonyme (`*.trycloudflare.com`) utilisé jusqu'ici
s'est révélé structurellement peu fiable : diagnostiqué précédemment comme
un 403 émis par l'edge Cloudflare lui-même (pas par notre Caddy/Ollama, qui
ne savent répondre que 401 ou transmettre la requête), reproductible à
l'identique sans aucun changement de code dans l'intervalle (confirmé via
`git log`), et documenté par Cloudflare comme n'offrant aucune garantie de
disponibilité — ce type de tunnel n'a ni nom d'hôte fixe ni SLA, par
conception. Plutôt que de continuer à chasser un problème côté
infrastructure Cloudflare sur lequel ce projet n'a aucune prise, bascule
vers **Tailscale Funnel** : gratuit sur le plan Personal, nom d'hôte stable
(`https://<machine>.<tailnet>.ts.net`, ne change plus d'une exécution à
l'autre), HTTPS géré automatiquement par Tailscale, sans achat de nom de
domaine (contrairement à un tunnel Cloudflare *nommé*, qui en nécessite un
réellement rattaché à un compte Cloudflare — vérifié après une première
affirmation erronée en sens inverse). Alternatives explorées et écartées :
ngrok (nom fixe mais quotas de bande passante/requêtes gênants pour de la
génération d'image), Pinggy (sessions limitées à 60 min), Playit.gg
(orienté gaming), Zrok (moins éprouvé pour cet usage).

Trois livrables :
- **`setup-ollama-bridge.ps1`** réécrit : la section 4 (téléchargement de
  `cloudflared.exe`, lancement avec flux redirigés vers des fichiers de
  log, extraction de l'URL par expression régulière sur ces logs) est
  entièrement remplacée par une vérification en amont de l'état Tailscale
  (installé, connecté, MagicDNS actif, certificats HTTPS activés,
  permission Funnel accordée dans la politique ACL — chacun détecté et
  signalé séparément plutôt qu'une erreur générique) puis par
  `tailscale serve` + `tailscale funnel 443 on`, avec lecture de l'URL
  publique via `tailscale funnel status --json` (une API structurée
  documentée, plus fiable que le grattage de logs). Ajout d'un switch
  `-Diagnose` qui n'exécute que ces vérifications Tailscale (sans toucher à
  Ollama/Caddy/au tunnel) pour un diagnostic rapide en cas de souci, avant
  ou après le premier lancement complet. Caddy, Ollama, le jeton secret, le
  surveillant GPU et la mise à jour automatique des réglages Fogbound sont
  conservés sans changement. Le diagnostic 403 Cloudflare-spécifique (User-
  Agent de navigateur, cross-check `curl.exe`, résolution DNS
  système/publique) est retiré : il ne s'appliquait qu'à l'edge Cloudflare,
  qui n'est plus dans le chemin.
- **`cleanup-unused-tunnel-tools.ps1`** (nouveau) : repère et, sur
  confirmation explicite (`-Delete` puis frappe de "OUI"), supprime
  `bin\cloudflared.exe` et ses deux fichiers de log dans le dossier de
  travail du pont, arrête un éventuel processus `cloudflared.exe` encore
  actif avant suppression, et nettoie le champ `cloudflaredPid` devenu
  obsolète dans `config.json`. Ne touche à rien d'autre (Caddy, Ollama,
  AUTOMATIC1111, Tailscale). Mode rapport par défaut, même pattern que
  `cleanup-unused-image-tools.ps1`.
- **`GUIDE-TAILSCALE.md`** (nouveau) : pas à pas pour la configuration
  ponctuelle du compte (création, installation, `tailscale up` — connexion
  interactive obligatoire par navigateur, non scriptable par conception de
  Tailscale) et des deux réglages de la console d'admin nécessaires à
  Funnel (certificats HTTPS, permission `funnel` dans la politique ACL,
  généralement déjà actifs par défaut sur un tailnet neuf mais vérifiés
  explicitement), avec une FAQ sur la stabilité de l'adresse et la
  confidentialité du trafic relayé par Funnel.

## 2026-09-16 — Le 403 persiste malgre le User-Agent : diagnostic renforce

Confirme par un run reel : changer le User-Agent n'a pas suffi, le 403
"avec jeton via le tunnel public" persiste a l'identique. L'hypothese du
User-Agent seul etait donc incomplete.

Plutot que de retenter un autre correctif au hasard, ajout d'un
diagnostic en un seul run (juste avant l'arret du pont sur cet echec, donc
sans avoir a relancer et recuperer une nouvelle URL de tunnel a la main) :
deux requetes via `curl.exe` (client HTTP totalement different de
PowerShell/.NET) vers la meme URL de tunnel --
- une avec exactement le meme en-tete `Authorization: Bearer`, pour voir
  si un client different se heurte au meme mur (isole si le probleme est
  specifique a la pile HTTP de PowerShell/.NET ou non) ;
- une avec le meme jeton mais sous un nom d'en-tete non standard, pour
  tester si c'est precisement le motif "Authorization: Bearer" qui
  declenche un blocage cote Cloudflare (un 401 est attendu de notre propre
  Caddy sur cette deuxieme requete puisqu'il ne reconnait que
  "Authorization" -- seul un 403 sur celle-la serait revelateur).

Objectif : sortir du diagnostic devine (User-Agent) pour un diagnostic
base sur une preuve concrete avant de decider si un changement plus lourd
(renommer l'en-tete d'authentification utilise par toute l'application,
pas seulement ce script) est justifie.

## 2026-09-16 — Diagnostic du 403 via tunnel : cote Cloudflare, pas nous

`setup-automatic1111.ps1` fonctionne enfin de bout en bout (AUTOMATIC1111
repond avec `--api` actif) -- toute la serie de correctifs setuptools/
wheel/CLIP/depot Stability-AI a porte ses fruits. Reste un probleme
distinct, deja repere plus tot : dans `setup-ollama-bridge.ps1`, "sans
jeton" via le tunnel public est correctement rejete (401), mais "avec
jeton" via ce meme tunnel echoue en 403 -- alors qu'aucune de ces deux
requetes ne pose probleme en local.

Diagnostic fait a partir du code plutot que suppose : le Caddyfile genere
par ce script ne peut litteralement repondre que 401 (`respond
"Unauthorized" 401`) ou transmettre la requete a Ollama -- il n'y a nulle
part un "403" possible dans cette configuration. Un 403 recu malgre tout
ne peut donc pas venir de ce script ; ca vient forcement d'ailleurs dans
la chaine, entre le tunnel Cloudflare et notre propre pile. Cause la plus
probable (403 est une reponse connue et documentee des heuristiques anti-
bot/WAF de Cloudflare, y compris sur les tunnels *.trycloudflare.com
anonymes) : le User-Agent par defaut de PowerShell, tres reconnaissable
comme trafic automatise, combine a un en-tete `Authorization` -- un motif
qui ressemble a de l'abus d'identifiants/API aux yeux de ce genre
d'heuristique.

Deux changements :
- **Ajout d'une verification manquante** : ce script testait "sans jeton"
  en local avant d'ouvrir le tunnel, mais jamais "avec jeton" en local --
  il sautait direct au test via le tunnel public. Corrige : un test local
  "avec jeton" existe maintenant, ce qui isole immediatement si un futur
  probleme similaire vient de Caddy lui-meme (visible des ce test local)
  ou specifiquement du tunnel/Cloudflare (seulement le test via tunnel
  echoue).
- **Toutes les requetes de validation** (locales et via tunnel) envoient
  desormais un User-Agent de navigateur normal au lieu de celui, tres
  distinctif, de PowerShell -- pour eviter de se faire filtrer par ce
  genre d'heuristique cote Cloudflare. Message d'erreur enrichi si un 403
  survient quand meme, expliquant que ca ne peut pas venir de ce script et
  suggerant de relancer pour un nouveau sous-domaine de tunnel.

Corrige au passage un caractere accentue isole trouve en auditant ce
fichier (une ligne d'affichage cosmetique, sans impact fonctionnel, mais
contraire a la convention ASCII-only deja etablie pour ces scripts).

## 2026-09-16 — CLIP resolu, nouveau blocage : depot Stability-AI disparu

CLIP s'installe desormais avec succes (confirme par le journal de
l'utilisateur : "OK: CLIP installe avec succes.") -- la chaine de
correctifs setuptools/wheel/pkg_resources est bel et bien terminee.
Nouveau blocage juste apres, sur un tout autre depot : AUTOMATIC1111
essaie de cloner `https://github.com/Stability-AI/stablediffusion.git`
et echoue avec "Repository not found" (code 128).

Verifie avant de corriger : ce depot officiel a ete retire/rendu prive
courant decembre 2025, confirme par plusieurs tickets reels ouverts sur
le depot GitHub d'AUTOMATIC1111 a cette periode (#17204, #17205, #17213,
#17216, #17218...), pas une supposition. La branche `dev` d'AUTOMATIC1111
contourne deja ce probleme en pointant vers un miroir communautaire
(`w-e-w/stablediffusion.git`) -- verifie que ce miroir contient bien le
commit exact attendu (`cf1d67a6...`, meme auteur et contenu que
l'original) avant de s'y fier. Egalement verifie que les autres depots
Stability-AI clones par ce webui (`generative-models` pour SDXL) ne sont
pas affectes -- seul `stablediffusion` a ete retire.

Corrige simplement en definissant la variable d'environnement
`STABLE_DIFFUSION_REPO`, deja lue par le `launch_utils.py` de cette
installation (meme mecanisme que `CLIP_PACKAGE`) -- pas besoin de cloner
quoi que ce soit soi-meme ni de modifier le code d'AUTOMATIC1111.

## 2026-09-16 — Correctif CLIP, round suivant : il manquait "wheel"

Bonne nouvelle confirmee par le nouveau `clip-preinstall.log` demande a
l'utilisateur : le correctif `pkg_resources` (setuptools==69.5.1) a
fonctionne cette fois -- l'erreur a change, passant de
`ModuleNotFoundError: No module named 'pkg_resources'` a un simple
`DeprecationWarning` (pas un echec) suivi d'une toute nouvelle erreur :
`error: invalid command 'bdist_wheel'`.

Verifie avant de corriger : cette erreur precise correspond exactement au
cas bien documente ou `--no-build-isolation` (necessaire pour eviter le
bug setuptools) a aussi pour effet de sauter l'environnement de build
isole normal de pip -- qui aurait sinon fourni automatiquement le paquet
`wheel` (et sa commande setuptools `bdist_wheel`). Sans `wheel` deja
present dans ce venv, la construction de CLIP echoue avec exactement ce
message. Corrige en installant `wheel` en meme temps que
`setuptools==69.5.1`, avant la tentative d'installation de CLIP.

## 2026-09-15 — Revue independante : 6 bugs reels corriges, 1 fausse alerte

Suite a la demande de faire relire le script par une instance Claude
independante (sans connaitre cette conversation), pour sortir du cycle
correctif-au-coup-par-coup. Chaque point signale a ete verifie avant
correction, pas applique tel quel :

- **Fausse alerte ecartee** : le rapport affirmait que `Start-Process`
  plante sur un fichier `.bat` des qu'on redirige les flux (limitation
  connue de l'API Win32 `CreateProcess` brute). Verifie contre les vrais
  journaux de cette session : le script a deja lance `webui-user.bat` avec
  les trois redirections (sortie, erreur, entree) et produit sa vraie
  sortie a plusieurs reprises sur la machine reelle de l'utilisateur --
  contradiction directe avec l'affirmation. Confirme aussi par la
  documentation Microsoft : `Start-Process -RedirectStandardOutput` sur un
  `.bat` est un usage documente qui fonctionne. Rien change ici.
- **`-SdPort` n'etait jamais applique** (confirme par grep) : documente et
  utilise pour l'interrogation de l'API, mais jamais ecrit dans
  `COMMANDLINE_ARGS` -- une valeur non standard donnait un faux "timeout
  15 minutes" garanti alors qu'AUTOMATIC1111 tournait bien sur son port
  reel par defaut. Ajout d'un bloc `--port` symetrique a celui de `--api`.
- **Detection `--api` par sous-chaine non delimitee** (confirme en lisant
  la regex) : `--api-log` ou `--api-auth` (vrais flags AUTOMATIC1111)
  auraient ete pris a tort pour `--api` deja actif. Corrige avec
  `(?!\S)` pour exiger une fin de mot.
- **Telechargements partiels/corrompus jamais detectes** : une coupure
  reseau en cours de telechargement (plausible sur des fichiers de
  plusieurs Go) laissait un fichier tronque au nom final, que la
  verification de presence (nom seul, pas taille) prenait pour un modele
  complet, sans jamais retenter -- l'echec ne serait apparu que bien plus
  tard, comme un "checkpoint corrompu" cote AUTOMATIC1111. Corrige :
  telechargement vers un nom temporaire, verification de taille minimale
  (100 Mo) avant de le promouvoir au nom final, nettoyage du fichier
  partiel en cas d'echec.
- **Nom de fichier casse pour un `-ModelUrl` sans extension** (le cas
  Civitai, dont les liens `/api/download/models/<id>` n'ont pas de nom de
  fichier dans l'URL elle-meme) : le nom recupere aurait ete un identifiant
  numerique sans extension, invisible pour AUTOMATIC1111, tout en etant
  rapporte comme un succes. Corrige : lecture du vrai nom depuis l'en-tete
  `Content-Disposition` de la reponse, repli sur `.safetensors` en dernier
  recours plutot que de laisser un nom sans extension.
- **`VENV_DIR` personnalise ignore** : ce script supposait toujours le
  sous-dossier `venv` par defaut, alors qu'une installation existante
  (exactement le cas que ce script est cense auto-detecter) peut pointer
  ailleurs via `VENV_DIR` dans `webui-user.bat`. Corrige : lu et utilise
  s'il est present. Limitation documentee (pas corrigee, portee trop large
  pour le gain) : un `--ckpt-dir` personnalise pour les modeles n'est
  toujours pas detecte.
- **Trappe PowerShell 7.3+ non couverte** : `$PSNativeCommandUseErrorActionPreference`
  (actif par defaut depuis PS 7.3) transforme un code de sortie non-nul
  d'une commande native en erreur bloquante, independamment de toute
  capture de stderr -- un mecanisme different de celui deja corrige
  precedemment, touchant deux appels non proteges (`git clone`, creation
  du venv). `Invoke-NativeQuiet` protege aussi contre celui-ci (son
  abaissement de `$ErrorActionPreference` couvre les deux cas), etendu a
  ces deux appels ; ajout au passage d'une verification `$LASTEXITCODE`
  manquante sur la creation du venv.

## 2026-09-15 — La pre-installation de CLIP echouait en silence

Confirme par un nouveau run reel identique au tout premier (meme erreur
"Couldn't install clip" / `pkg_resources`) malgre le correctif
setuptools==69.5.1 + `--no-build-isolation` livre juste avant. Element
determinant du diagnostic : le journal montre un chemin
`AppData\Local\Temp\pip-build-env-XXXXX\overlay\...`, un environnement de
build ISOLE -- or l'installation faite par ce script utilise justement
`--no-build-isolation`, qui empeche la creation d'un tel dossier. Donc
cette erreur precise venait forcement de la propre tentative
d'AUTOMATIC1111 (`launch_utils.py`, qui n'utilise jamais
`--no-build-isolation`), pas de la pre-installation de ce script.
Verifie dans le code source d'AUTOMATIC1111 (a l'exact commit utilise) :
il saute bien sa propre installation si `is_installed("clip")` est vrai
-- donc la pre-installation de ce script avait echoue silencieusement,
sans laisser de trace exploitable pour savoir pourquoi.

Corrige : les deux installations pip de cette etape (setuptools, puis
CLIP) capturent maintenant leur sortie complete (au lieu de la jeter avec
`2>$null`) et l'ecrivent dans un nouveau `clip-preinstall.log`, affichee
directement en cas d'echec au lieu d'un message vague. Ajout aussi d'une
re-verification apres un `pip install` qui rapporte un succes (`import
clip` a nouveau) au cas ou l'installation "reussirait" sans que le module
soit reellement importable.

## 2026-09-15 — Audit systematique : plus de correctif au coup par coup

Suite a une remarque justifiee (assez de corriger reactivement une erreur
a la fois) : au lieu d'attendre le prochain plantage pour trouver le
prochain endroit touche par le meme bug, audit complet du script pour
cette classe de bug precise, en une seule fois.

**Le vrai probleme, explique clairement** : sous Windows PowerShell 5.1,
des qu'une commande externe (py, pip, python...) voit sa sortie d'erreur
(stderr) capturee d'une facon ou d'une autre (`2>&1`, `2>$null`, vers un
fichier), PowerShell transforme cette sortie en `ErrorRecord`. Sans
redirection de stderr, ce probleme n'existe pas du tout, quelle que soit
la valeur de `$ErrorActionPreference` — c'est precisement le fait de
capturer stderr qui declenche le comportement. Ce script fixe
`$ErrorActionPreference = "Stop"` en haut du fichier (deliberement, pour
que les echecs de cmdlets PowerShell — ecriture de fichier, creation de
dossier — arretent le script au lieu de continuer silencieusement dans un
etat casse) ; combine au premier point, ca transforme n'importe quelle
sortie stderr anodine d'une commande native capturee (un avertissement
pip, une note de deprecation — pas forcement un vrai echec) en plantage
complet du script.

**Correctif systematique** : une fonction reutilisable `Invoke-NativeQuiet`
abaisse temporairement `$ErrorActionPreference` a `"Continue"` autour d'un
bloc de code (`$LASTEXITCODE` reste verifie normalement pour detecter un
vrai echec), et TOUS les appels a une commande externe qui capturent
stderr dans ce script (trouves en cherchant chaque `2>` du fichier, pas
en devinant) l'utilisent desormais : les deux verifications de version de
Python dans `Test-Python310` (un risque latent qui n'avait jamais encore
declenche pour cet utilisateur, mais qui aurait fini par le faire) et les
trois appels pip/python du correctif CLIP. `$ErrorActionPreference =
"Stop"` reste actif partout ailleurs, la ou il protege reellement contre
des echecs silencieux de cmdlets PowerShell.

## 2026-09-15 — Correctif : le simple fait d'ecrire sur stderr plantait tout

Confirme par un run reel : la toute premiere commande du correctif CLIP
precedent (`& $VenvPython -c "import clip" 2>$null`) faisait planter le
script entier avec une "NativeCommandError", avant meme d'avoir pu
determiner si CLIP etait installe ou non.

Cause, verifiee (pas supposee) : sous Windows PowerShell 5.1, toute
sortie sur stderr d'une commande native est transformee en `ErrorRecord`
des qu'elle est capturee -- meme rediriger vers `2>$null` ne l'empeche
pas. Comme ce script fixe `$ErrorActionPreference = "Stop"` en haut du
fichier, cet `ErrorRecord` devient une erreur bloquante et arrete tout,
meme si la sortie stderr en question n'etait qu'un avertissement pip sans
rapport avec un echec reel. Corrige en abaissant temporairement
`$ErrorActionPreference` a `"Continue"` autour de ce bloc de commandes
natives (restaure juste apres) -- `$LASTEXITCODE` continue d'etre verifie
normalement pour detecter un vrai echec.

## 2026-09-15 — Correctif : PIP_CONSTRAINT ne marchait pas non plus pour CLIP

Confirme par un troisieme run reel identique : meme apres le correctif
PIP_CONSTRAINT, l'installation de CLIP echouait exactement de la meme
facon (`ModuleNotFoundError: No module named 'pkg_resources'`). Verifie
avant de recorriger, comme demande : la suppression de `pkg_resources`
dans setuptools 82.0 (8 fevrier 2026) tient toujours a ce jour (derniere
version documentee : 84.0.0, la demande de restauration cote
`pypa/setuptools` n'a pas abouti) -- le diagnostic restait donc valide.
Ce qui ne l'etait pas : le changelog de pip confirme que les fichiers de
contraintes, PIP_CONSTRAINT inclus, ne s'appliquent plus aux
environnements de build isoles depuis une version recente de pip
(remplace par `PIP_BUILD_CONSTRAINT`, non garanti present selon la
version de pip embarquee).

Remplace par la correction concretement rapportee comme fonctionnelle
sur les tickets GitHub d'AUTOMATIC1111 pour cette meme erreur : fixer
`setuptools==69.5.1` directement DANS le venv, puis installer CLIP avec
`--no-build-isolation` (pip reutilise alors le setuptools deja installe
au lieu de recreer un environnement isole avec la derniere version).
Fait avant le lancement de webui-user.bat (qui trouve alors CLIP deja
importable et saute sa propre tentative d'installation), avec l'URL du
paquet CLIP lue directement dans `modules/launch_utils.py` de
l'installation plutot que codee en dur (secours sur l'URL vue dans le
journal d'erreur reel si cette lecture echoue). Positionne avant la
sortie anticipee de `-SkipLaunch` -- une version intermediaire de ce
correctif l'avait place apres par erreur, le sautant silencieusement
dans ce cas precis.

## 2026-09-15 — Correctif : "NUL" comme -RedirectStandardInput echouait

Confirme par un run reel juste apres le correctif precedent : la ligne
`-RedirectStandardInput "NUL"` (cense donner une fin de fichier immediate
a `pause`) faisait planter `Start-Process` avec une
`FileNotFoundException` -- PowerShell resout `"NUL"` comme un nom de
fichier relatif au dossier courant (`<dossier>\NUL`) plutot que comme le
peripherique special de Windows, contrairement au comportement de cmd.exe
avec `< NUL`. Remplace par un vrai fichier vide
(`automatic1111-stdin.empty` dans le dossier de travail, cree s'il
n'existe pas) qui donne exactement le meme resultat (fin de fichier
immediate) sans dependre de cette resolution de nom special.

## 2026-09-15 — Correctif : le nettoyage par PID unique ne suffisait pas

Confirme par un run reel : le correctif precedent (suivre le PID lance
dans la config, le tuer au run suivant) n'a pas suffi -- le processus
verrouillant toujours `automatic1111.log`. Cause : `Start-Process
-FilePath <webui-user.bat>` renvoie le PID de `cmd.exe`, qui lance ensuite
`python.exe` en processus enfant -- or `Stop-Process` sur un parent ne
tue pas ses enfants sous Windows. Le vrai detenteur du fichier de log
(`python.exe`) survivait donc intact meme apres avoir "arrete" le
processus suivi.

Remplace par une detection basee sur la ligne de commande
(`Get-CimInstance Win32_Process`, seule API qui expose `CommandLine` --
contrairement a `Get-Process`) : cherche tout processus dont la ligne de
commande contient le chemin de cette installation, ce qui attrape aussi
bien `cmd.exe` (ligne de commande = chemin du .bat) que `python.exe`
(ligne de commande = chemin de `launch.py`), sans dependre d'une relation
parent/enfant ni d'un PID enregistre au prealable.

## 2026-09-15 — Correctif : relancer apres un run bloque plantait sur les logs

Confirme par un run reel : le run precedent, bloque sur le `pause` corrige
plus haut (avant ce correctif, lance sans redirection de stdin), etait
toujours vivant au relancement du script et tenait encore
`automatic1111.log` ouvert -- `Remove-Item` plantait alors avec "utilise
par un autre processus" et arretait tout le script (`$ErrorActionPreference
= "Stop"` transforme cette erreur normalement non bloquante en erreur
bloquante).

Le script enregistre desormais le PID du processus lance dans son fichier
de config (`automatic1111-config.json`), et au demarrage de l'etape de
lancement, verifie s'il tourne encore (avec une verification que son
executable est bien sous le dossier de cette installation avant de le
tuer, au cas ou Windows aurait recycle ce PID pour autre chose depuis) --
si oui, il est arrete proprement avant de continuer, au lieu de faire
planter le script sur des journaux verrouilles. La suppression des
journaux est aussi maintenant dans un `try/catch` avec un message clair
si elle echoue quand meme (autre cause).

Note pour l'utilisateur concerne : le run bloque qui a declenche ce
correctif date d'avant qu'il n'enregistre son PID (fonctionnalite absente
a l'epoque) -- un `Stop-Process` manuel one-shot reste necessaire pour
celui-la specifiquement ; tous les runs suivants se nettoieront seuls.

## 2026-09-15 — Correctifs reels (pas devines) sur un vrai run bloque

Diagnostic a partir des journaux reels envoyes par l'utilisateur (le
premier run de `setup-automatic1111.ps1` restait "en cours" 15 minutes
sans jamais repondre) plutot que d'ajuster au hasard :

- **Cause racine trouvee dans `automatic1111.err.log`** : `setuptools`
  82.0 (sorti en fevrier 2026) a completement supprime `pkg_resources` ;
  le paquet CLIP d'OpenAI (dependance non figee installee a chaque venv
  neuf par ce webui) importe encore `pkg_resources` dans son `setup.py`
  a l'ancienne, et pip installe toujours la derniere version de
  `setuptools` dans son environnement de build isole, quelle que soit la
  version deja presente ailleurs. Resultat : `RuntimeError: Couldn't
  install clip` / `ModuleNotFoundError: No module named 'pkg_resources'`
  sur toute installation neuve faite aujourd'hui, independamment du GPU.
  Corrige en fixant `setuptools<81` via la variable d'environnement
  `PIP_CONSTRAINT` (mecanisme documente de pip qui s'applique meme a
  l'interieur du build isole) avant le lancement — sans modifier
  `launch.py` d'AUTOMATIC1111, qu'un futur `git pull` ecraserait de toute
  facon.
- **Bug structurel trouve en creusant "pourquoi ca ne plante pas mais ne
  repond pas non plus"** : `webui-user.bat` appelle `pause` quand une
  etape d'installation echoue (pour garder une fenetre normale ouverte le
  temps de lire l'erreur). Lance en `-WindowStyle Hidden` sans stdin
  redirige, ce `pause` attendait une touche sur une fenetre invisible et
  inatteignable — le run bloque 15 minutes n'etait donc pas lent, il etait
  silencieusement coince sur ce prompt depuis le debut. Corrige en ajoutant
  `-RedirectStandardInput "NUL"` a l'appel `Start-Process` : `pause` recoit
  une fin de fichier immediate et rend la main tout de suite, donc une
  vraie erreur remonte maintenant en quelques secondes au lieu de rester
  bloquee indefiniment.

## 2026-09-15 — TODO : progression reelle a la creation + slider continu

Deux items du backlog (`TODO.md`), hors ceux notes pour la sortie v1.0 :

- **Barre de progression de creation de monde, rendue reelle.** Ce n'etait
  qu'une animation CSS en boucle (`progress-slide`) synchronisee avec rien
  cote serveur. La creation d'un monde utilise maintenant un appel IA
  streame (`streamTextTracked` dans `lib/gameEngine.js`, meme
  infrastructure que le streaming des tours) ; nouvelle route
  `POST /api/worlds/stream` (protocole NDJSON identique a
  `POST /api/saves/:id/turn/stream`) qui pousse `{"type":"progress",
  "chars":N}` a chaque fragment recu. Le client calcule un pourcentage
  reel a partir des caracteres effectivement recus (plafonne a 95% avant
  la fin, pour ne jamais sembler bloque ou depasser 100% sur une reponse
  plus longue que l'estimation). L'ancienne route `POST /api/worlds` (non
  streamee) reste en place, inchangee.
- **Slider de longueur des chapitres, granularite continue.** Remplace les
  3 paliers fixes (court/moyen/long ~200/400/800 mots) par un curseur 100
  a 1000 mots par pas de 100 (10 positions), le nombre de mots affiche
  directement. `chapterLength` passe d'un enum string a un nombre entier
  partout (`lib/db.js`, `server.js`, `lib/promptBuilder.js`,
  `public/app.js`) — `lib/promptBuilder.js` calcule desormais une
  fourchette resserree (N-50 a N+50 mots) au lieu d'une chaine fixe.
  Migration automatique au demarrage pour les `db.json` existants encore
  sur l'ancien enum (`short`/`medium`/`long` → 200/400/800), et validation
  cote serveur qui arrondit/borne toute valeur recue au pas de 100 le plus
  proche dans [100, 1000].

## 2026-09-15 — Detection automatique des modeles IA locale (menu deroulant)

Ajout d'un menu deroulant qui detecte les checkpoints deja presents sur le
PC via AUTOMATIC1111 (`/sdapi/v1/sd-models`), pour ne plus avoir a taper le
nom de fichier a la main dans le champ "Modele d'image" d'un monde :

- `providers/imageProviders.js` expose `listLocalSdModels`, qui classe
  chaque checkpoint trouve par mot-cle sur son nom de fichier
  ("illustration" pour NoobAI-XL/Illustrious/Pony/etc.,
  "photorealiste" pour RealVisXL/Juggernaut/etc., "autre" sinon — toujours
  une categorie, jamais rien).
- Nouvelle route `GET /api/localsd/models` (meme schema que
  `/api/ollama/models`), branchee via `listAvailableLocalSdModels` dans
  `lib/gameEngine.js`.
- Cote interface, l'editeur de monde affiche desormais un menu deroulant
  au-dessus du champ texte, avec le format demande : "Illustration - nom"
  / "Photorealiste - nom" / "Autre - nom" — le choisir remplit le champ
  texte (qui reste modifiable a la main), sur le meme principe que le menu
  de presets deja utilise pour le modele de texte Ollama. Rafraichi a
  chaque ouverture de l'editeur de monde ; echoue silencieusement vers la
  saisie manuelle si le pont PC n'est pas joignable.

## 2026-09-15 — Deux profils de modele local (illustration + photorealiste)

Suite a la question "NoobAI-XL fait-il aussi du photorealiste ?" — reponse
non, c'est un modele exclusivement anime/illustration (entraine sur des
donnees Danbooru/e621), incapable de produire un rendu photo credible quel
que soit le prompt. Ajout d'un second profil et branchement reel du choix
cote backend :

- `setup-automatic1111.ps1` telecharge maintenant **deux** modeles par
  defaut au lieu d'un si les deux manquent : NoobAI-XL v1.1 (illustration,
  inchange) et **RealVisXL V5.0** (SG161222, SDXL photorealiste, non
  censure — verifie capable de rendu NSFW en local avant de le retenir).
  La detection est maintenant faite modele par modele (et non plus "un
  modele suffit, on s'arrete la") : si l'un des deux manque, il est
  telecharge, meme si l'autre ou un modele personnalise est deja present.
  `-ModelUrl` s'ajoute desormais aux deux profils par defaut au lieu de les
  remplacer ; `-NoAutoModel` desactive le telechargement automatique des
  deux (~14 Go ensemble).
- **Le choix n'etait pas branche cote backend** : `providers/imageProviders.js`
  ignorait completement le parametre `model` pour le fournisseur `localsd`
  — il generait toujours avec le modele actuellement charge dans
  AUTOMATIC1111, quoi qu'on mette dans le champ "Modele d'image" d'un
  monde. Corrige en passant `override_settings.sd_model_checkpoint` (le
  mecanisme documente d'AUTOMATIC1111 pour choisir un checkpoint par
  requete) quand un modele est precise — ce champ, deja un texte libre
  utilise pour Replicate, accepte maintenant aussi le nom exact d'un
  fichier checkpoint local (ex. `NoobAI-XL-v1.1.safetensors` ou
  `RealVisXL_V5.0_fp16.safetensors`), avec l'indication mise a jour dans
  les deux langues.

## 2026-09-15 — Script de nettoyage des telechargements IA image inutilises

Nouveau `scripts/windows/cleanup-unused-image-tools.ps1`, suite a une
recherche menee par l'utilisateur sur son PC qui a remonte deux categories
de telechargements existants ne servant a rien pour Fogbound :

- Deux modeles Hugging Face en cache (`runwayml/stable-diffusion-v1-5`,
  `stabilityai/sd-turbo`, ~10.6 Go a eux deux) au format diffusers
  (dossier pipeline multi-fichiers), pas un `.safetensors`/`.ckpt` unique
  chargeable par AUTOMATIC1111 — et de toute facon des modeles anciens,
  moderes et de qualite inferieure au NoobAI-XL desormais telecharge par
  defaut par `setup-automatic1111.ps1` pour le style recherche (proche
  d'Infinite Worlds, non censure). Les convertir n'aurait donc pas eu de
  sens.
- Une archive ComfyUI portable jamais extraite (~1.95 Go) avec son script
  d'installation — ComfyUI est une UI differente d'AUTOMATIC1111 avec une
  API differente (graphe de noeuds, pas `/sdapi/v1/txt2img`), donc
  l'adopter demanderait de reecrire la partie fournisseur d'image cote
  backend de Fogbound, pas juste lancer un script.

Le script cherche ces elements automatiquement (cache Hugging Face
standard, dossiers Telechargements/Bureau/Documents), affiche ce qu'il
trouve et leur taille, et ne supprime rien par defaut — `-Delete` propose
la suppression, avec une confirmation tapee (`OUI`) avant d'agir, vu qu'il
s'agit de plusieurs Go de telechargements existants.

## 2026-09-15 — Modele par defaut NoobAI-XL + correctif RTX 50xx (Blackwell)

Deux ajouts a `setup-automatic1111.ps1` suite a une question sur quel
modele choisir pour se rapprocher du style d'Infinite Worlds sur une RTX
5080 :

- **Modele par defaut change** pour NoobAI-XL v1.1 (Laxhar Lab), un
  checkpoint SDXL/Illustrious anime et illustration, non censure, version
  epsilon-prediction (compatible avec les samplers standards, contrairement
  a la version v-pred separee qui demande des reglages WebUI en plus).
  Infinite Worlds etant closed-source et ne publiant pas son modele exact,
  c'est le choix le plus proche et le mieux considere actuellement pour ce
  style. Le message d'echec de telechargement mentionne maintenant que
  Hugging Face peut demander une connexion pour ce modele (marque "contenu
  mature") et donne l'URL a ouvrir dans un navigateur si besoin.
- **Correctif de compatibilite RTX 50xx (Blackwell) decouvert en
  recherchant la question** : AUTOMATIC1111 fixe encore par defaut
  torch==2.1.2 (CUDA 12.1) dans son `launch_utils.py`, une version sans
  noyaux compiles pour l'architecture sm_120 des GPU 50xx (confirme par de
  vrais rapports d'utilisateurs RTX 5080/5090) — le premier lancement
  reussirait a installer les dependances puis planterait a la toute
  premiere generation d'image avec "no kernel image is available for
  execution on the device". Le script detecte maintenant une RTX 50xx via
  `Win32_VideoController` et remplace `TORCH_COMMAND` dans
  `webui-user.bat` par un pip install pointant vers les wheels PyTorch
  cu128 (compatibles Blackwell) avant le premier lancement.

## 2026-09-15 — Script d'installation automatique d'AUTOMATIC1111

Nouveau `scripts/windows/setup-automatic1111.ps1`, la pièce manquante pour
la génération d'image locale : `setup-ollama-bridge.ps1` prépare déjà la
route proxy authentifiée (`/sdapi/*`) et détecte si quelque chose répond
sur le port 7860, mais n'installait pas AUTOMATIC1111 lui-même.

- **Détection automatique des dossiers** (le point demandé) : cherche une
  installation existante (fichier `webui-user.bat`) dans le profil
  utilisateur, Bureau, Téléchargements et Documents avant de proposer un
  clonage — mémorise ensuite l'emplacement trouvé (ou cloné) dans un petit
  fichier de config à côté de celui de `setup-ollama-bridge.ps1`, pour ne
  plus jamais avoir à rechercher aux lancements suivants.
- Même logique pour un **modèle Stable Diffusion** déjà téléchargé : si le
  dossier `models\Stable-diffusion` est vide, cherche un `.safetensors`/
  `.ckpt` dans Téléchargements/Bureau et le déplace automatiquement au bon
  endroit. **Correctif du même jour** : la première version s'arrêtait là
  si rien n'était trouvé, en demandant à l'utilisateur de télécharger un
  modèle à la main — contraire à l'objectif d'un script d'installation
  entièrement automatique. Elle télécharge maintenant un modèle par défaut
  (Stable Diffusion 1.5, fp16, ~2 Go, hébergé sur Hugging Face sans
  authentification requise — vérifié accessible avant intégration) quand
  rien n'est trouvé et qu'aucune `-ModelUrl` n'est fournie ; `-ModelUrl`
  permet de choisir un autre modèle, `-NoAutoModel` de revenir à l'ancien
  comportement (s'arrêter et choisir soi-même). Le téléchargement désactive
  temporairement la barre de progression de `Invoke-WebRequest`, dont le
  rendu ralentit considérablement les téléchargements volumineux sous
  Windows PowerShell 5.1.
- Installe Python 3.10 et Git via winget si absents (même approche que
  l'installation d'Ollama dans le script existant).
- Active `--api` dans `webui-user.bat` de façon idempotente (jamais ajouté
  deux fois), lance le serveur, et attend patiemment que l'API réponde
  (jusqu'à 15 minutes — le tout premier lancement télécharge plusieurs Go
  de dépendances PyTorch).
- Deux bugs corrigés avant de livrer, trouvés en relisant le script à tête
  reposée plutôt qu'en le testant sur une vraie machine (toujours
  impossible dans ce bac à sable) : `-Include` sans `-Recurse` ni
  caractère générique final sur `-Path` est silencieusement ignoré par
  PowerShell (aurait renvoyé tous les fichiers du dossier, pas seulement
  les modèles) ; et un caractère accentué isolé dans un message d'erreur,
  contraire à la convention ASCII-only déjà établie pour ces scripts
  (PowerShell 5.1 lit un `.ps1` sans BOM avec le codepage ANSI du système,
  ce qui corromprait ce caractère au chargement).

## 2026-09-15 — Réorganisation complète de la page de tour (inspirée d'Infinite Worlds)

Suite à l'analyse d'une vraie capture d'écran d'Infinite Worlds (confirmée
élément par élément par l'utilisateur) et de plusieurs maquettes comparées
avant implémentation :

- **Le texte du tour passe en premier**, immédiatement après le titre/
  personnage/objectif — tout le reste (icônes 🔍/✏️, info secrète, image,
  objets suivis, actions) suit en dessous, plus au-dessus comme avant.
- **Carte à deux volets toujours visible** (`public/index.html` :
  `.segmented-card`) remplaçant l'ancien bouton 🖋️ + popover caché :
  "Ton action" (🎯) et "Instruction au narrateur (optionnel)" (🖋️) sont
  désormais deux champs permanents, chacun avec sa propre icône. Envoyer
  avec les deux remplis combine action ET instruction en un seul tour ;
  avec seulement l'instruction remplie, c'est l'ancien "mode auteur" (une
  instruction hors-personnage pure) ; avec seulement l'action, un tour
  normal.
- **Backend** : `authorNote` (déjà utilisé par la régénération pour "je
  veux qu'il se passe plutôt...") est maintenant aussi accepté par
  `POST /turn` et `POST /turn/stream` — c'était la seule vraie modification
  back-end nécessaire, `playTurn`/`playTurnStreaming` le supportaient déjà.
  Le texte du prompt ("NARRATOR GUIDANCE FOR THIS RETRY...") a été
  généralisé en "FOR THIS TURN" puisqu'il s'applique maintenant aussi hors
  régénération.
- **Navigation de tour unifiée**, affichée sur toutes les pages (tour
  actuel, passé, ou fin de partie) : "Tour X / Y" puis une rangée à trois
  boutons [‹ Précédent] [🔄 Régénérer, centré] [Suivant ›] — Régénérer et
  Suivant apparaissent désormais aussi sur les pages passées (avant,
  seules "Reprendre à partir d'ici" y était disponible).
- **Sécurité ajoutée en cours de route, pas dans la demande initiale** :
  régénérer un tour, quel qu'il soit, fait un rewind puis rejoue
  (`rewindToTurn` dans `lib/gameEngine.js`) — donc régénérer un tour passé
  supprime silencieusement tous les tours suivants, exactement comme
  "Reprendre à partir d'ici". Ajout d'un avertissement visible dans la
  popover ("supprimera aussi les N tours suivants") et d'une confirmation
  native quand ce n'est pas le dernier tour, pour ne pas exposer une
  action aussi destructrice sans le signaler.
- **Bug de structure trouvé en testant** : la popover de régénération était
  restée imbriquée dans `#latestPageActions`, qui est justement masqué sur
  une page passée — elle ne s'ouvrait donc jamais visuellement depuis une
  page passée malgré un JS correct. Sortie comme élément frère indépendant.
- 👤 (fiche personnage) volontairement laissé de côté cette fois — son
  popup n'a pas encore été conçu, sera fait dans une prochaine passe.

Vérifié en navigateur réel (Playwright, fournisseur mock, sauvegarde à
plusieurs tours) : ordre du DOM, indicateur de tour sur chaque page,
double-soumission action+instruction, soumission instruction seule,
avertissement + confirmation avant régénération d'un tour passé (annulée
puis acceptée pour de vrai — total de tours réduit comme attendu),
régénération du dernier tour sans avertissement ni confirmation, bouton
d'édition du monde fonctionnel depuis sa nouvelle position.

## 2026-09-15 — Refonte de la barre d'action (bas de l'écran)

Demandé après capture d'écran mobile : le bouton "mode auteur" (🔍) était
isolé tout en haut, loin du bouton de régénération (🔄) en bas ; le même
champ texte changeait silencieusement de sens selon un toggle éloigné
(action du joueur ↔ instruction au narrateur) ; et le champ `<input
type="text">` défilait horizontalement une fois le texte plus long que la
case, rendant la relecture très difficile en tapant.

- **🔍 déplacé et regroupé avec 🔄** dans la barre du bas (`action-row`),
  au lieu du haut de l'écran. Son rôle est maintenant uniquement de
  révéler les informations cachées (bloc secret, badges de résultat) — il
  ne change plus le sens du champ de saisie principal.
- **Nouveau bouton 🖋️ dédié** ("parler au narrateur"), visible seulement
  quand 🔍 est actif, qui ouvre une fenêtre dédiée (même style que la
  popover de régénération existante) avec son propre champ et un flux
  explicite Envoyer/Annuler — au lieu de réinterpréter silencieusement la
  case de saisie normale. `playAction()` accepte maintenant un
  `authorMode` explicite par appel plutôt que de lire un état global.
- **Champs texte remplacés par des zones qui grandissent en hauteur**
  (`<textarea>` avec redimensionnement automatique via `autoGrowTextarea`
  dans `app.js`, plafonné à 160px puis défilement interne) au lieu de
  défiler horizontalement — sur la case d'action principale, les deux
  champs de la popover de régénération, et la nouvelle popover
  d'instruction. Entrée envoie (comme avant avec l'ancien `<input>`),
  Maj+Entrée insère un retour à la ligne — convention du chat Claude
  actuel, citée par l'utilisateur comme référence.
- **Correctif découvert en testant** : la ligne de boutons (🔍/🖋️/🔄 +
  case + Envoyer) avait `position: sticky` seulement sur le `<form>`, pas
  sur ses boutons-icônes frères — invisible avec l'ancien champ à hauteur
  fixe, mais avec une zone qui grandit, le formulaire collé en bas du
  viewport se détachait visuellement des icônes restées dans le flux
  normal du document. Corrigé en rendant toute la ligne (`.action-row`)
  sticky comme un seul bloc, plutôt que juste le formulaire.

Vérifié en navigateur réel (Playwright, fournisseur mock) : positionnement
des boutons, bascule du mode révélation, apparition/disparition de 🖋️,
croissance et rétrécissement correct de la zone de texte sans débordement
horizontal, alignement de la ligne complète avant/après correctif, et
Maj+Entrée vs Entrée simple (nouvelle ligne insérée puis tour envoyé avec
le texte complet sur deux lignes).

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
