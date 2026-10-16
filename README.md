# Arbre famille Louis

Code du service officiel Railway **Arbre famille Louis**.

- Site : https://test-installation-production.up.railway.app/
- Code Bun actuellement déployé : [railway-function.js](railway-function.js)
- Interface et arbre familial : servis à partir du HTML compressé dans les variables `APP_CHUNK_COUNT` et `APP_CHUNK_*` de Railway.
- Ajouts et corrections familiales : stockés dans le volume persistant configuré sur Railway ; ils ne sont pas inclus dans ce dépôt.

## Confidentialité et configuration

Ce dépôt GitHub est **public**. Il ne contient **ni le fichier HTML avec les données personnelles de la famille**, ni le code familial, ni les variables secrètes, ni les données du volume Railway.

Le code serveur utilise notamment des variables d'environnement pour charger la page, protéger la modification des fiches et conserver les données. Les valeurs secrètes doivent rester configurées dans Railway. Le dépôt, pris isolément, ne constitue donc **pas une sauvegarde complète et autonome** du site.

Pour une sauvegarde intégrale avec les données généalogiques, privilégier un dépôt **privé** avec un contrôle d'accès adapté, et conserver les secrets hors de Git.

## Publication

Source de référence : service Railway officiel `Arbre famille Louis`. Le service `notre-histoire-copie` est distinct et n'a pas été modifié par cette publication.

## Comment ce service est réellement déployé

Point important, et non évident : **le service n'est pas déployé depuis ce dépôt GitHub.**

- L'instance tourne sur une image `ghcr.io/railwayapp/function-bun:1.4.0` avec
  `builder: RAILPACK` et **aucun dépôt lié** (`source.repo` est `null`).
- Le code serveur est **inliné en base64 dans le `startCommand`** de l'instance :
  `./run.sh <base64 de railway-function.js>`. Le format a été vérifié octet pour
  octet contre le blob Git du commit publié.
- La page, elle, est livrée par les variables `APP_CHUNK_COUNT` et `APP_CHUNK_*`.

Conséquence : **un `git push` ne déploie rien.** Pour publier une modification, il faut
à la fois mettre à jour les variables `APP_CHUNK_*` (produites par
`prepare-bundle.mjs`) **et** réécrire le `startCommand` avec le nouveau
`railway-function.js` encodé en base64, puis redéployer.

Marche à suivre :

```sh
# 1. fabriquer le bundle (retire les mineurs, applique les correctifs, découpe en variables)
node scripts/prepare-bundle.mjs index.html .env.railway

# 2. encoder le serveur pour le startCommand
node -e "const {readFileSync}=require('fs');const s=readFileSync('railway-function.js','utf8').replace(/\r\n/g,'\n');console.log('./run.sh '+Buffer.from(s,'utf8').toString('base64'))"

# 3. mettre à jour APP_CHUNK_* puis le startCommand sur l'instance du service,
#    et redéployer (API GraphQL Railway : variableCollectionUpsert puis
#    serviceInstanceUpdate, puis serviceInstanceRedeploy)
```

## Protection des personnes mineures et vivantes

Deux traitements sont appliqués au fichier publié avant les correctifs.

**Mineurs** (`scripts/exclure-mineurs.mjs`) : toute personne vivante encore mineure
est retirée. Le calcul utilise la date complète quand elle est connue — comparer les
seules années laisserait passer un mineur dont l'anniversaire n'est pas encore arrivé.
`--garder-mineurs` désactive ce retrait.

**Personnes vivantes** (`scripts/masquer-vivants.mjs`) : elles conservent leur année de
naissance, mais perdent la **date exacte** et le **lieu**. Le couple date exacte + lieu
de naissance est la donnée la plus identifiante du fichier ; l'année suffit à l'arbre et
au calcul des âges. Les lieux d'événements (mariage, résidence) sont retirés aussi.
`--garder-vivants` désactive ce masquage.

Un export GEDCOM ne renseigne pas toujours le décès : sans garde-fou, des personnes nées
en 1808 seraient considérées comme vivantes. Seules sont donc masquées les personnes
plausiblement en vie (< 110 ans).

## Changements visuels : lisibilité et fluidité

