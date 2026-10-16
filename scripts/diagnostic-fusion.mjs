// Distingue, parmi les champs recalcules, les vrais changements de contenu des
// simples differences d'ordre, et explique les cas de branche et de profondeur.
import {readFileSync} from 'node:fs';
import {lireGedcom, extraire, calculer} from './gedcom-vers-donnees.mjs';
import {fusionner} from './fusionner-gedcom.mjs';

const html = readFileSync('index.html', 'utf8');
const d0 = html.indexOf('{', html.indexOf('window.FAMILY_DATA='));
let p = 0, s = false, e = false, fin = -1;
for (let k = d0; k < html.length; k++) {
  const c = html[k];
  if (s) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') s = false; continue; }
  if (c === '"') { s = true; continue; }
  if (c === '{') p++; else if (c === '}') { p--; if (!p) { fin = k + 1; break; } }
}
const D = JSON.parse(html.slice(d0, fin));
const {donnees, rapport} = fusionner(D, 'D:/Téléchargement/gedcom_masson.ged');
const avant = new Map(D.people.map(x => [x.id, x]));
const apres = new Map(donnees.people.map(x => [x.id, x]));

console.log('=== ordre ou contenu ? ===');
const stats = new Map();
for (const m of rapport.modifications) {
  const a = avant.get(m.id), b = apres.get(m.id);
  for (const champ of m.champs) {
    const va = a[champ], vb = b[champ];
    const estTableau = Array.isArray(va);
    let sorte = 'contenu';
    if (estTableau) {
      const cle = (l) => JSON.stringify(l.map(x => (x && typeof x === 'object') ? x.id : x).sort());
      sorte = cle(va) === cle(vb) ? 'ordre seulement' : 'contenu (elements)';
    }
    const k = champ + ' / ' + sorte;
    stats.set(k, (stats.get(k) || 0) + 1);
  }
}
[...stats].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + k.padEnd(40) + v));

console.log('\n=== ordre reel dans l\'application vs trie ===');
for (const id of ['@I500006@', '@I500125@', '@I500246@']) {
  const a = avant.get(id); if (!a) continue;
  console.log('  ' + a.name);
  console.log('    enfants app      : ' + JSON.stringify(a.children));
  console.log('    enfants tries    : ' + JSON.stringify([...a.children].sort()));
  console.log('    ordre d\'apparition GEDCOM : ' + JSON.stringify((() => {
    const r = lireGedcom(readFileSync('D:/Téléchargement/gedcom_masson.ged', 'utf8'));
    const fams = r.filter(x => x.tag === 'FAM' && x.enfants.some(c => c.tag === 'CHIL' && a.spouseFamilyIds.includes(x.xref)));
    return fams.flatMap(f => f.enfants.filter(c => c.tag === 'CHIL').map(c => c.valeur));
  })()));
}

console.log('\n=== les cas de branche ===');
for (const m of rapport.modifications) {
  if (!m.champs.includes('branches') && !m.champs.includes('branch')) continue;
  const a = avant.get(m.id), b = apres.get(m.id);
  console.log('  ' + String(a.name).padEnd(34) + ' branches ' + JSON.stringify(a.branches) + ' -> ' + JSON.stringify(b.branches)
    + '   branch ' + a.branch + ' -> ' + b.branch);
}

console.log('\n=== le cas de profondeur d\'ascendance ===');
for (const m of rapport.modifications) {
  if (!m.champs.includes('ancestorDepth')) continue;
  const a = avant.get(m.id), b = apres.get(m.id);
  console.log('  ' + String(a.name).padEnd(34) + ' ancestorDepth ' + a.ancestorDepth + ' -> ' + b.ancestorDepth
    + '  generation ' + a.generation + ' -> ' + b.generation + '  direct ' + a.directAncestor + ' -> ' + b.directAncestor);
}

console.log('\n=== ordre des nouveaux tableaux (3 exemples) ===');
let n = 0;
for (const id of rapport.nouvellesPersonnes) {
  const b = apres.get(id);
  if (!b.siblings.length && !b.children.length) continue;
  console.log('  ' + String(b.name || '(sans nom)').padEnd(30) + ' parents ' + JSON.stringify(b.parents)
    + ' fratrie ' + JSON.stringify(b.siblings) + ' enfants ' + JSON.stringify(b.children));
  if (++n >= 5) break;
}
