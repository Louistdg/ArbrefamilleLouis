// Retire du fichier publie les personnes encore mineures.
//
// Le HTML de l'application est servi publiquement : il expose, pour chaque
// personne, le nom complet, la date et le lieu de naissance. Pour un adulte de
// la famille c'est un choix ; pour un enfant, non.
//
// Ce module ne touche qu'aux personnes dont la naissance est connue, qui sont
// vivantes, et dont l'age est inferieur a la limite. Les references croisees
// (parents, enfants, conjoints) ne sont pas reecrites : l'application ignore
// d'elle-meme les identifiants absents. Les groupes de la colonne laterale sont
// en revanche nettoyes pour que les compteurs restent justes.
//
// Usage : node scripts/exclure-mineurs.mjs index.html index.sans-mineurs.html
//         (ajouter --garder-mineurs pour ne rien retirer)

import {readFileSync, writeFileSync} from 'node:fs';

const AGE_MAX = 18;

// Isole l'objet window.FAMILY_DATA en equilibrant les accolades, en tenant
// compte des chaines et des echappements.
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

const MOIS = {JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12};

export function anneeDeNaissance(person) {
  const brut = person && person.birth && person.birth.date;
  if (!brut) return null;
  const m = /([0-9]{4})/.exec(String(brut));
  if (!m) return null;
  const an = Number(m[1]);
  return an >= 1000 && an <= 2100 ? an : null;
}

// Age exact quand la date porte un jour et un mois (« 16 NOV 2008 »). Comparer
// les seules annees ne suffit pas : une personne nee en 2008 peut avoir 17 ou
// 18 ans selon la date du jour, et une comparaison par annee laisserait passer
// un mineur dont l'anniversaire n'est pas encore arrive.
export function ageExact(person, maintenant) {
  const brut = person && person.birth && person.birth.date;
  if (!brut) return null;
  const m = /([0-9]{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+([0-9]{4})/.exec(String(brut).toUpperCase());
  if (!m) return null;
  const jour = Number(m[1]);
  const mois = MOIS[m[2]];
  const an = Number(m[3]);
  if (!jour || !mois || !an) return null;
  const maintenantDate = new Date(maintenant);
  const anneeCourante = maintenantDate.getUTCFullYear();
  const anniversaire = Date.UTC(anneeCourante, mois - 1, jour);
  let age = anneeCourante - an;
  if (maintenantDate.getTime() < anniversaire) age--;
  return age;
}

export function estMineur(person, maintenant, ageMax) {
  if (!person) return false;
  if (person.death && person.death.known) return false;
  const limite = ageMax || AGE_MAX;
  const age = ageExact(person, maintenant);
  if (age !== null) return age < limite;
  // Date reduite a l'annee : on ne retire que si l'age est certain. Ne retirer
  // personne de trop vaut mieux que retirer un adulte de la famille.
  const an = anneeDeNaissance(person);
  if (an === null) return false;
  const anneeLimite = new Date(maintenant).getUTCFullYear() - limite;
  return an > anneeLimite;
}

export function exclureMineurs(html, options) {
  const opts = options || {};
  if (opts.actif === false) return {html, exclus: [], modifie: false};
  const ageMax = opts.ageMax || AGE_MAX;
  const maintenant = opts.maintenant || Date.now();

  const zone = localiser(html);
  if (!zone) return {html, exclus: [], modifie: false, erreur: 'donnees FAMILY_DATA introuvables'};

  let data;
  try { data = JSON.parse(html.slice(zone.debut, zone.fin)); }
  catch (error) { return {html, exclus: [], modifie: false, erreur: 'FAMILY_DATA illisible : ' + error.message}; }

  const exclus = data.people.filter(p => estMineur(p, maintenant, ageMax));
  if (!exclus.length) return {html, exclus: [], modifie: false, personnes: data.people.length};

  const retires = new Set(exclus.map(p => p.id));
  data.people = data.people.filter(p => !retires.has(p.id));

  // Les groupes de la colonne laterale alimentent les compteurs : on les nettoie
  // pour qu'aucun total n'annonce une personne qui n'est plus publiee.
  if (data.groups) {
    for (const cle of Object.keys(data.groups)) {
      if (Array.isArray(data.groups[cle])) data.groups[cle] = data.groups[cle].filter(id => !retires.has(id));
    }
  }

  // JSON.stringify n'echappe pas « </ » : dans un bloc <script>, cela fermerait
  // la balise. L'echappement « <\/ » est valide en JSON et neutre en JavaScript.
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  const sortie = html.slice(0, zone.debut) + json + html.slice(zone.fin);
  return {
    html: sortie,
    exclus: exclus.map(p => ({id: p.id, nom: p.name, naissance: (p.birth && p.birth.date) || null})),
    modifie: true,
    personnes: data.people.length,
    retirees: exclus.length
  };
}

const lance = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/exclure-mineurs.mjs');
if (lance) {
  const args = process.argv.slice(2);
  const positionnels = args.filter(a => !a.startsWith('--'));
  const entree = positionnels[0] || 'index.html';
  const sortie = positionnels[1] || null;
  const actif = !args.includes('--garder-mineurs');
  const r = exclureMineurs(readFileSync(entree, 'utf8'), {actif});
  if (r.erreur) { console.error('ECHEC : ' + r.erreur); process.exit(1); }
  if (!r.modifie) console.log('Aucune personne mineure a retirer (' + (r.personnes || '?') + ' personnes publiees).');
  else {
    console.log(r.retirees + ' personne(s) mineure(s) retiree(s) du fichier publie :');
    r.exclus.forEach(p => console.log('  - ' + p.nom + ' (' + (p.naissance || 'date inconnue') + ')'));
    console.log('  personnes publiees : ' + r.personnes);
  }
  if (sortie) { writeFileSync(sortie, r.html, 'utf8'); console.log('Ecrit : ' + sortie); }
}
