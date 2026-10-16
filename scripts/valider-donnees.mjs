// Valide en profondeur les donnees fusionnees avant de les publier.
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
const {donnees: D, rapport} = fusionner(avant, 'D:/Téléchargement/gedcom_masson.ged');
const nouveaux = new Set(rapport.nouvellesPersonnes);

let ko = 0;
const t = (nom, ok, detail) => { if (ok) console.log('  ok    ' + nom); else { ko++; console.log('  ECHEC ' + nom + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 160) : '')); } };

const ids = new Set(D.people.map(x => x.id));
const fids = new Set(D.families.map(x => x.id));
const sids = new Set(D.sources.map(x => x.id));
const parId = new Map(D.people.map(x => [x.id, x]));
const parFam = new Map(D.families.map(x => [x.id, x]));

console.log('=== INTEGRITE ===');
t('aucun identifiant de personne en double', ids.size === D.people.length);
t('aucun identifiant de famille en double', fids.size === D.families.length);
t('aucun identifiant de source en double', sids.size === D.sources.length);

const casses = [];
for (const x of D.people) {
  for (const f of x.parentFamilyIds || []) if (!fids.has(f)) casses.push(x.id + ' -> ' + f);
  for (const f of x.spouseFamilyIds || []) if (!fids.has(f)) casses.push(x.id + ' -> ' + f);
  for (const y of [...(x.parents || []), ...(x.children || []), ...(x.partners || []), ...(x.siblings || [])]) if (!ids.has(y)) casses.push(x.id + ' -> ' + y);
  for (const c of x.citations || []) if (!sids.has(c.sourceId)) casses.push(x.id + ' cite ' + c.sourceId);
  for (const cd of x.siblingDetails || []) if (!ids.has(cd.id)) casses.push(x.id + ' fratrie ' + cd.id);
}
for (const f of D.families) for (const y of [...f.partnerIds, ...f.childIds]) if (!ids.has(y)) casses.push(f.id + ' -> ' + y);
t('toutes les references existent', casses.length === 0, casses.slice(0, 5));

const auto = D.people.filter(x => [...(x.parents || []), ...(x.children || []), ...(x.partners || [])].includes(x.id));
t('aucune personne ne se reference elle-meme', auto.length === 0, auto.map(x => x.name));

const asym = [];
for (const x of D.people) for (const c of x.children || []) if (!(parId.get(c)?.parents || []).includes(x.id)) asym.push(x.name + ' -> ' + c);
for (const x of D.people) for (const a of x.parents || []) if (!(parId.get(a)?.children || []).includes(x.id)) asym.push(x.name + ' <- ' + a);
for (const x of D.people) for (const q of x.partners || []) if (!(parId.get(q)?.partners || []).includes(x.id)) asym.push(x.name + ' <> ' + q);
for (const x of D.people) for (const f of x.siblings || []) if (!(parId.get(f)?.siblings || []).includes(x.id)) asym.push(x.name + ' ~~ ' + f);
t('les liens sont reciproques', asym.length === 0, asym.slice(0, 5));

console.log('\n=== COHERENCE DES CHAMPS CALCULES ===');
const genKo = [];
for (const x of D.people) for (const a of x.parents || []) {
  const g = parId.get(a)?.generation;
  if (typeof g === 'number' && typeof x.generation === 'number' && x.generation !== g + 1) genKo.push(x.name + ' (' + x.generation + ') vs parent ' + parId.get(a).name + ' (' + g + ')');
}
t('un enfant est exactement une generation sous ses parents', genKo.length === 0, genKo.slice(0, 5));
const ancKo = D.people.filter(x => x.directAncestor && (typeof x.ancestorDepth !== 'number' || x.ancestorDepth <= 0));
t('tout ancetre direct a une profondeur positive', ancKo.length === 0, ancKo.map(x => x.name));
t('la racine est a la generation 0 et sans ascendant',
  parId.get(D.rootId).generation === 0 && (parId.get(D.rootId).parents || []).length === 2, parId.get(D.rootId).parents);
t('le role correspond au drapeau d\'ancetre',
  D.people.every(x => x.relationRole === (x.id === D.rootId ? 'root' : x.directAncestor ? 'direct_ancestor' : 'relative')));
