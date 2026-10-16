// Verifie les trois derniers ecarts : suffixe du nom, regle des evenements
// vides, et origine des citations en plus.
import {readFileSync} from 'node:fs';
import {lireGedcom, extraire} from './gedcom-vers-donnees.mjs';

const GED = 'D:/Téléchargement/gedcom_masson.ged';
const racine = lireGedcom(readFileSync(GED, 'utf8'));
const {personnes} = extraire(racine);

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
const idsSourcesApp = new Set(D.sources.map(x => x.id));

console.log('=== 1. le nom contient-il le nom marie ? ===');
const avecMarnm = D.people.filter(x => x.marriedName && x.name.includes('('));
console.log('  personnes de l\'application dont le nom contient des parentheses : ' + avecMarnm.length);
const exemple = parId.get('@I500002@');
console.log('  Kathy : name=' + JSON.stringify(exemple.name) + '  marriedName=' + JSON.stringify(exemple.marriedName));
console.log('  -> le nom affiche ne contient PAS le nom marie : il faut retirer le suffixe.');

console.log('\n=== 2. regle des evenements vides : le drapeau Y ? ===');
for (const tag of ['BIRT', 'DEAT', 'BURI', 'OCCU', 'NATI', 'RELI']) {
  let avecY = 0, sansY = 0, avecDonnees = 0;
  for (const r of racine) if (r.tag === 'INDI') for (const n of r.enfants) if (n.tag === tag) {
    const aDate = n.enfants.some(x => x.tag === 'DATE'), aLieu = n.enfants.some(x => x.tag === 'PLAC');
    if (aDate || aLieu) { avecDonnees++; continue; }
    if (n.valeur === 'Y') avecY++; else sansY++;
  }
  const app = D.people.flatMap(x => x.events || []).filter(x => x.type === tag).length;
  console.log('  ' + tag.padEnd(5) + ' avec donnees ' + String(avecDonnees).padStart(3) + '  vide+Y ' + String(avecY).padStart(3)
    + '  vide sans Y ' + String(sansY).padStart(3) + '   |   application : ' + app + (avecDonnees === app ? '  <- correspond aux "avec donnees"' : ''));
}

console.log('\n=== 3. les citations en plus viennent-elles des sources nouvelles ? ===');
let parSourceNouvelle = 0, autre = 0;
const details = [];
for (const [id, app] of parId) {
  const calc = personnes.get(id);
  if (!calc) continue;
  const connues = new Set((app.citations || []).map(c => c.sourceId + '|' + c.page + '|' + c.text + '|' + c.kind));
  for (const c of calc.citations) {
    const cle = c.sourceId + '|' + c.page + '|' + c.text + '|' + c.kind;
    if (connues.has(cle)) continue;
    if (!idsSourcesApp.has(c.sourceId)) parSourceNouvelle++;
    else { autre++; if (details.length < 6) details.push(app.name + ' -> ' + c.sourceId + ' ' + c.kind); }
  }
}
console.log('  citations supplementaires vers une source NOUVELLE : ' + parSourceNouvelle);
console.log('  citations supplementaires vers une source EXISTANTE : ' + autre);
details.forEach(x => console.log('    ' + x));

console.log('\n=== 4. les enfants en plus sont-ils tous des personnes nouvelles ? ===');
const idsApp = new Set(D.people.map(x => x.id));
let nouveau = 0, gene = 0;
const gdetails = [];
for (const [id, app] of parId) {
  const calc = personnes.get(id);
  if (!calc) continue;
  const attendu = new Set(app.children || []);
  const mesEnfants = new Set();
  for (const f of calc.fams) {
    const fam = racine.find(r => r.tag === 'FAM' && r.xref === f);
    for (const c of fam ? fam.enfants.filter(x => x.tag === 'CHIL').map(x => x.valeur) : []) mesEnfants.add(c);
  }
  for (const c of mesEnfants) if (!attendu.has(c)) { if (idsApp.has(c)) { gene++; if (gdetails.length < 5) gdetails.push(app.name + ' -> ' + c); } else nouveau++; }
}
console.log('  enfants gagnes qui sont des personnes nouvelles : ' + nouveau);
console.log('  enfants gagnes qui existaient deja : ' + gene);
gdetails.forEach(x => console.log('    ' + x));

console.log('\n=== 5. nouveaux individus : liens et anomalies ===');
const nouveaux = [...personnes.keys()].filter(x => !idsApp.has(x));
let sansFamille = 0, sansNom = 0, sansParent = 0;
const anomalies = [];
for (const id of nouveaux) {
  const q = personnes.get(id);
  if (!q.name) { sansNom++; anomalies.push('NOM VIDE : ' + id + ' (' + (q.sex === 'M' ? 'homme' : 'femme') + ', familles conjoint ' + JSON.stringify(q.fams) + ')'); }
  if (!q.famc.length && !q.fams.length) { sansFamille++; anomalies.push('AUCUNE FAMILLE : ' + id + ' ' + q.name); }
  if (!q.famc.length) sansParent++;
}
console.log('  nouveaux individus : ' + nouveaux.length);
console.log('  sans nom           : ' + sansNom);
console.log('  sans aucune famille: ' + sansFamille);
console.log('  sans parents       : ' + sansParent);
console.log('  --- anomalies ---');
anomalies.forEach(x => console.log('    ' + x));

console.log('\n=== 6. homonymes et doublons probables parmi les nouveaux ===');
const cle = (x) => (x.givenName + '|' + x.surname + '|' + x.birth.date).toLowerCase();
const parCle = new Map();
for (const id of nouveaux) { const q = personnes.get(id); const k = cle(q); if (!parCle.has(k)) parCle.set(k, []); parCle.get(k).push(id + ' ' + q.name + ' (' + q.birth.date + ')'); }
for (const [k, l] of parCle) if (l.length > 1) console.log('    MEME CLE ' + k + ' : ' + l.join('  VS  '));
const parNom = new Map();
for (const id of nouveaux) { const q = personnes.get(id); const k = q.name.toLowerCase(); if (!parNom.has(k)) parNom.set(k, []); parNom.get(k).push(id + ' ne ' + q.birth.date + ' a ' + q.birth.place); }
for (const [k, l] of parNom) if (l.length > 1) console.log('    MEME NOM ' + k + ' : ' + l.join('  VS  '));
