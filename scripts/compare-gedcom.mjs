// Compare le GEDCOM recu avec les donnees actuellement en ligne.
import fs from 'node:fs';

const GED = 'D:/Téléchargement/gedcom_masson.ged';
const texte = fs.readFileSync(GED, 'utf8').replace(/^\uFEFF/, '');
const lignes = texte.split(/\r?\n/);

/* ---------- parseur GEDCOM minimal ---------- */
const enregistrements = [];
let courant = null;
for (const ligne of lignes) {
  const m = /^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/.exec(ligne);
  if (!m) continue;
  const [, niveau, xref, tag, valeur] = m;
  if (niveau === '0') {
    courant = {xref: xref || null, tag, lignes: []};
    enregistrements.push(courant);
  } else if (courant) {
    courant.lignes.push({niveau: Number(niveau), tag, valeur: (valeur || '').trim()});
  }
}

const individus = new Map(), familles = new Map(), sources = new Map();
for (const r of enregistrements) {
  if (r.tag === 'INDI') individus.set(r.xref, r);
  if (r.tag === 'FAM') familles.set(r.xref, r);
  if (r.tag === 'SOUR') sources.set(r.xref, r);
}

/* ---------- donnees actuelles ---------- */
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

/* ---------- ecart ---------- */
const idsGed = new Set(individus.keys()), idsApp = new Set(D.people.map(x => x.id));
const famGed = new Set(familles.keys()), famApp = new Set(D.families.map(x => x.id));
const srcGed = new Set(sources.keys()), srcApp = new Set(D.sources.map(x => x.id));

const nom = (xref) => {
  const r = individus.get(xref);
  if (!r) return '(absent du GEDCOM)';
  const n = r.lignes.find(l => l.tag === 'NAME');
  return n ? n.valeur.replace(/\//g, '') : '(sans nom)';
};

console.log('=== VOLUMES ===');
console.log('  individus : GEDCOM ' + idsGed.size + '   application ' + idsApp.size);
console.log('  familles  : GEDCOM ' + famGed.size + '   application ' + famApp.size);
console.log('  sources   : GEDCOM ' + srcGed.size + '   application ' + srcApp.size);

const nouveaux = [...idsGed].filter(x => !idsApp.has(x));
const disparus = [...idsApp].filter(x => !idsGed.has(x));
console.log('\n=== INDIVIDUS NOUVEAUX (' + nouveaux.length + ') ===');
nouveaux.slice(0, 80).forEach(x => console.log('  ' + x.padEnd(12) + nom(x)));
if (nouveaux.length > 80) console.log('  ... et ' + (nouveaux.length - 80) + ' autre(s)');

console.log('\n=== INDIVIDUS DISPARUS de l\'application (' + disparus.length + ') ===');
disparus.slice(0, 40).forEach(x => {
  const q = D.people.find(y => y.id === x);
  console.log('  ' + x.padEnd(12) + (q ? q.name : '?'));
});
if (disparus.length > 40) console.log('  ... et ' + (disparus.length - 40) + ' autre(s)');

console.log('\n=== FAMILLES NOUVELLES (' + [...famGed].filter(x => !famApp.has(x)).length + ') ===');
console.log('=== FAMILLES DISPARUES (' + [...famApp].filter(x => !famGed.has(x)).length + ') ===');
console.log('=== SOURCES NOUVELLES (' + [...srcGed].filter(x => !srcApp.has(x)).length + ') ===');
console.log('=== SOURCES DISPARUES (' + [...srcApp].filter(x => !srcGed.has(x)).length + ') ===');

/* ---------- structures annexes ---------- */
console.log('\n=== STRUCTURES ANNEXES DE L\'APPLICATION ===');
console.log('  meta            : ' + JSON.stringify(D.meta).slice(0, 300));
console.log('  directAncestors : ' + D.directAncestors.length + ' -> ' + JSON.stringify(D.directAncestors.slice(0, 8)));
console.log('  discrepancies   : ' + D.discrepancies.length + ' -> ' + JSON.stringify(D.discrepancies[0]));
console.log('  groups          : ' + JSON.stringify(Object.keys(D.groups || {})));
console.log('  originalGroups  : ' + JSON.stringify(Object.keys(D.originalGroups || {})));
console.log('  diagrams        : ' + D.diagrams.length + ' -> ' + JSON.stringify(D.diagrams.map(x => ({id: x.id, titre: x.title || x.name, cles: Object.keys(x)}))).slice(0, 500));
