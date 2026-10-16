// Remplace le bloc window.FAMILY_DATA d'un fichier HTML par des donnees
// preparees ailleurs. Sert a publier les donnees fusionnees sans avoir a
// reecrire un fichier de 1,1 Mo a la main.
//
// Usage : node scripts/injecter-donnees.mjs <entree.html> <donnees.json> [sortie.html]

import {readFileSync, writeFileSync} from 'node:fs';

export function localiserDonnees(html) {
  const marqueur = html.indexOf('window.FAMILY_DATA=');
  if (marqueur < 0) return null;
  const debut = html.indexOf('{', marqueur);
  let profondeur = 0, dansChaine = false, echappe = false;
  for (let i = debut; i < html.length; i++) {
    const ch = html[i];
    if (dansChaine) {
      if (echappe) echappe = false;
      else if (ch === '\\') echappe = true;
      else if (ch === '"') dansChaine = false;
      continue;
    }
    if (ch === '"') { dansChaine = true; continue; }
    if (ch === '{') profondeur++;
    else if (ch === '}') { profondeur--; if (profondeur === 0) return {debut, fin: i + 1}; }
  }
  return null;
}

export function injecterDonnees(html, donnees) {
  const zone = localiserDonnees(html);
  if (!zone) throw new Error('bloc window.FAMILY_DATA introuvable');
  // On neutralise les fermetures de balise a l'interieur du JSON, sinon le
  // navigateur coupe le script au premier « </script> » rencontre.
  const json = JSON.stringify(donnees).replace(/<\//g, '<\\/');
  return html.slice(0, zone.debut) + json + html.slice(zone.fin);
}

export function lireDonnees(html) {
  const zone = localiserDonnees(html);
  if (!zone) throw new Error('bloc window.FAMILY_DATA introuvable');
  return JSON.parse(html.slice(zone.debut, zone.fin));
}

const lance = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/injecter-donnees.mjs');
if (lance) {
  const [entree, fichierDonnees, sortie] = process.argv.slice(2);
  if (!entree || !fichierDonnees) {
    console.error('usage : node scripts/injecter-donnees.mjs <entree.html> <donnees.json> [sortie.html]');
    process.exit(1);
  }
  const html = readFileSync(entree, 'utf8');
  const donnees = JSON.parse(readFileSync(fichierDonnees, 'utf8'));
  const resultat = injecterDonnees(html, donnees);
  const destination = sortie || entree;
  writeFileSync(destination, resultat, 'utf8');
  const avant = lireDonnees(html), apres = lireDonnees(resultat);
  console.log('  personnes : ' + avant.people.length + ' -> ' + apres.people.length);
  console.log('  familles  : ' + avant.families.length + ' -> ' + apres.families.length);
  console.log('  sources   : ' + avant.sources.length + ' -> ' + apres.sources.length);
  console.log('  incoherences signalees : ' + avant.discrepancies.length + ' -> ' + apres.discrepancies.length);
  console.log('Ecrit : ' + destination);
}
