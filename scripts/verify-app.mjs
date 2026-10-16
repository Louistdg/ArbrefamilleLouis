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
import {exclureMineurs, estMineur, anneeDeNaissance} from './exclure-mineurs.mjs';
import {masquerVivants, estPlausiblementVivant} from './masquer-vivants.mjs';

const file = process.argv[2] || 'index.html';
let source;
try { source = readFileSync(file, 'utf8'); }
catch {
  console.error('Fichier introuvable : ' + file);
  console.error('Le HTML de l\'application n\'est pas versionne (donnees personnelles) :');
  console.error('placez-le a la racine du depot sous le nom index.html, puis relancez.');
  process.exit(1);
}

// On verifie le HTML tel qu'il sera deploye : retrait des mineurs puis
// application des correctifs. Passer le fichier d'origine ou une version deja
// corrigee donne le meme resultat.
const prune = exclureMineurs(source, {actif: true});
const masque = masquerVivants(prune.html, {actif: true});
const result = patchApp(masque.html);
const html = result.html;

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  ECHEC ' + name + (detail ? '  -> ' + detail : '')); }
};

console.log('Verification de l\'application : ' + file + ' (' + source.length + ' octets)');
console.log('HTML evalue apres retrait des mineurs et correctifs : ' + html.length + ' octets\n');

/* ---------- 1. les correctifs sont presents ---------- */
console.log('1) Correctifs d\'audit (configuration du deploiement)');
t('les ' + PATCHES.length + ' correctifs s\'appliquent au fichier fourni',
  result.missing.length === 0 && result.broken.length === 0,
  result.missing.length + ' introuvable(s) : ' + result.missing.map(m => m.id).join(', '));
t('aucun correctif ne s\'applique deux fois',
  result.applied.length + result.skipped.length === PATCHES.length,
  result.applied.length + ' applique(s) + ' + result.skipped.length + ' deja present(s)');

