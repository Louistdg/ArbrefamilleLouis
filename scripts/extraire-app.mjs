// Recupere l'application publiee et la redecompose en arborescence editable.
//
// Le HTML de l'application n'est pas versionne : il n'existe que dans les
// variables APP_CHUNK_* de Railway. Ce script le telecharge depuis le site, puis
// ecrit une copie brute et une decomposition (styles, scripts, donnees) pour
// pouvoir travailler la source au lieu de patcher un fichier de 1,1 Mo.
//
// Usage : node scripts/extraire-app.mjs [dossier-de-sortie] [url]

import {mkdirSync, writeFileSync} from 'node:fs';

const SORTIE = process.argv[2] || 'source-app';
const URL_SITE = process.argv[3] || 'https://test-installation-production.up.railway.app/';

const reponse = await fetch(URL_SITE);
if (!reponse.ok) {
  console.error('ECHEC : le site repond ' + reponse.status);
  process.exit(1);
}
const html = await reponse.text();

mkdirSync(SORTIE, {recursive: true});
mkdirSync(SORTIE + '/styles', {recursive: true});
mkdirSync(SORTIE + '/scripts', {recursive: true});
mkdirSync(SORTIE + '/donnees', {recursive: true});

writeFileSync(SORTIE + '/index.html', html, 'utf8');

const styles = [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/g)];
styles.forEach((m, i) => {
  const id = /id="([^"]+)"/.exec(m[1]);
  const nom = String(i + 1).padStart(2, '0') + '-' + (id ? id[1] : 'sans-nom');
  writeFileSync(SORTIE + '/styles/' + nom + '.css', m[2], 'utf8');
});

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
scripts.forEach((m, i) => {
  const id = /id="([^"]+)"/.exec(m[1]);
  let nom = String(i + 1).padStart(2, '0') + '-' + (id ? id[1] : 'sans-nom');
  const donnees = m[2].indexOf('window.FAMILY_DATA=');
  if (donnees >= 0) {
    // On separe les donnees du code : le JSON ne se relit pas dans un fichier de
    // 900 Ko melange a du JavaScript.
    const debut = m[2].indexOf('{', donnees);
    let p = 0, chaine = false, echappe = false, fin = -1;
    for (let k = debut; k < m[2].length; k++) {
      const ch = m[2][k];
      if (chaine) {
        if (echappe) echappe = false;
        else if (ch === '\\') echappe = true;
        else if (ch === '"') chaine = false;
        continue;
      }
      if (ch === '"') { chaine = true; continue; }
      if (ch === '{') p++;
      else if (ch === '}') { p--; if (!p) { fin = k + 1; break; } }
    }
    try {
      const data = JSON.parse(m[2].slice(debut, fin));
      writeFileSync(SORTIE + '/donnees/famille.json', JSON.stringify(data, null, 1), 'utf8');
      const reste = m[2].slice(0, donnees) + 'window.FAMILY_DATA=require("./donnees/famille.json");\n' + m[2].slice(fin).replace(/^\s*;?/, '');
      writeFileSync(SORTIE + '/scripts/' + nom + '.js', reste, 'utf8');
      console.log('  donnees separees : ' + data.people.length + ' personnes -> donnees/famille.json');
      return;
    } catch (e) { nom += '-donnees-illisibles'; }
  }
  writeFileSync(SORTIE + '/scripts/' + nom + '.js', m[2], 'utf8');
});

writeFileSync(SORTIE + '/LISEZ-MOI.md', [
  '# Source extraite du site publie',
  '',
  'Obtenue le ' + new Date().toISOString() + ' depuis ' + URL_SITE,
  '',
  '- `index.html` : le fichier tel qu\'il est servi (1,1 Mo), reference de comparaison.',
  '- `styles/` : les ' + styles.length + ' feuilles de style inline, dans l\'ordre du document.',
  '- `scripts/` : les ' + scripts.length + ' blocs de script inline, dans l\'ordre du document.',
  '- `donnees/famille.json` : les donnees genealogiques, extraites du bloc principal.',
  '',
  '## Avertissement',
  '',
  'Cette extraction contient des donnees personnelles : elle ne doit pas etre',
  'publiee. Conservez-la dans un depot **prive**.',
  '',
  'Les feuilles de style se superposent (plusieurs couches se surchargent, dont',
  'quatre successives pour le mobile, ajoutees apres `</body></html>` dans le',
  'fichier d\'origine). Pour reprendre la main, il faut les fusionner en une seule',
  'feuille en conservant l\'ordre.',
  '',
  'Les correctifs d\'audit ne sont pas dans cette extraction : ils sont appliques a',
  'la fabrication du bundle par `scripts/patch-app.mjs`. Reportez-les ici une fois',
  'la source stabilisee.'
].join('\n'), 'utf8');

console.log('Extraction dans ' + SORTIE + '/');
console.log('  index.html            ' + html.length + ' octets');
console.log('  ' + styles.length + ' feuilles de style  -> styles/');
console.log('  ' + scripts.length + ' blocs de script     -> scripts/');
console.log('  LISEZ-MOI.md');