t('la branche correspond a la liste des branches',
  D.people.every(x => x.branch === (!x.branches.length ? 'hors_branches' : x.branches.length > 1 ? 'commun' : x.branches[0])),
  D.people.filter(x => x.branch !== (!x.branches.length ? 'hors_branches' : x.branches.length > 1 ? 'commun' : x.branches[0])).slice(0, 3).map(x => x.name + ' ' + x.branch + ' ' + JSON.stringify(x.branches)));
t('chaque personne a un nom', D.people.every(x => x.name && x.name.trim()));

console.log('\n=== CYCLES ET ORPHELINS ===');

// Cycle de parente au sens strict : une personne qui serait son propre ancetre.
// On ne suit que les liens vers les parents : parcourir parents ET enfants
// ferait apparaitre une fausse boucle pour chaque simple lien de filiation.
const etatCycle = new Map();
const cycles = [];
const remonter = (id, chemin) => {
  const e = etatCycle.get(id);
  if (e === 1) { cycles.push([...chemin.slice(chemin.indexOf(id)), id]); return; }
  if (e === 2) return;
  etatCycle.set(id, 1);
  chemin.push(id);
  for (const a of parId.get(id)?.parents || []) remonter(a, chemin);
  chemin.pop();
  etatCycle.set(id, 2);
};
for (const x of D.people) if (!etatCycle.has(x.id)) remonter(x.id, []);
t('aucune personne n\'est son propre ancetre', cycles.length === 0,
  cycles.slice(0, 3).map(c => c.map(i => parId.get(i)?.name).join(' -> ')));

// Orphelin au sens genealogique : personne sans aucun lien de famille. Elle
// apparaitrait dans l'arbre comme une carte isolee, sans rattachement possible.
const isoles = D.people.filter(x => !(x.parents || []).length && !(x.children || []).length
  && !(x.partners || []).length && !(x.siblings || []).length);
t('aucune personne totalement isolee', isoles.length === 0, isoles.slice(0, 6).map(x => x.name));

// Sans parent declare, mais rattachee par ailleurs : legitime (personne mariee
// dans la famille), on se contente de compter.
const sansParents = D.people.filter(x => !(x.parents || []).length);
console.log('      ' + sansParents.length + ' personne(s) sans parents declares, dont '
  + sansParents.filter(x => (x.partners || []).length).length + ' rattachee(s) par alliance');

// Familles incoherentes.
const famVides = D.families.filter(f => f.partnerIds.length + f.childIds.length === 0);
t('aucune famille sans aucun membre', famVides.length === 0, famVides.map(f => f.id));
const famSansPartenaire = D.families.filter(f => f.partnerIds.length === 0 && f.childIds.length > 0);
t('aucune famille d\'enfants sans aucun parent', famSansPartenaire.length === 0, famSansPartenaire.map(f => f.id));
const famUnSeul = D.families.filter(f => f.partnerIds.length === 1);
console.log('      ' + famUnSeul.length + ' famille(s) a un seul parent declare (legitime, signale pour information)');

// Deux familles identiques : meme couple, memes enfants.
const vues = new Map();
const famDoublons = [];
for (const f of D.families) {
  const k = [...f.partnerIds].sort().join('+') + '|' + [...f.childIds].sort().join('+');
  if (!f.partnerIds.length && !f.childIds.length) continue;
  if (vues.has(k)) famDoublons.push([vues.get(k), f.id]);
  else vues.set(k, f.id);
}
t('aucune famille en double', famDoublons.length === 0, famDoublons.slice(0, 4));

// Une personne ne peut pas etre a la fois enfant et conjoint de la meme famille.
const melanges = D.families.filter(f => f.partnerIds.some(p => f.childIds.includes(p)));
t('aucune personne a la fois parent et enfant dans la meme famille', melanges.length === 0, melanges.map(f => f.id));

// Une personne ne devrait avoir qu'une seule famille parente.
const plusieursFamilles = D.people.filter(x => (x.parentFamilyIds || []).length > 1);
console.log('      ' + plusieursFamilles.length + ' personne(s) rattachee(s) a plusieurs familles parentes (adoption, remariage ou erreur)');
const parenteContradictoire = plusieursFamilles.filter(x => (x.parents || []).length > 2);
t('aucune personne avec plus de deux parents', parenteContradictoire.length === 0,
  parenteContradictoire.slice(0, 4).map(x => x.name + ' : ' + x.parents.length));