| Changement | Ce qui a été fait | Effet mesuré |
|---|---|---|
| **1. Zoom sémantique à trois niveaux** | Chaque carte porte désormais trois textes : la carte complète, un nom court avec les années, et les initiales. Un seul est visible selon le niveau de zoom, et les initiales sont contre-écrasées selon l'échelle. Plus aucun palier où le texte disparaît | Noms 12,4 px de près, nom court **13,5 px** au milieu, initiales **14 px** de loin (avant : 0 px) |
| **2. Nouvelle carte** | Filet vertical aux couleurs de la lignée, sexe indiqué par un glyphe et non plus par la seule couleur, nom agrandi à 16,5 px, dates à 13 px, cartes 250 × 124, cadres et ombres plus nets | Cartes plus aérées, deux canaux d'information indépendants |
| **3. Fluidité** | Fondu enchaîné entre deux vues, mise en page dagre **mémorisée**, et pastille d'attente pendant les calculs lourds pour que l'attente soit visible plutôt que figée | Retour à une vue déjà calculée : **567 ms → 210 ms** |

L'inertie au glissement et les animations de zoom existaient déjà et ont été conservées.
Le fondu et les animations respectent le réglage système « mouvement réduit ».

## Récupérer la source de l'application

Le HTML n'existe que dans les variables Railway. Pour le récupérer et le décomposer en
arborescence éditable :

```sh
node scripts/extraire-app.mjs source-app
```

Cela produit `source-app/index.html` (le fichier brut), les feuilles de style et les
blocs de script séparés dans l'ordre du document, et `source-app/donnees/famille.json`.
**Cette extraction contient des données personnelles : elle doit rester dans un dépôt
privé.**

## Correctifs d'audit de l'application

Le HTML de l'application n'étant pas versionné, ses correctifs vivent dans
[scripts/patch-app.mjs](scripts/patch-app.mjs) et sont appliqués automatiquement par
`scripts/prepare-bundle.mjs` au moment de fabriquer le bundle. Le script **s'arrête**
si un correctif ne s'applique plus : mieux vaut un build rouge qu'un déploiement
silencieusement non corrigé (`--allow-partial` pour passer outre, `--no-patch` pour
désactiver entièrement).

Ces correctifs doivent être reportés dans la source privée de l'application ; ce
script n'est qu'un pont tant que cette source n'est pas versionnée.

| Correctif | Défaut corrigé |
|---|---|
| `zoom-far-texte`, `fit-plancher` | Les cases de l'arbre s'affichaient **vides** à l'ouverture d'une branche : le plancher d'échelle de `fit()` (0,34) était sous la frontière du palier qui masque le texte (0,42). |
| `heritage-pays-garde`, `-parents`, `-conjoint` | « Tous les profils » ne faisait **rien** : `inheritedCountry` rappelait le conjoint avec la profondeur `0` sans ensemble de personnes vues, ce qui bouclait à l'infini entre deux conjoints sans lieu. |
| `pays-memoise` | Le calcul de nationalité était refait entièrement à chaque rendu. |
| `rendu-non-silencieux` | Un échec de rendu laissait l'écran figé **sans aucun message** et laissait l'état interne corrompu. |
| `carte-focus` | Les cartes n'avaient **aucun indicateur de focus** clavier : la couleur écrite en attribut `style` sur le `<rect>` écrasait la règle `.person:focus`. |
| `modale-*`, `annuaire-*`, `rechargement-et-accessibilite` | Modales sans `role="dialog"` ni arrière-plan inerte, focus perdu après un re-rendu, et rechargement automatique toutes les 10 min qui vidait zoom, recherche et portée. |
| `mobile-partage`, `mobile-direction` | Sur téléphone, le bouton **Partager** et les commandes Ancêtres / Descendance / Vue familiale étaient supprimés (`display:none!important`), sans équivalent dans le menu. |
| `feuille-correctifs` | Contrastes sous le seuil WCAG AA (2,96 à 4,29), anneau de focus absent sur la recherche, transitions non neutralisées en « mouvement réduit ». |
| `favicon-lien` | Le navigateur redemandait `/favicon.ico` à chaque chargement. |
| `espacement-generations` | 108 unités de vide étaient perdues par rang : l'arbre était inutilement écrasé. Mesuré et corrigé avec vérification du routage des liens. |
| `fit-plancher` (porté à 0,75) | Une branche s'ouvre maintenant à une échelle lisible et **centrée sur la personne de départ**, au lieu d'être écrasée. Mesuré : branche paternelle 0,496 → 0,75, **dates affichées 0/21 → 21/21** ; vue par défaut inchangée. |
| `mobile-*` et `feuille-correctifs` | Sur téléphone, le **titre**, le **compteur**, la **légende** (qui porte la case « Afficher les fratries ») et le **recentrage** étaient supprimés : l'utilisateur ne savait plus quelle branche il regardait. |
| `recherche-troncature` | La recherche s'arrêtait à 25 résultats sans le dire ; le total est désormais annoncé. |
| `effacement-*` | Une correction ne pouvait **jamais vider** un champ erroné : le client transmet un effacement explicite (`null`), distinct d'un champ non touché, et la fiche est réellement vidée. Les ajouts déjà enregistrés (chaînes vides) gardent leur sens d'origine. |
| `arbre-groupe-accessible`, `rechargement-et-accessibilite` | Lien d'évitement (23 tabulations avant la première carte), groupe SVG nommé, choix de parenté et de sexe exposés en `role="radio"`, service worker (rechargement hors ligne). |

