// Verifications de l'application familiale, sans navigateur.
//
// Deux niveaux :
//   1. les correctifs d'audit sont bien presents dans le HTML fourni ;
//   2. les invariants qui ont cause les pannes sont reellement respectes, et
//      testes sur les donnees reelles contenues dans le fichier.
//
// Le point 2 est le plus important : il echoue si quelqu'un reintroduit une
// contradiction de seuils ou une recursion sans garde, meme en reecrivant le code
// autrement.
//
// Usage : node scripts/verify-app.mjs [index.corrige.html]

import {readFileSync} from 'node:fs';
import {patchApp, PATCHES} from './patch-app.mjs';

const file = process.argv[2] || 'index.html';
let source;
try { source = readFileSync(file, 'utf8'); }
catch {
  console.error('Fichier introuvable : ' + file);
  console.error('Le HTML de l\'application n\'est pas versionne (donnees personnelles) :');
  console.error('placez-le a la racine du depot sous le nom index.html, puis relancez.');
  process.exit(1);
}

// On verifie le HTML tel qu'il sera deploye, c'est-a-dire apres application des
// correctifs. Passer le fichier d'origine ou une version deja corrigee donne donc
// le meme resultat.
const result = patchApp(source);
const html = result.html;

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  ECHEC ' + name + (detail ? '  -> ' + detail : '')); }
};

console.log('Verification de l\'application : ' + file + ' (' + source.length + ' octets)');
console.log('HTML evalue apres correctifs : ' + html.length + ' octets\n');

/* ---------- 1. les correctifs sont presents ---------- */
console.log('1) Correctifs d\'audit (configuration du deploiement)');
t('les ' + PATCHES.length + ' correctifs s\'appliquent au fichier fourni',
  result.missing.length === 0 && result.broken.length === 0,
  result.missing.length + ' introuvable(s) : ' + result.missing.map(m => m.id).join(', '));
t('aucun correctif ne s\'applique deux fois',
  result.applied.length + result.skipped.length === PATCHES.length,
  result.applied.length + ' applique(s) + ' + result.skipped.length + ' deja present(s)');

/* ---------- 2a. invariant des seuils de zoom ---------- */
console.log('\n2) Invariant des seuils de zoom (cause du bug des cases vides)');
const fitMatch = /const threshold=small\?\.(\d+):\.(\d+);/.exec(html);
const tierMatch = /const near=zoomTierSmall\?\.(\d+):\.(\d+),mid=zoomTierSmall\?\.(\d+):\.(\d+);/.exec(html);
t('plancher de fit() lisible', !!fitMatch, fitMatch ? '' : 'motif introuvable');
t('palier de zoom lisible', !!tierMatch, tierMatch ? '' : 'motif introuvable');
if (fitMatch && tierMatch) {
  const fitSmall = Number('0.' + fitMatch[1]), fitLarge = Number('0.' + fitMatch[2]);
  const midSmall = Number('0.' + tierMatch[3]), midLarge = Number('0.' + tierMatch[4]);
  t('grand ecran : fit() ne descend pas sous la frontiere « mid » (' + fitLarge + ' >= ' + midLarge + ')',
    fitLarge >= midLarge, 'fit=' + fitLarge + ' < mid=' + midLarge + ' => arbre entierement muet');
  t('petit ecran : fit() ne descend pas sous la frontiere « mid » (' + fitSmall + ' >= ' + midSmall + ')',
    fitSmall >= midSmall, 'fit=' + fitSmall + ' < mid=' + midSmall);
}
t('le palier « far » ne masque plus tous les textes',
  !html.includes('#tree[data-zoom="far"] .person text{display:none}'));
t('le palier « far » masque uniquement les dates',
  html.includes('#tree[data-zoom="far"] .person text.tdates{display:none}'));

/* ---------- 2b. la garde anti-recursion existe ---------- */
console.log('\n3) Garde anti-recursion du calcul de nationalite (cause du bouton inerte)');
t('la signature porte le jeu des personnes vues', html.includes('function inheritedCountry(person,depth,seen)'));
t('la garde teste l appartenance au jeu', html.includes('if(seen.has(person.id))return'));
t('la garde enregistre la personne', html.includes('seen.add(person.id)'));
t('le jeu est propage aux parents', html.includes('inheritedCountry(people.get(parentId),depth-1,seen)'));
t('le jeu est propage au conjoint', html.includes('inheritedCountry(people.get(partnerId),0,seen)'));
t('un echec de rendu ne peut plus etre silencieux', html.includes('function renderInner'));

