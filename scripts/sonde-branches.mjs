// Comprend la regle exacte des branches en examinant les cas ou le calcul
// s'ecarte de l'application.
import {readFileSync} from 'node:fs';
import {lireGedcom, extraire, calculer} from './gedcom-vers-donnees.mjs';

const GED = 'D:/Téléchargement/gedcom_masson.ged';
const brut = extraire(lireGedcom(readFileSync(GED, 'utf8')));
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
const parId = new Map(D.people.map(x => [x.id, x]));
const R = calculer(brut.personnes, brut.familles, D.rootId);
const nom = (id) => parId.get(id)?.name || id;

console.log('=== pere et mere detectes pour la racine ===');
console.log('  pere=' + nom(R.pere) + '  mere=' + nom(R.mere));

console.log('\n=== ecarts de branches sur les personnes existantes ===');
let n = 0;
const explications = new Map();
for (const x of D.people) {
  const mes = [...(R.branches.get(x.id) || [])].sort();
  const app = [...(x.branches || [])].sort();
  if (JSON.stringify(mes) === JSON.stringify(app)) continue;
  n++;
  const c = [...(R.cote.get(x.id) || [])].sort();
  const parents = [...(R.parentDe.get(x.id) || [])];
  const conjoints = [...(R.conjoints.get(x.id) || [])];
  console.log('  ' + nom(x.id).slice(0, 30).padEnd(31) + ' app=' + JSON.stringify(app) + ' calcule=' + JSON.stringify(mes)
    + ' cote=' + JSON.stringify(c));
  console.log('      parents  : ' + parents.map(q => nom(q).slice(0, 22) + JSON.stringify([...(R.branches.get(q) || [])].sort())).join('  '));
  console.log('      conjoints: ' + conjoints.map(q => nom(q).slice(0, 22) + JSON.stringify([...(R.branches.get(q) || [])].sort())).join('  '));
  const cle = JSON.stringify([c.length, parents.length, conjoints.length]);
  explications.set(cle, (explications.get(cle) || 0) + 1);
  if (n > 12) break;
}
console.log('  total des ecarts : ' + n);
console.log('  profil (cote,parents,conjoints) -> nombre : ' + JSON.stringify([...explications]));

console.log('\n=== les personnes hors branches : ont-elles des parents dans l\'arbre ? ===');
const hors = D.people.filter(x => !(x.branches || []).length);
console.log('  nombre : ' + hors.length);
let avecParentsHors = 0, avecConjointHors = 0;
for (const x of hors) {
  const par = [...(R.parentDe.get(x.id) || [])], conj = [...(R.conjoints.get(x.id) || [])];
  if (par.length) avecParentsHors++;
  if (conj.length) avecConjointHors++;
}
console.log('  avec au moins un parent : ' + avecParentsHors);
console.log('  avec au moins un conjoint : ' + avecConjointHors);
console.log('  exemples :');
hors.slice(0, 5).forEach(x => {
  const par = [...(R.parentDe.get(x.id) || [])], conj = [...(R.conjoints.get(x.id) || [])];
  console.log('    ' + nom(x.id).slice(0, 28).padEnd(29) + ' parents=' + par.map(nom).join(', ').slice(0, 50)
    + '  conjoints=' + conj.map(nom).join(', ').slice(0, 40));
});

console.log('\n=== les personnes paternel/maternel : viennent-elles toutes d\'un ancetre de la racine ? ===');
const parCote = D.people.filter(x => (x.branches || []).includes('paternel'));
let sansCotePaternel = 0;
const exSans = [];
for (const x of parCote) {
  if ((R.cote.get(x.id) || new Set()).has('paternel')) continue;
  sansCotePaternel++;
  if (exSans.length < 6) exSans.push(x);
}
console.log('  paternel sans etre un ancetre paternel de la racine : ' + sansCotePaternel + ' / ' + parCote.length);
exSans.forEach(x => {
  const conj = [...(R.conjoints.get(x.id) || [])], par = [...(R.parentDe.get(x.id) || [])];
  console.log('    ' + nom(x.id).slice(0, 28).padEnd(29) + ' cote=[] conjoint(cote)=' + conj.map(q => nom(q).slice(0, 18) + JSON.stringify([...(R.cote.get(q) || [])])).join(', ').slice(0, 60)
    + '  parents(cote)=' + par.map(q => nom(q).slice(0, 18) + JSON.stringify([...(R.cote.get(q) || [])])).join(', ').slice(0, 60));
});
