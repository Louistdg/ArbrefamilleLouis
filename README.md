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
npm test          # suite du service (79 verifications)
npm run test:app  # invariants de l'application (32 verifications)
npm run test:all  # les deux
```

`npm test` vérifie le transport (HEAD, 304, brotli, favicon, CSP), la limitation des
tentatives de code familial (dont le contournement par en-tête falsifié), la
validation des dates, l'autorisation des contributions, et l'absence d'ajout perdu
lors d'écritures simultanées.

`npm run test:app` lit le HTML de l'application et vérifie que les correctifs
s'appliquent, puis **les invariants qui ont causé les pannes** sur les données
réelles du fichier : cohérence des seuils de zoom, et terminaison du calcul de
nationalité. Ces deux-là échouent même si le code est réécrit autrement, tant que le
défaut est présent.
