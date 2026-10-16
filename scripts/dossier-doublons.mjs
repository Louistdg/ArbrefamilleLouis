// Dossier des doublons : pour chaque paire, les deux fiches, ce qui les
// rapproche, ce qui les distingue, et l'action a mener dans MyHeritage.
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
const {donnees: D} = fusionner(avant, 'D:/Téléchargement/gedcom_masson.ged');
const parId = new Map(D.people.map(x => [x.id, x]));
const nom = (i) => parId.get(i)?.name || i;
const fiche = (id) => {
  const x = parId.get(id);
  const parents = (x.parents || []).map(q => nom(q)).join(' & ') || 'aucun parent déclaré';
  const conjoints = (x.partners || []).map(q => nom(q)).join(', ') || 'aucun';
  const enfants = (x.children || []).map(q => nom(q)).join(', ') || 'aucun';
  return {id, nom: x.name, ne: x.birth.date || '?', lieu: x.birth.place || '?', deces: x.death.known ? (x.death.date || 'date inconnue') : '—',
    parents, conjoints, enfants, fratrie: (x.siblings || []).length, ligne: x.sourceLine};
};

const doublons = D.discrepancies.filter(d => d.id.startsWith('doublon'));
console.log('DOSSIER DES DOUBLONS — ' + doublons.length + ' paires à examiner\n');
let n = 0;
for (const d of doublons) {
  n++;
  const [a, b] = d.personIds.map(fiche);
  console.log('='.repeat(78));
  console.log('DOUBLON ' + n + ' — ' + a.nom);
  console.log('='.repeat(78));
  for (const f of [a, b]) {
    console.log('  ' + f.id.padEnd(12) + ' (ligne ' + f.ligne + ' du GEDCOM)');
    console.log('      nom        : ' + f.nom);
    console.log('      naissance  : ' + f.ne + '   à ' + f.lieu);
    console.log('      décès      : ' + f.deces);
    console.log('      parents    : ' + f.parents);
    console.log('      conjoint(s): ' + f.conjoints);
    console.log('      enfants    : ' + f.enfants);
    console.log('');
  }
  const memesParents = a.parents === b.parents && !/aucun/.test(a.parents);
  const memesLieux = a.lieu === b.lieu;
  const memesDates = a.ne === b.ne;
  console.log('  CE QUI LES RAPPROCHE  : ' + [memesDates ? 'même date de naissance' : null, memesLieux ? 'même lieu' : null,
    memesParents ? 'MÊMES PARENTS' : null].filter(Boolean).join(', ') || 'rien de déterminant');
  const diff = [];
  if (!memesDates) diff.push('dates différentes (' + a.ne + ' / ' + b.ne + ')');
  if (!memesLieux) diff.push('lieux différents (' + a.lieu + ' / ' + b.lieu + ')');
  if (!memesParents) diff.push('parents différents');
  if (a.conjoints !== b.conjoints) diff.push('conjoints différents');
  if (a.enfants !== b.enfants) diff.push('enfants différents');
  console.log('  CE QUI LES DISTINGUE  : ' + (diff.join(' ; ') || 'rien'));
  console.log('  MON AVIS : ' + (memesParents || (memesDates && memesLieux)
    ? 'MÊME PERSONNE, presque certainement. À fusionner.'
    : 'À VÉRIFIER : les deux fiches portent des informations différentes.'));
  console.log('');
}
console.log('='.repeat(78));
console.log('Pour chaque paire : ouvrir les deux fiches dans MyHeritage (numéros ci-dessus),');
console.log('vérifier les parents et les enfants, puis utiliser « Fusionner » sur la fiche à garder.');
console.log('Les numéros sont ceux du GEDCOM (@I…@), visibles dans l\'application.');
