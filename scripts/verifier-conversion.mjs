// Recalcule toute la structure a partir du GEDCOM et compare aux donnees en
// ligne, personne par personne. Tout ecart signale une regle mal reproduite.
import {readFileSync} from 'node:fs';
import {lireGedcom, extraire, calculer} from './gedcom-vers-donnees.mjs';

const GED = process.argv[2] || 'D:/Téléchargement/gedcom_masson.ged';
const APRES = process.argv[3] || 'index.html';

const {personnes, familles, sources} = extraire(lireGedcom(readFileSync(GED, 'utf8')));

const html = readFileSync(APRES, 'utf8');
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
const R = calculer(personnes, familles, D.rootId);

const ecarts = new Map();
const noter = (cat, id, attendu, obtenu) => {
  if (!ecarts.has(cat)) ecarts.set(cat, []);
  const l = ecarts.get(cat);
  if (l.length < 8) l.push({id, attendu, obtenu, nom: parId.get(id)?.name});
  else l.total = (l.total || l.length) + 1;
};

/* --------- comparer les personnes existantes --------- */
let comparees = 0;
for (const [id, attendu] of parId) {
  const calc = personnes.get(id);
  if (!calc) { noter('absent du GEDCOM', id, 'present', 'absente'); continue; }
  comparees++;
  for (const champ of ['givenName', 'surname', 'sex', 'marriedName', 'gedcomName', 'name']) {
    if ((attendu[champ] || '') !== (calc[champ] || '')) noter(champ, id, attendu[champ], calc[champ]);
  }
  for (const champ of ['date', 'place', 'known']) {
    if (attendu.birth[champ] !== calc.birth[champ]) noter('naissance.' + champ, id, attendu.birth[champ], calc.birth[champ]);
    if (attendu.death[champ] !== calc.death[champ]) noter('deces.' + champ, id, attendu.death[champ], calc.death[champ]);
  }
  const cle = (l) => l.map(x => x.type + '|' + x.date + '|' + x.place).sort().join(' ; ');
  if (cle(attendu.events || []) !== cle(calc.events)) noter('evenements', id, cle(attendu.events || []), cle(calc.events));
  if ((attendu.citations || []).length !== calc.citations.length) noter('nombre de citations', id, attendu.citations.length, calc.citations.length);
  const clec = (l) => l.map(x => x.sourceId + '|' + x.kind + '|' + x.page + '|' + x.text).sort().join(' ; ');
  if (clec(attendu.citations || []) !== clec(calc.citations)) noter('citations', id, 'differentes', 'differentes');
  if ((attendu.notes || []).join('|') !== (calc.notes || []).join('|')) noter('notes', id, (attendu.notes || []).join('|').slice(0, 40), (calc.notes || []).join('|').slice(0, 40));

  // liens
  const tri = (a) => [...a].sort().join(',');
  if (tri(attendu.parentFamilyIds || []) !== tri(calc.famc)) noter('famille parente', id, tri(attendu.parentFamilyIds || []), tri(calc.famc));
  if (tri(attendu.spouseFamilyIds || []) !== tri(calc.fams)) noter('familles conjoint', id, tri(attendu.spouseFamilyIds || []), tri(calc.fams));
  for (const [nomChamp, source] of [['parents', R.parentDe], ['children', R.enfantsDeP], ['partners', R.conjoints]]) {
    const calc2 = [...(source.get(id) || [])];
    if (tri(attendu[nomChamp] || []) !== tri(calc2)) noter(nomChamp, id, tri(attendu[nomChamp] || []), tri(calc2));
  }
  // fratrie
  const fratrie = new Set();
  for (const a of R.parentDe.get(id) || []) for (const c of R.enfantsDeP.get(a) || []) if (c !== id) fratrie.add(c);
  if (tri(attendu.siblings || []) !== tri([...fratrie])) noter('siblings', id, tri(attendu.siblings || []), tri([...fratrie]));

  // champs calcules
  const mesBranches = [...(R.branches.get(id) || [])].sort();
  if (tri(attendu.branches || []) !== tri(mesBranches)) noter('branches', id, tri(attendu.branches || []), tri(mesBranches));
  if (attendu.generation !== R.generation.get(id)) noter('generation', id, attendu.generation, R.generation.get(id));
  if (attendu.relationDistance !== R.distance.get(id)) noter('relationDistance', id, attendu.relationDistance, R.distance.get(id));
  const attenduConnu = R.distance.has(id);
  if (!!attendu.connectedToRoot !== attenduConnu) noter('connectedToRoot', id, attendu.connectedToRoot, attenduConnu);
}

