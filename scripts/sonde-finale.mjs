// Leve les derniers doutes : niveau de _MARNM, regle des evenements vides,
// nettoyage des lieux et des notes, cas de fratrie, et contenu des corrections.
import {readFileSync} from 'node:fs';
import {lireGedcom} from './gedcom-vers-donnees.mjs';

const GED = 'D:/Téléchargement/gedcom_masson.ged';
const racine = lireGedcom(readFileSync(GED, 'utf8'));
const texte = readFileSync(GED, 'utf8').split(/\r?\n/);

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

console.log('=== (a) _MARNM : a quel niveau ? ===');
let n1 = 0, n2 = 0;
for (const r of racine) if (r.tag === 'INDI') for (const n of r.enfants) {
  if (n.tag === '_MARNM') n1++;
  if (n.tag === 'NAME') for (const c of n.enfants) if (c.tag === '_MARNM') n2++;
}
console.log('  niveau 1 : ' + n1 + '    niveau 2 (sous NAME) : ' + n2);
const cath = racine.find(r => r.xref === '@I500002@');
const sonNom = cath.enfants.find(x => x.tag === 'NAME');
console.log('  NAME de Kathy : ' + JSON.stringify(sonNom.valeur));
console.log('  enfants de NAME : ' + sonNom.enfants.map(x => x.tag + '=' + JSON.stringify(x.valeur)).join('  '));
console.log('  attendu dans l\'application : marriedName=' + JSON.stringify(parId.get('@I500002@').marriedName)
  + ' givenName=' + JSON.stringify(parId.get('@I500002@').givenName) + ' surname=' + JSON.stringify(parId.get('@I500002@').surname));

console.log('\n=== (b) evenements vides : BIRT / DEAT ===');
const compter = (tag) => {
  let avecRien = 0, avecQqch = 0, doublons = 0;
  for (const r of racine) if (r.tag === 'INDI') {
    const l = r.enfants.filter(x => x.tag === tag);
    if (l.length > 1) doublons++;
    for (const n of l) {
      const date = n.enfants.find(x => x.tag === 'DATE'), plac = n.enfants.find(x => x.tag === 'PLAC');
      if (!date && !plac) avecRien++; else avecQqch++;
    }
  }
  console.log('  ' + tag + ' : sans date ni lieu ' + avecRien + '   avec ' + avecQqch + '   personnes a plusieurs ' + tag + ' : ' + doublons);
};
compter('BIRT'); compter('DEAT'); compter('BURI'); compter('OCCU');
const appBirt = D.people.flatMap(x => x.events || []).filter(x => x.type === 'BIRT').length;
const appDeat = D.people.flatMap(x => x.events || []).filter(x => x.type === 'DEAT').length;
console.log('  dans l\'application : BIRT ' + appBirt + '   DEAT ' + appDeat);

console.log('\n=== (c) nettoyage des lieux : que contient le GEDCOM ? ===');
const lieux = new Map();
for (const r of racine) if (r.tag === 'INDI') for (const n of r.enfants) for (const c of n.enfants || []) if (c.tag === 'PLAC') lieux.set(c.valeur, (lieux.get(c.valeur) || 0) + 1);
console.log('  lieux GEDCOM avec code postal : ' + [...lieux.keys()].filter(x => /\b\d{4}\b/.test(x)).length);
[...lieux.keys()].filter(x => /\b\d{4}\b/.test(x)).slice(0, 5).forEach(x => console.log('    ' + JSON.stringify(x)));
console.log('  lieux correspondants dans l\'application :');
const appLieux = new Set(D.people.flatMap(x => [x.birth?.place, x.death?.place]).filter(Boolean).concat(D.people.flatMap(x => (x.events || []).map(e => e.place)).filter(Boolean)));
[...appLieux].filter(x => /\b\d{4}\b/.test(x)).slice(0, 5).forEach(x => console.log('    ' + JSON.stringify(x)));
console.log('  total lieux distincts application : ' + appLieux.size);

console.log('\n=== (d) notes : HTML retire ? ===');
for (const r of racine) if (r.tag === 'INDI') for (const n of r.enfants) if (n.tag === 'NOTE') {
  const app = parId.get(r.xref);
  if (app) console.log('  GEDCOM ' + JSON.stringify(n.valeur).slice(0, 90) + '\n    app   ' + JSON.stringify((app.notes || [])[0] || '').slice(0, 90));
}
console.log('  -- notes de sources --');
const appSrc = new Map(D.sources.map(x => [x.id, x]));
for (const r of racine) if (r.tag === 'SOUR') for (const n of r.enfants) if (n.tag === 'NOTE') {
  const a = appSrc.get(r.xref);
  if (a) console.log('  GEDCOM ' + JSON.stringify(n.valeur).slice(0, 90) + '\n    app   ' + JSON.stringify((a.notes || [])[0] || '').slice(0, 90));
}

console.log('\n=== (e) cas de fratrie @I500246@ / @I500247@ ===');
for (const id of ['@I500246@', '@I500247@']) {
  const r = racine.find(x => x.xref === id);
  if (!r) { console.log('  ' + id + ' absent du GEDCOM'); continue; }
  console.log('  ' + id + ' : ' + r.enfants.filter(x => ['NAME', 'FAMC', 'FAMS', 'SEX'].includes(x.tag)).map(x => x.tag + '=' + x.valeur).join('  '));
  const app = parId.get(id);
  if (app) console.log('    app : parents=' + JSON.stringify(app.parents) + ' siblings=' + JSON.stringify(app.siblings) + ' parentFamilyIds=' + JSON.stringify(app.parentFamilyIds));
}
const fam246 = racine.find(r => r.tag === 'FAM' && r.enfants.some(c => c.tag === 'CHIL' && c.valeur === '@I500247@'));
console.log('  famille contenant @I500247@ comme enfant : ' + (fam246 ? fam246.xref + ' enfants=' + fam246.enfants.filter(c => c.tag === 'CHIL').map(c => c.valeur).join(',') : 'aucune'));

console.log('\n=== (f) les 9 corrections enregistrees ===');
D.discrepancies.forEach(x => console.log('  [' + x.id + '] ' + (x.personIds || []).join(',') + '  ' + String(x.description).slice(0, 150)));

console.log('\n=== sources nouvelles et citations qui les referencent ===');
const idsApp = new Set(D.sources.map(x => x.id));
const nouvelles = [...new Set(racine.filter(r => r.tag === 'SOUR').map(r => r.xref))].filter(x => !idsApp.has(x));
console.log('  sources nouvelles : ' + nouvelles.join(', '));
