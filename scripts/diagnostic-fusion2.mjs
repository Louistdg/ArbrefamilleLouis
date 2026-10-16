// Verifie les trois derniers points : fratrie detaillee, changements de branche
// dus aux ajouts, et doublons signales.
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
const D = JSON.parse(html.slice(d0, fin));
const {donnees, rapport} = fusionner(D, 'D:/Téléchargement/gedcom_masson.ged');
const avant = new Map(D.people.map(x => [x.id, x]));
const apres = new Map(donnees.people.map(x => [x.id, x]));
const nouvelles = new Set(rapport.nouvellesPersonnes);

console.log('=== 1. fratrie detaillee : sur quoi porte l\'ecart ? ===');
let n = 0;
const formes = new Map();
for (const m of rapport.modifications) {
  if (!m.champs.includes('siblingDetails')) continue;
  const a = avant.get(m.id), b = apres.get(m.id);
  const cle = (l) => JSON.stringify(l.map(x => x.id));
  if (cle(a.siblingDetails) === cle(b.siblingDetails)) {
    // memes personnes : le contenu a change
    for (let i = 0; i < a.siblingDetails.length; i++) {
      const x = a.siblingDetails[i], y = b.siblingDetails.find(z => z.id === x.id);
      if (!y) continue;
      if (JSON.stringify(x) !== JSON.stringify(y)) {
        const forme = 'partages ' + JSON.stringify(x.sharedParentIds) + ' -> ' + JSON.stringify(y.sharedParentIds)
          + ' | kind ' + x.kind + ' -> ' + y.kind;
        formes.set(forme, (formes.get(forme) || 0) + 1);
        if (n < 4) {
          console.log('  ' + String(a.name).slice(0, 26).padEnd(27) + ' frere/soeur ' + (avant.get(x.id)?.name || x.id).slice(0, 24));
          console.log('     app     : partages=' + JSON.stringify(x.sharedParentIds) + ' kind=' + x.kind);
          console.log('     calcule : partages=' + JSON.stringify(y.sharedParentIds) + ' kind=' + y.kind);
          console.log('     parents de ' + String(a.name).slice(0, 20) + ' : ' + JSON.stringify(a.parents));
          console.log('     parents de la fratrie : ' + JSON.stringify(avant.get(x.id)?.parents));
          n++;
        }
      }
    }
  }
}
console.log('  formes d\'ecart rencontrees :');
[...formes].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([k, v]) => console.log('    ' + v + ' x  ' + k));

console.log('\n=== 2. changements de branche : dus aux ajouts ? ===');
let k2 = 0;
for (const m of rapport.modifications) {
  if (!m.champs.includes('branches')) continue;
  const a = avant.get(m.id), b = apres.get(m.id);
  const nouveauxParents = b.parents.filter(x => nouvelles.has(x));
  const nouveauxEnfants = b.children.filter(x => nouvelles.has(x));
  console.log('  ' + String(a.name).slice(0, 28).padEnd(29) + JSON.stringify(a.branches) + ' -> ' + JSON.stringify(b.branches)
    + '   nouveaux parents=' + nouveauxParents.length + ' nouveaux enfants=' + nouveauxEnfants.length
    + '  parents=' + b.parents.length);
  if (++k2 > 12) break;
}

console.log('\n=== 3. doublons signales : concernent-ils des ajouts ? ===');
for (const a of rapport.anomalies) {
  if (!a.entree.id.startsWith('doublon')) continue;
  const ids = a.entree.personIds;
  const infos = ids.map(id => {
    const x = apres.get(id);
    return (nouvelles.has(id) ? '[AJOUT] ' : '[existant] ') + String(x.name).slice(0, 26) + ' ne ' + (x.birth.date || '?')
      + ' a ' + (x.birth.place || '?').slice(0, 18) + ' | parents ' + x.parents.length + ' | id ' + id;
  });
  const seulementAjouts = ids.every(x => nouvelles.has(x));
  console.log('  ' + (seulementAjouts ? 'AJOUTS SEULEMENT' : 'melange') + ' :');
  infos.forEach(i => console.log('    ' + i));
}

console.log('\n=== 4. nouveaux : coherence des liens calcules ===');
let sansBranche = 0, hors = 0, ancetres = 0;
for (const id of rapport.nouvellesPersonnes) {
  const x = apres.get(id);
  if (!x.branches.length) sansBranche++;
  if (!x.connectedToRoot) hors++;
  if (x.directAncestor) ancetres++;
}
console.log('  nouveaux sans branche      : ' + sansBranche);
console.log('  nouveaux non relies        : ' + hors);
console.log('  nouveaux ancetres directs  : ' + ancetres);
console.log('\n=== 5. compteurs globaux ===');
console.log('  groupes paternel=' + donnees.groups.paternel.length + ' maternel=' + donnees.groups.maternel.length
  + ' horsBranches=' + donnees.groups.outsideBranches.length + ' nonRelies=' + donnees.groups.unlinked.length);
console.log('  ancetres directs : ' + donnees.directAncestors.length);
console.log('  incoherences     : ' + donnees.discrepancies.length);
