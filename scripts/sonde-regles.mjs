// Rassemble les regles des champs calcules en observant les donnees existantes.
import fs from 'node:fs';
const html = fs.readFileSync('C:/Documents/deepseek-harness/default-workspace/ArbrefamilleLouis/index.html', 'utf8');
const d = html.indexOf('{', html.indexOf('window.FAMILY_DATA='));
let p = 0, s = false, e = false, fin = -1;
for (let k = d; k < html.length; k++) {
  const c = html[k];
  if (s) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') s = false; continue; }
  if (c === '"') { s = true; continue; }
  if (c === '{') p++; else if (c === '}') { p--; if (!p) { fin = k + 1; break; } }
}
const D = JSON.parse(html.slice(d, fin));
const parId = new Map(D.people.map(x => [x.id, x]));
const montre = (id) => {
  const x = parId.get(id);
  if (!x) return '  ' + id + ' ABSENT';
  return '  ' + x.name.padEnd(36).slice(0, 36) + ' g=' + String(x.generation).padStart(3)
    + ' anc=' + String(x.ancestorDepth).padStart(2) + ' dir=' + (x.directAncestor ? 'oui' : 'non')
    + ' dist=' + String(x.relationDistance).padStart(2) + ' role=' + String(x.relationRole).padEnd(16)
    + ' branch=' + String(x.branch).padEnd(9) + ' branches=[' + (x.branches || []).join(',') + ']'
    + ' racine=' + (x.connectedToRoot ? 'oui' : 'non');
};

console.log('=== valeurs distinctes ===');
for (const k of ['relationRole', 'branch', 'ancestorDepth', 'generation']) {
  const m = new Map();
  for (const x of D.people) { const v = Array.isArray(x[k]) ? x[k].join('+') : x[k]; m.set(v, (m.get(v) || 0) + 1); }
  console.log('  ' + k.padEnd(16) + ' : ' + [...m].sort((a, b) => (a[0] > b[0] ? 1 : -1)).map(([a, b]) => a + '(' + b + ')').join('  '));
}
const mb = new Map();
for (const x of D.people) { const v = (x.branches || []).join('+'); mb.set(v, (mb.get(v) || 0) + 1); }
console.log('  branches         : ' + [...mb].map(([a, b]) => '[' + a + '](' + b + ')').join('  '));
console.log('  connectedToRoot  : ' + JSON.stringify([...new Set(D.people.map(x => x.connectedToRoot))]));

console.log('\n=== la lignee directe ===');
console.log(montre(D.rootId));
console.log(montre(D.fatherId));
console.log(montre(D.motherId));
const pere = parId.get(D.fatherId);
console.log('  -- parents du pere --');
for (const x of pere.parents || []) console.log(montre(x));
console.log('  -- parents de la mere --');
for (const x of (parId.get(D.motherId).parents || [])) console.log(montre(x));

console.log('\n=== fratrie de la racine ===');
for (const x of parId.get(D.rootId).siblings || []) console.log(montre(x));

console.log('\n=== conjoints maries dans la famille (non ancetres) ===');
let n = 0;
for (const x of D.people) {
  if (x.relationRole === 'spouse' || /spouse|partner|conjoint/i.test(x.relationRole || '')) { console.log(montre(x.id)); if (++n > 5) break; }
}
if (!n) console.log('  (aucun role de ce genre)');

console.log('\n=== quelques non relies ===');
const nonRelies = D.people.filter(x => !x.connectedToRoot).slice(0, 5);
nonRelies.forEach(x => console.log(montre(x.id)));
console.log('  total non relies : ' + D.people.filter(x => !x.connectedToRoot).length);

console.log('\n=== groupes ===');
for (const [k, v] of Object.entries(D.groups)) console.log('  ' + k.padEnd(20) + (Array.isArray(v) ? v.length : typeof v));
console.log('  originalGroups : ' + Object.entries(D.originalGroups).map(([k, v]) => k + '(' + v.length + ')').join(' '));
console.log('  stats meta     : ' + JSON.stringify(D.meta.counts || D.meta.statistics || D.meta).slice(0, 600));

console.log('\n=== personnes avec un role inattendu ===');
const roles = new Set(['root', 'direct_ancestor']);
D.people.filter(x => !roles.has(x.relationRole)).slice(0, 12).forEach(x => console.log(montre(x.id)));

console.log('\n=== branches pour un "commun" vs "allies" ===');
console.log('  exemple allies :');
D.people.filter(x => x.branch === 'allies').slice(0, 5).forEach(x => console.log(montre(x.id)));
console.log('  exemple paternel :');
D.people.filter(x => x.branch === 'paternel').slice(0, 3).forEach(x => console.log(montre(x.id)));
console.log('  exemple maternel :');
D.people.filter(x => x.branch === 'maternel').slice(0, 3).forEach(x => console.log(montre(x.id)));