console.log('\n=== COMPTES ===');
t('les compteurs de groupes couvrent tout le monde',
  D.groups.paternel.length + D.groups.maternel.length >= D.groups.connected.length - D.groups.outsideBranches.length);
t('les personnes hors branches sont exactement celles sans branche',
  D.groups.outsideBranches.length === D.people.filter(x => !x.branches.length).length);
t('les personnes reliees sont exactement celles du groupe « connected »',
  D.groups.connected.length === D.people.filter(x => x.connectedToRoot).length);
t('la liste des ancetres directs correspond au drapeau',
  D.directAncestors.length === D.people.filter(x => x.directAncestor).length);
t('les compteurs de meta correspondent', D.meta.peopleCount === D.people.length && D.meta.familyCount === D.families.length && D.meta.sourceCount === D.sources.length,
  {meta: [D.meta.peopleCount, D.meta.familyCount, D.meta.sourceCount], reel: [D.people.length, D.families.length, D.sources.length]});

console.log('\n=== NON-REGRESSION SUR L\'EXISTANT ===');
const perdus = avant.people.filter(x => !ids.has(x.id));
t('aucune personne existante n\'a disparu', perdus.length === 0, perdus.map(x => x.name));
const famPerdues = avant.families.filter(x => !fids.has(x.id));
t('aucune famille existante n\'a disparu', famPerdues.length === 0);
const srcPerdues = avant.sources.filter(x => !sids.has(x.id));
t('aucune source existante n\'a disparu', srcPerdues.length === 0);
const editables = ['name', 'givenName', 'surname', 'gedcomName', 'marriedName', 'sex', 'notes', 'sourceLine', 'events', 'birth', 'death'];
const modifies = [];
for (const a of avant.people) {
  const b = parId.get(a.id);
  for (const k of editables) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) modifies.push(a.name + '.' + k);
}
t('les champs editoriaux de l\'existant sont intacts', modifies.length === 0, modifies.slice(0, 6));
const citesKo = [];
for (const a of avant.people) {
  const b = parId.get(a.id);
  const avantCles = new Set((a.citations || []).map(c => c.sourceId + '|' + c.page + '|' + c.text + '|' + c.kind));
  for (const c of b.citations || []) if (!avantCles.has(c.sourceId + '|' + c.page + '|' + c.text + '|' + c.kind)) {
    const connu = (a.citations || []).some(x => x.sourceId === c.sourceId && x.page === c.page);
    if (connu) citesKo.push(a.name + ' doublon');
  }
}
t('aucune citation n\'a ete dupliquee', citesKo.length === 0, citesKo.slice(0, 4));
t('toutes les incoherences documentees sont conservees',
  avant.discrepancies.every(d => D.discrepancies.some(x => x.id === d.id)),
  avant.discrepancies.filter(d => !D.discrepancies.some(x => x.id === d.id)).map(d => d.id));

console.log('\n=== CAS DE LIENS GAGNES (a confirmer) ===');
for (const m of rapport.modifications) {
  if (!m.champs.includes('parents') && !m.champs.includes('partners')) continue;
  const a = avant.people.find(x => x.id === m.id), b = parId.get(m.id);
  const nom = (i) => parId.get(i)?.name || i;
  const nv = (l1, l2) => l2.filter(x => !l1.includes(x));
  if (m.champs.includes('parents')) console.log('  parents : ' + a.name + '  gagne ' + nv(a.parents, b.parents).map(x => nom(x) + (nouveaux.has(x) ? ' [AJOUT]' : ' [EXISTANT]')).join(', '));
  if (m.champs.includes('partners')) console.log('  conjoint: ' + a.name + '  gagne ' + nv(a.partners, b.partners).map(x => nom(x) + (nouveaux.has(x) ? ' [AJOUT]' : ' [EXISTANT]')).join(', '));
}

console.log('\n' + (ko ? ko + ' ECHEC(S)' : 'TOUT EST VERT') + ' — ' + D.people.length + ' personnes, ' + D.families.length + ' familles, ' + D.sources.length + ' sources');