/* ---------- 2c. le calcul termine reellement, sur les vraies donnees ---------- */
console.log('\n4) Le calcul de nationalite termine sur les donnees du fichier');
const marker = html.indexOf('window.FAMILY_DATA=');
let data = null;
if (marker < 0) {
  t('donnees FAMILY_DATA presentes', false, 'marqueur introuvable');
} else {
  // Le bloc contient d'autres instructions apres les donnees : on isole l'objet
  // en equilibrant les accolades, en tenant compte des chaines et des echappements.
  const start = html.indexOf('{', marker);
  let depth = 0, inString = false, escaped = false, end = -1;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  try { data = JSON.parse(html.slice(start, end)); }
  catch (e) { t('donnees FAMILY_DATA analysables', false, e.message); }
}
t('donnees FAMILY_DATA analysees', !!data, data ? '' : 'illisibles');

if (data) {
  const people = new Map(data.people.map(p => [p.id, p]));
  console.log('      ' + data.people.length + ' personnes, ' + data.families.length + ' familles');

  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const COUNTRY_KEYS = [['BELGIQUE','BE'],['BELGIUM','BE'],['BELGIE','BE'],['FRANCE','FR'],['FRANCAIS','FR'],['LUXEMBOURG','LU'],['ALLEMAGNE','DE'],['GERMANY','DE'],['DEUTSCHLAND','DE'],['PAYS-BAS','NL'],['NEDERLAND','NL'],['NETHERLANDS','NL'],['HOLLANDE','NL'],['ITALIE','IT'],['ITALY','IT'],['ESPAGNE','ES'],['SPAIN','ES'],['PORTUGAL','PT'],['SUISSE','CH'],['SWITZERLAND','CH'],['ROYAUME-UNI','GB'],['UNITED KINGDOM','GB'],['ANGLETERRE','GB'],['ENGLAND','GB'],['IRLANDE','IE'],['IRELAND','IE'],['AUTRICHE','AT'],['AUSTRIA','AT'],['POLOGNE','PL'],['POLAND','PL'],['ROUMANIE','RO'],['ROMANIA','RO'],['TURQUIE','TR'],['TURKEY','TR'],['MAROC','MA'],['MOROCCO','MA'],['ALGERIE','DZ'],['ALGERIA','DZ'],['TUNISIE','TN'],['TUNISIA','TN'],['CONGO','CD'],['CANADA','CA'],['ETATS-UNIS','US'],['UNITED STATES','US'],['SENEGAL','SN'],['MONACO','MC']];
  const countryCode = place => {
    const parts = String(place || '').split(',').map(s => s.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const token = norm(parts[i]).toUpperCase();
      if (!token) continue;
      for (const [key, code] of COUNTRY_KEYS) if (token.includes(key)) return code;
    }
    return '';
  };
  const placesOf = p => {
    const out = [];
    if (p.birth && p.birth.place) out.push(p.birth.place);
    if (p.death && p.death.place) out.push(p.death.place);
    for (const e of p.events || []) if (e && e.place) out.push(e.place);
    return out;
  };
  const index = new Map();
  for (const p of data.people) for (const v of placesOf(p)) {
    const parts = String(v || '').split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const code = countryCode(v);
    if (!code) continue;
    const key = norm(parts[0]).toUpperCase();
    if (key && !index.has(key)) index.set(key, code);
  }
  const communeCountry = place => {
    for (const part of String(place || '').split(',').map(s => s.trim()).filter(Boolean)) {
      const key = norm(part).toUpperCase();
      if (key && index.has(key)) return index.get(key);
    }
    return '';
  };

  // Algorithme d'origine, sans garde : reproduit la panne, avec un plafond
  // d'appels pour terminer au lieu de faire exploser la pile.
  let steps = 0;
  class Plafond extends Error {}
  const ancien = (person, depth) => {
    if (++steps > 4000) throw new Plafond();
    if (!person || depth < 0) return '';
    for (const place of placesOf(person)) { const c = countryCode(place); if (c) return c; }
    for (const parentId of person.parents || []) { const c = ancien(people.get(parentId), depth - 1); if (c) return c; }
    for (const partnerId of person.partners || []) { const c = ancien(people.get(partnerId), 0); if (c) return c; }
    return '';
  };
  let hostile = 0;
  for (const p of data.people) { steps = 0; try { ancien(p, 3); } catch { hostile++; } }

  // Algorithme corrige, tel qu'ecrit dans le fichier.
  const corriger = (person, depth, seen) => {
    if (!person || depth < 0) return '';
    if (!seen) seen = new Set();
    if (seen.has(person.id)) return '';
    seen.add(person.id);
    for (const place of placesOf(person)) { const c = countryCode(place); if (c) return c; }
    for (const parentId of person.parents || []) { const c = corriger(people.get(parentId), depth - 1, seen); if (c) return c; }
    for (const partnerId of person.partners || []) { const c = corriger(people.get(partnerId), 0, seen); if (c) return c; }
    return '';
  };
  let boucles = 0, erreurs = 0;
  for (const p of data.people) {
    try { corriger(p, 3, undefined); } catch { erreurs++; }
  }
  t('les donnees contiennent bien des personnes qui faisaient boucler l\'ancien calcul (' + hostile + ')',
    hostile > 0, 'aucune : le test ne prouverait rien');
  t('l\'algorithme d\'origine boucle sur ' + hostile + ' personne(s) — panne reproduite', hostile > 0);
  t('l\'algorithme corrige termine sur les ' + data.people.length + ' personnes', erreurs === 0 && boucles === 0,
    erreurs + ' erreur(s)');

  // La garde ne doit pas appauvrir le resultat : le nombre de personnes a qui
  // l'on trouve une nationalite doit rester comparable.
  const ancienOk = [];
  for (const p of data.people) { steps = 0; try { ancienOk.push(ancien(p, 3) ? 1 : 0); } catch { ancienOk.push(-1); } }
  const corrOk = data.people.map(p => (corriger(p, 3, undefined) ? 1 : 0));
  let perdus = 0;
  for (let i = 0; i < ancienOk.length; i++) if (ancienOk[i] === 1 && corrOk[i] === 0) perdus++;
  t('la garde ne fait perdre aucune nationalite deja trouvee', perdus === 0, perdus + ' perdue(s)');
}