console.log('=== CONFRONTATION AUX DONNEES EN LIGNE ===');
console.log('  personnes comparees : ' + comparees + ' / ' + D.people.length + ' (GEDCOM : ' + personnes.size + ')');
console.log('  familles comparees  : ' + familles.size + ' / ' + D.families.length);
console.log('  sources comparees   : ' + sources.size + ' / ' + D.sources.length);

if (!ecarts.size) console.log('\n  AUCUN ECART : les regles reproduisent fidelement les 417 personnes.');
else {
  console.log('\n  ECARTS PAR CATEGORIE :');
  for (const [cat, liste] of [...ecarts].sort((a, b) => b[1].length - a[1].length)) {
    console.log('\n  --- ' + cat + ' : ' + (liste.total || liste.length) + ' ---');
    liste.slice(0, 4).forEach(x => console.log('      ' + String(x.nom || x.id).slice(0, 30).padEnd(31)
      + ' attendu=' + JSON.stringify(x.attendu).slice(0, 70) + '  calcule=' + JSON.stringify(x.obtenu).slice(0, 70)));
  }
}

/* --------- familles et sources --------- */
const ecartsF = new Map();
const noterF = (cat, id, a, o) => { if (!ecartsF.has(cat)) ecartsF.set(cat, []); const l = ecartsF.get(cat); if (l.length < 5) l.push({id, a, o}); };
const parFam = new Map(D.families.map(x => [x.id, x]));
for (const [id, att] of parFam) {
  const c = familles.get(id);
  if (!c) { noterF('famille absente', id); continue; }
  const tri = (a) => [...a].sort().join(',');
  if (tri(att.partnerIds) !== tri(c.partnerIds)) noterF('partnerIds', id, tri(att.partnerIds), tri(c.partnerIds));
  if (tri(att.childIds) !== tri(c.childIds)) noterF('childIds', id, tri(att.childIds), tri(c.childIds));
  for (const champ of ['date', 'place', 'exists']) if (att.marriage[champ] !== c.marriage[champ]) noterF('mariage.' + champ, id, att.marriage[champ], c.marriage[champ]);
  const cle = (l) => l.map(x => x.type + '|' + x.date + '|' + x.place).sort().join(' ; ');
  if (cle(att.events || []) !== cle(c.events)) noterF('evenements', id, cle(att.events || []), cle(c.events));
  if ((att.citations || []).length !== c.citations.length) noterF('citations', id, att.citations.length, c.citations.length);
}
const parSrc = new Map(D.sources.map(x => [x.id, x]));
for (const [id, att] of parSrc) {
  const c = sources.get(id);
  if (!c) { noterF('source absente', id); continue; }
  for (const champ of ['title', 'author', 'publication', 'url', 'text', 'type']) {
    if ((att[champ] || '') !== (c[champ] || '')) noterF('source.' + champ, id, String(att[champ] || '').slice(0, 60), String(c[champ] || '').slice(0, 60));
  }
}
if (!ecartsF.size) console.log('\n  FAMILLES ET SOURCES : aucun ecart non plus.');
else {
  console.log('\n  ECARTS SUR LES FAMILLES ET SOURCES :');
  for (const [cat, liste] of [...ecartsF].sort((a, b) => b[1].length - a[1].length)) {
    console.log('  --- ' + cat + ' : ' + liste.length + ' ---');
    liste.slice(0, 3).forEach(x => console.log('      ' + x.id + '  attendu=' + JSON.stringify(x.a).slice(0, 60) + '  calcule=' + JSON.stringify(x.o).slice(0, 60)));
  }
}
