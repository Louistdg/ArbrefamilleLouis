// Applique a la page familiale les changements faits dans l'arbre MyHeritage.
//
// Le fichier de mise a jour vit dans donnees/ (ignore par Git, comme les
// donnees elles-memes) : il contient des noms de la famille.
//
// Usage : node scripts/appliquer-maj-myheritage.mjs [donnees/famille.json] [donnees/maj-myheritage.json]

import {readFileSync, writeFileSync, existsSync} from 'node:fs';

const FICHIER = process.argv[2] || 'donnees/famille.json';
const PATCH = process.argv[3] || 'donnees/maj-myheritage.json';

if (!existsSync(PATCH)) {
  console.log('Aucune mise a jour a appliquer (' + PATCH + ' absent).');
  process.exit(0);
}

const D = JSON.parse(readFileSync(FICHIER, 'utf8'));
const maj = JSON.parse(readFileSync(PATCH, 'utf8'));
const parId = new Map(D.people.map(x => [x.id, x]));

const journal = {deces: [], corrections: [], ignores: []};

// 1. Personnes devenues decedees dans l'arbre.
for (const id of maj.deces || []) {
  const p = parId.get(id);
  if (!p) { journal.ignores.push({id, raison: 'personne inconnue'}); continue; }
  if (p.death.known) { journal.ignores.push({id, raison: 'deja marquee decedee'}); continue; }
  p.death.known = true;
  // On ne fabrique pas de date : l'arbre n'en donne pas non plus.
  journal.deces.push({id, nom: p.name});
}

// 2. Orthographes corrigees.
for (const c of maj.corrections || []) {
  const p = parId.get(c.id);
  if (!p) { journal.ignores.push({id: c.id, raison: 'personne inconnue'}); continue; }
  const remplace = (v) => (typeof v === 'string' && v.includes(c.ancien)) ? v.split(c.ancien).join(c.nouveau) : v;
  let touche = 0;
  if (c.champ === 'surname') { if (p.surname !== remplace(p.surname)) { p.surname = remplace(p.surname); p.name = [p.givenName, p.surname].filter(Boolean).join(' '); touche++; } }
  else if (c.champ === 'birth.place') { if (p.birth.place !== remplace(p.birth.place)) { p.birth.place = remplace(p.birth.place); touche++; } }
  else if (c.champ === 'death.place') { if (p.death.place !== remplace(p.death.place)) { p.death.place = remplace(p.death.place); touche++; } }
  else if (c.champ === 'place') {
    for (const champ of ['birth', 'death']) if (p[champ] && p[champ].place !== remplace(p[champ].place)) { p[champ].place = remplace(p[champ].place); touche++; }
  }
  // Les evenements portent les memes lieux : on les aligne.
  for (const e of p.events || []) {
    if (e.place && e.place.includes(c.ancien)) { e.place = remplace(e.place); touche++; }
  }
  if (touche) journal.corrections.push({id: c.id, nom: p.name, champ: c.champ, ancien: c.ancien, nouveau: c.nouveau, remplacements: touche});
  else journal.ignores.push({id: c.id, raison: 'forme introuvable', ancien: c.ancien});
}

// 3. Le nom affiche doit suivre le nom de famille.
for (const c of (maj.corrections || []).filter(x => x.champ === 'surname')) {
  const p = parId.get(c.id);
  if (p) p.name = [p.givenName, p.surname].filter(Boolean).join(' ');
}

// 4. Le fichier de mise a jour est consomme : on le retire pour ne pas
//    reappliquer les memes changements au prochain build.
const restant = {...maj, deces: [], corrections: [], applique: new Date().toISOString(), journal};
writeFileSync(PATCH, JSON.stringify(restant, null, 1), 'utf8');
writeFileSync(FICHIER, JSON.stringify(D), 'utf8');

console.log('Mise a jour de la page familiale appliquee :');
console.log('  personnes marquees decedees : ' + journal.deces.length);
console.log('  orthographes corrigees      : ' + journal.corrections.length);
journal.corrections.forEach(c => console.log('      ' + c.id + '  ' + c.champ + ' : "' + c.ancien + '" -> "' + c.nouveau + '"'));
if (journal.ignores.length) {
  console.log('  ignores : ' + journal.ignores.length);
  journal.ignores.slice(0, 5).forEach(x => console.log('      ' + x.id + ' (' + x.raison + ')'));
}
console.log('Ecrit : ' + FICHIER);
