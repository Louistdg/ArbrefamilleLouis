// Cherche des cycles dans le graphe de parente des donnees fusionnees : une
// personne qui serait son propre ancetre ferait boucler tout parcours recursif.
import {readFileSync} from 'node:fs';
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
const avant = JSON.parse(html.slice(d0, fin));
const {donnees: D, rapport} = fusionner(avant, 'D:/Téléchargement/gedcom_masson.ged');
const parId = new Map(D.people.map(x => [x.id, x]));
const nom = (i) => parId.get(i)?.name || i;

const chercherCycles = (donnees, etiquette) => {
  const parentDe = new Map(donnees.people.map(x => [x.id, x.parents || []]));
  const couleur = new Map();
  const cycles = [];
  const visite = (id, chemin) => {
    const c = couleur.get(id);
    if (c === 1) { cycles.push([...chemin.slice(chemin.indexOf(id)), id]); return; }
    if (c === 2) return;
    couleur.set(id, 1);
    chemin.push(id);
    for (const a of parentDe.get(id) || []) visite(a, chemin);
    chemin.pop();
    couleur.set(id, 2);
  };
  for (const id of parentDe.keys()) if (!couleur.has(id)) visite(id, []);
  console.log('  ' + etiquette + ' : ' + cycles.length + ' cycle(s)');
  cycles.slice(0, 8).forEach(cy => console.log('    ' + cy.map(nom).join('  ->  ')));
  return cycles;
};

console.log('=== CYCLES DE PARENTE ===');
const cAvant = chercherCycles(avant, 'donnees actuelles (417)');
const cApres = chercherCycles(D, 'donnees fusionnees (469)');

console.log('\n=== CYCLES DE PARENTE LARGES (parents ET enfants) ===');
const chercherCyclesLarges = (donnees, etiquette) => {
  const voisins = new Map();
  for (const x of donnees.people) voisins.set(x.id, [...new Set([...(x.parents || []), ...(x.children || [])])]);
  const couleur = new Map(), cycles = [];
  const visite = (id, chemin) => {
    const c = couleur.get(id);
    if (c === 1) { cycles.push([...chemin.slice(chemin.indexOf(id)), id]); return; }
    if (c === 2) return;
    couleur.set(id, 1);
    chemin.push(id);
    for (const a of voisins.get(id) || []) visite(a, chemin);
    chemin.pop();
    couleur.set(id, 2);
  };
  for (const id of voisins.keys()) if (!couleur.has(id)) visite(id, []);
  console.log('  ' + etiquette + ' : ' + cycles.length + ' cycle(s)');
  cycles.slice(0, 8).forEach(cy => console.log('    ' + cy.map(nom).join('  ->  ')));
  return cycles;
};
chercherCyclesLarges(D, 'fusionnees');

console.log('\n=== PROFONDEUR MAXIMALE DE LA LIGNEE ===');
const parentDe = new Map(D.people.map(x => [x.id, x.parents || []]));
const memo = new Map();
const prof = (id) => {
  if (memo.has(id)) return memo.get(id);
  memo.set(id, 0);
  let m = 0;
  for (const a of parentDe.get(id) || []) m = Math.max(m, 1 + prof(a));
  memo.set(id, m);
  return m;
};
let max = 0, qui = '';
for (const x of D.people) { const v = prof(x.id); if (v > max) { max = v; qui = x.name; } }
console.log('  profondeur maximale : ' + max + ' generations (' + qui + ')');

console.log('\n=== FRATRIES ET ENFANTS LES PLUS NOMBREUX ===');
const gros = [...D.people].sort((a, b) => (b.children || []).length - (a.children || []).length)[0];
console.log('  plus d\'enfants : ' + gros.name + ' -> ' + (gros.children || []).length);
const grosF = [...D.people].sort((a, b) => (b.siblings || []).length - (a.siblings || []).length)[0];
console.log('  plus de freres et soeurs : ' + grosF.name + ' -> ' + (grosF.siblings || []).length);

console.log('\n=== FAMILLES AVEC BEAUCOUP D\'ENFANTS ===');
[...D.families].sort((a, b) => b.childIds.length - a.childIds.length).slice(0, 4).forEach(f => {
  console.log('  ' + f.id + ' : ' + f.childIds.length + ' enfants  (' + f.childIds.slice(0, 3).map(nom).join(', ') + ' ...)');
});

console.log('\n=== TAILLE DES DONNEES PUBLIEES ===');
console.log('  JSON : ' + Math.round(JSON.stringify(D).length / 1024) + ' Ko');
console.log('  avant : ' + Math.round(JSON.stringify(avant).length / 1024) + ' Ko');
