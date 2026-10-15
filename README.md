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