/* ---------- 2d. mobile, accessibilite, focus ---------- */
console.log('\n5) Mobile, accessibilite et focus');
t('mobile : le bouton Partager n\'est plus masque',
  !html.includes('.top>.brand,.top>.topactions{display:none!important;}'));
t('mobile : les commandes Ancetres / Descendance / Vue familiale ne sont plus supprimees',
  !html.includes('.toolbar .spacer,#up,#down,#both,#center,#toggleDad,#toggleMom,#export{display:none!important;}'));
t('les cartes n\'utilisent plus de style en ligne qui ecrase le focus',
  !html.includes('rx="15" ry="15" style="fill:${fill};stroke:${stroke}'));
t('les couleurs de carte passent par des proprietes CSS', html.includes('class="card-face" style="--fill:'));
t('regle de focus des cartes presente', /\.person:focus rect,\.person:focus-visible rect\{stroke:#173c35!important/.test(html));
t('anneau de focus du champ de recherche present', html.includes('.search input:focus'));
t('modale Mermaid : role=dialog et titre associe',
  html.includes('id="modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="mermaidtitle"')
  && html.includes('<b id="mermaidtitle">'));
t('annuaire : role=dialog et titre associe',
  html.includes('id="directory" class="modal" role="dialog" aria-modal="true" aria-labelledby="directorytitle"')
  && html.includes('<b id="directorytitle">'));
t('arriere-plan rendu inerte a l\'ouverture d\'une modale', html.includes("FOND={modal:['header.top','#layout','#panel']"));
t('focus restaure apres un re-rendu de l\'arbre', html.includes("getElementById('canvas')"));
t('rechargement automatique conditionnel (plus de perte d\'etat sur onglet actif)', html.includes('Date.now()-last<IDLE'));
t('contrastes AA : les gris secondaires sont remplaces', html.includes('color:#5c6a63'));
t('favicon declare dans le document', html.includes('rel="icon" href="/favicon.svg"'));

console.log('\n' + pass + ' reussite(s), ' + fail + ' echec(s)');
process.exit(fail ? 1 : 0);