/* ---------- 1b. protection des personnes mineures ---------- */
console.log('\n1b) Personnes mineures exclues du fichier publie');
if (prune.erreur) t('donnees FAMILY_DATA exploitables', false, prune.erreur);
else if (prune.modifie) {
  prune.exclus.forEach(p => console.log('      retire : ' + p.nom + ' (' + (p.naissance || 'date inconnue') + ')'));
  t(prune.retirees + ' personne(s) mineure(s) retiree(s)', prune.retirees > 0);
} else {
  t('aucune personne mineure a retirer dans ce fichier', true);
}

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
  const mineursRestants = data.people.filter(p => estMineur(p, Date.now(), 18));
  t('aucune personne mineure ne subsiste dans le fichier publie',
    mineursRestants.length === 0,
    mineursRestants.map(p => p.name + ' (' + anneeDeNaissance(p) + ')').join(', '));

  // Le couple date exacte + lieu de naissance est la donnee la plus identifiante.
  const vivants = data.people.filter(p => estPlausiblementVivant(p, Date.now()));
  const avecLieu = vivants.filter(p => p.birth && p.birth.place);
  const avecJour = vivants.filter(p => p.birth && /[A-Z]{3}/.test(String(p.birth.date || '')));
  const lieuxEvenements = vivants.filter(p => (p.events || []).some(e => e && e.place));
  console.log('      ' + vivants.length + ' personne(s) plausiblement vivante(s)');
  t('aucun lieu de naissance pour une personne vivante', avecLieu.length === 0, avecLieu.map(p => p.name).join(', '));
  t('aucun jour ni mois de naissance pour une personne vivante', avecJour.length === 0, avecJour.map(p => p.name + ' ' + p.birth.date).join(', '));
  t('aucun lieu d\'evenement pour une personne vivante', lieuxEvenements.length === 0, lieuxEvenements.map(p => p.name).join(', '));
  t('l\'annee de naissance est conservee pour les personnes vivantes',
    vivants.filter(p => p.birth && p.birth.date && /^[0-9]{4}$/.test(String(p.birth.date).trim())).length > 0);

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
t('espacement entre generations reduit a 200', html.includes('nodesep:52,ranksep:200'));
t('le titre et le compteur reviennent sur telephone',
  /@media\(max-width:850px\)\{[\s\S]{0,400}\.heading\{display:flex!important/.test(html));
t('la legende et la case « Afficher les fratries » reviennent sur telephone',
  /@media\(max-width:850px\)\{[\s\S]{0,900}\.legend\{display:flex!important/.test(html));
t('le recentrage revient sur telephone', html.includes('#center{display:inline-flex!important'));
t('la recherche annonce le nombre total au-dela de 25 resultats',
  html.includes("found.length>25?'<p class=\"note\">'+found.length"));
t('lien d\'evitement avant la premiere carte', html.includes("a.className='lien-evitement'"));
t('les choix de parente et de sexe exposent leur etat (role radio)',
  html.includes("g.setAttribute('role','radiogroup')") && html.includes("b.setAttribute('aria-checked'"));
t('le groupe de l\'arbre est nomme pour un lecteur d\'ecran', html.includes('aria-label="Personnes de l\'arbre familial"'));
t('service worker enregistre (rechargement hors ligne)', html.includes("navigator.serviceWorker.register('/sw.js')"));
t('compteur de portee aligne sur ce qui est affiche', html.includes("b.dataset.origine===undefined"));
t('effacement d\'un champ : le client transmet null', html.includes("payload[key]=after[key]===''?null:after[key]"));
t('effacement d\'un champ : la fiche est reellement videe', html.includes("if(it.given===null)target.givenName='';"));

console.log('\n6) Changements visuels');
t('zoom semantique : les trois niveaux de texte sont generes',
  html.includes('class="tinit"') && html.includes('class="tshort"') && html.includes('class="tyears"'));
t('zoom semantique : le nom court et les annees sont calcules',
  html.includes('function raccourci(') && html.includes('function annees('));
t('zoom semantique : les initiales sont contre-ecrasees selon l\'echelle',
  html.includes("setProperty('--ls',ls)") && html.includes('calc(14px*var(--ls,1))'));
t('zoom semantique : aucun palier ne masque tout le texte',
  !html.includes('#tree[data-zoom="far"] .person text{display:none}')
  && html.includes('#tree[data-zoom="near"] .tinit'));
t('nouvelle carte : filet de branche et glyphe de sexe', html.includes('class="accent"') && html.includes('class="sexmark"'));
t('nouvelle carte : nom agrandi et interlignes ajustes',
  html.includes('font-size="16.5"') && html.includes('y+=20;}y+=5;'));
t('nouvelle carte : dimensions augmentees dans les deux mises en page',
  html.includes('width:250,height:Math.max(124,40+') && html.includes('width:250,height:Math.max(124,40+lines.name.length*20'));
t('fluidite : fondu enchaine et calque retires ensuite',
  html.includes('function fonduAvant()') && html.includes('.arbre-fondu{position:absolute'));
t('fluidite : pastille d\'attente creee hors du canvas (que le rendu reecrit)',
  html.includes("document.querySelector('.main')") && html.includes('function indicateurCalcul(on)'));
t('fluidite : les grosses vues laissent le navigateur peindre avant de calculer',
  html.includes('renduGeneration') && html.includes('selection().size<=90'));
t('fluidite : mise en page memorisee et invalidee sur contribution',
  html.includes('function buildGraphMemo(') && html.includes('function applyContributions(items){viderMemoireGraphes();'));
t('accessibilite : ordre du DOM aligne sur l\'ordre visuel',
  html.includes('[...g.nodes()].sort((a,b)=>{const A=g.node(a),B=g.node(b);return (A.y-B.y)||(A.x-B.x);})'));
t('mobile : l\'export SVG est restaure', html.includes('#export{display:inline-flex!important'));

console.log('\n7) Adapte a un public age');
t('le titre et les tuiles d\'information ne sont plus masques en permanence',
  html.includes('.heading{display:flex!important}') && html.includes('.metrics{display:flex!important}'));
t('les bandes de generation sont dessinees et nommees',
  html.includes('function bandesGeneration(') && html.includes('class="etiquette-generation"')
  && html.includes('out+=bandesGeneration(g);'));
t('les niveaux de generation sont nommes en clair',
  /Parents/.test(html) && /Grands-parents/.test(html));
t('le choix de taille de texte existe et est conserve',
  html.includes('data-confort="1.3"') && html.includes("localStorage.setItem('arbre-confort'"));
t('le confort agrandit l\'ouverture des vues', html.includes('Math.max(ratio*confortLecture,threshold)'));
t('un panneau d\'aide explique l\'usage en phrases simples',
  html.includes("aide.id='aide'") && html.includes('Comment utiliser l') && html.includes('aide-liste'));
t('l\'aide s\'ouvre seule a la premiere visite puis se retient',
  html.includes("localStorage.getItem('arbre-aide-vue')"));
t('un bandeau de reperes reste visible',
  html.includes("r.innerHTML='<b>Glissez</b>"));
t('la regle des generations est fixe a gauche, hors du repere de l\'arbre',
  html.includes('function reperesMarkup(') && html.includes('id="reperes"')
  && html.includes('function positionnerReperes(') && html.includes('estompe-regle')
  && html.includes('<g class="repere" data-haut='));
t('les boutons d\'ouverture sont plus grands (47 unites)',
  html.includes('width="47" height="47"'));
t('les fonctions utiles sont exposees entre blocs de script',
  html.includes('window.familyConfort=appliquerConfort') && html.includes('window.familyRender=render'));

console.log('\n' + pass + ' reussite(s), ' + fail + ' echec(s)');
process.exit(fail ? 1 : 0);
