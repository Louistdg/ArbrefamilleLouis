// Masque les donnees precisement identifiantes des personnes vivantes.
//
// Le fichier publie expose, pour chaque personne, le nom, la date exacte et le
// lieu de naissance. Pour une personne decedee, c'est de l'histoire familiale.
// Pour une personne vivante, le couple date exacte + lieu de naissance est la
// combinaison la plus identifiante qui soit.
//
// Ce module conserve l'annee de naissance (utile a l'arbre et aux ages) et
// retire le jour, le mois et le lieu. Les personnes dont le deces est connu ne
// sont pas touchees, pas plus que celles dont la naissance est inconnue.
//
// Usage : node scripts/masquer-vivants.mjs index.html index.masque.html
//         (--garder-vivants pour ne rien masquer)

import {readFileSync, writeFileSync} from 'node:fs';

function localiser(html) {
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

const annee = (v) => {
  const m = /([0-9]{4})/.exec(String(v || ''));
  return m ? m[1] : null;
};

// Un export GEDCOM ne renseigne pas toujours le deces : sans garde-fou, des
// personnes nees en 1808 seraient considerees comme vivantes. On ne masque donc
// que les personnes plausiblement en vie aujourd'hui.
export const AGE_MAX_VIVANT = 110;

export function estPlausiblementVivant(person, maintenant, ageMax) {
  if (!person) return false;
  if (person.death && person.death.known) return false;
  const a = person.birth && annee(person.birth.date);
  if (!a) return true; // aucune date : on ne peut pas exclure, et masquer est sans risque
  return Number(a) > new Date(maintenant || Date.now()).getUTCFullYear() - (ageMax || AGE_MAX_VIVANT);
}

export function masquerVivants(html, options) {
  const opts = options || {};
  if (opts.actif === false) return {html, masques: [], modifie: false};

  const zone = localiser(html);
  if (!zone) return {html, masques: [], modifie: false, erreur: 'donnees FAMILY_DATA introuvables'};

  let data;
  try { data = JSON.parse(html.slice(zone.debut, zone.fin)); }
  catch (error) { return {html, masques: [], modifie: false, erreur: 'FAMILY_DATA illisible : ' + error.message}; }

  const masques = [];
  for (const p of data.people) {
    if (!estPlausiblementVivant(p, opts.maintenant, opts.ageMax)) continue;
    const changement = {};
    if (p.birth) {
      const a = annee(p.birth.date);
      if (p.birth.place) { p.birth.place = ''; changement.lieu = true; }
      if (a && String(p.birth.date).trim() !== a) { p.birth.date = a; changement.date = true; }
    }
    // Les lieux d'evenements (mariage, residence) situent la personne tout autant.
    for (const e of p.events || []) {
      if (e && e.place) { e.place = ''; changement.lieu = true; }
    }
    if (changement.lieu || changement.date) {
      masques.push({id: p.id, nom: p.name, restaitDate: p.birth && p.birth.date, restaitLieu: changement.lieu});
    }
  }

  if (!masques.length) return {html, masques: [], modifie: false, personnes: data.people.length};

  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  const sortie = html.slice(0, zone.debut) + json + html.slice(zone.fin);
  return {html: sortie, masques, modifie: true, personnes: data.people.length};
}

const lance = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/masquer-vivants.mjs');
if (lance) {
  const args = process.argv.slice(2);
  const positionnels = args.filter(a => !a.startsWith('--'));
  const entree = positionnels[0] || 'index.html';
  const sortie = positionnels[1] || null;
  const r = masquerVivants(readFileSync(entree, 'utf8'), {actif: !args.includes('--garder-vivants')});
  if (r.erreur) { console.error('ECHEC : ' + r.erreur); process.exit(1); }
  if (!r.modifie) console.log('Aucune personne vivante a masquer.');
  else {
    console.log(r.masques.length + ' personne(s) vivante(s) : date exacte et lieu retires.');
    r.masques.slice(0, 20).forEach(p => console.log('  - ' + p.nom + ' (annee conservee : ' + p.restaitDate + ')'));
    if (r.masques.length > 20) console.log('  ... et ' + (r.masques.length - 20) + ' autre(s)');
  }
  if (sortie) { writeFileSync(sortie, r.html, 'utf8'); console.log('Ecrit : ' + sortie); }
}