## Correctifs du service

| Correctif | Défaut corrigé |
|---|---|
| `HEAD` traité comme `GET` | `HEAD /` renvoyait **404** alors que `GET /` renvoyait 200, ce qui casse les sondes de disponibilité et les vérificateurs de liens. |
| Réponse en **brotli** | Un client n'annonçant que `br` recevait **1,1 Mo non compressé**. Le service sert maintenant lui-même la variante négociée : ~130 Ko au lieu de ~157 Ko en gzip. |
| `ETag` + `Cache-Control: no-cache` | `no-store` sans validateur obligeait à retélécharger tout le document à chaque visite. Une relecture répond désormais **304** en quelques centaines d'octets. |
| `/favicon.ico` et `/index.html` | Renvoyaient respectivement `204` sans corps et **404**. |
| Validation de calendrier | `1937-13-45` et `2020-02-30` étaient acceptés comme dates de naissance. |
| File d'attente d'écriture | Deux contributions simultanées pouvaient s'écraser (cycle lire-modifier-écrire). |
| Clé de limitation | `X-Forwarded-For` était lu sur son **premier** maillon, fourni par le client : la limite de tentatives était contournable. |
| CSP et en-têtes | Ajout de `object-src 'none'`, `form-action 'none'`, `frame-src 'none'`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`. |
| `/api/state` | N'expose plus `pinConfigured` ni le nombre d'ajouts en attente. |
| `/sw.js` | Service worker minimal, réseau d'abord et cache en secours : hors ligne, un rechargement donnait une page blanche alors que l'application ne dépend d'aucune ressource externe. |
| `GET /api/contributions` | Le **prénom de la personne** qui a proposé un ajout n'est plus public ; il n'est renvoyé qu'à une session déverrouillée. Les ajouts eux-mêmes restent lisibles, l'arbre public en a besoin. |
| Effacement d'un champ | Un champ de correction peut désormais être **vidé** : `absent` = inchangé, `null` = effacer, texte = renseigner. Une correction entièrement vide reste refusée. |

## Developpement

```sh
# appliquer les correctifs sans fabriquer de bundle (rapport + fichier de sortie)
node scripts/patch-app.mjs index.html index.corrige.html

# fabriquer les variables Railway pour le deploiement
node scripts/prepare-bundle.mjs index.html .env.railway
```

## Tests

Aucune dépendance externe n'est nécessaire : la fonction serveur n'importe que des
modules `node:` et `Bun.serve` n'est appelé que si Bun est présent, ce qui permet de
tester le service avec Node.

```sh
npm test          # suite du service (96 verifications)
npm run test:app  # invariants de l'application (63 verifications)
npm run test:all  # les deux
```

`npm test` vérifie le transport (HEAD, 304, brotli, favicon, service worker, CSP), la
limitation des tentatives de code familial (dont le contournement par en-tête
falsifié), la validation des dates, l'autorisation des contributions, la sémantique
d'effacement d'un champ, l'absence de prénom d'auteur pour un visiteur anonyme, et
l'absence d'ajout perdu lors d'écritures simultanées.

`npm run test:app` lit le HTML de l'application, applique le même traitement que le
déploiement (retrait des mineurs, masquage des vivants, puis correctifs) et vérifie **les invariants qui ont
causé les pannes** sur les données réelles du fichier : cohérence des seuils de zoom,
terminaison du calcul de nationalité, absence de personne mineure, et absence de date
exacte ou de lieu pour une personne vivante. Ces vérifications
échouent même si le code est réécrit autrement, tant que le défaut est présent.

Une vérification de bout en bout (vrai serveur + vrai HTML + Chrome) a également été
exécutée lors de l'audit : 45 contrôles, dont l'affichage des dates en portée branche,
les commandes mobiles, le piège de focus des modales et l'enregistrement du service
worker. La lisibilité des trois niveaux de zoom, la nouvelle carte et la fluidité font
l'objet de 28 contrôles supplémentaires (`audit-site/test-visuel.mjs`).
