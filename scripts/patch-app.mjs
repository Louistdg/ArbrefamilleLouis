// Correctifs de l'application (index.html) relevés lors de l'audit de
// https://test-installation-production.up.railway.app/
//
// Le HTML de l'application n'est pas versionné dans ce dépôt : il contient les
// données personnelles de la famille. Ce script applique donc les correctifs au
// moment de la fabrication du bundle, de façon reproductible et vérifiable.
//
// IMPORTANT : ces correctifs doivent être reportés dans la source privée de
// l'application. Tant que cette source n'est pas versionnée, ce script est le
// seul endroit où ils existent — et prepare-bundle.mjs refuse de produire un
// bundle si un correctif ne s'applique plus (voir --allow-partial).
//
// Usage :
//   node scripts/patch-app.mjs index.html index.corrige.html
//   node scripts/patch-app.mjs index.html --check      (vérifie sans écrire)
//   node scripts/patch-app.mjs index.html --allow-partial

import {readFileSync, writeFileSync} from 'node:fs';

const P = (id, but, from, to, kind) => ({id, but, from, to, kind: kind || 'correctif'});

export const PATCHES = [
  P('zoom-far-texte',
    "Palier « loin » : ne plus masquer le nom (les cases restaient vides à l'ouverture d'une branche)",
    '#tree[data-zoom="far"] .person text{display:none}',
    '#tree[data-zoom="far"] .person text.tdates{display:none}'),

  P('fit-plancher',
    "Plancher d'échelle de fit() aligné sur la frontière du palier « mid » (0.34 était sous 0.42)",
    'zoomTierSmall=small;const threshold=small?.72:.34;',
    'zoomTierSmall=small;const threshold=small?.72:.42;'),

  P('heritage-pays-garde',
    "inheritedCountry : jeu des personnes déjà vues (récursion infinie entre deux conjoints sans lieu)",
    ["function inheritedCountry(person,depth){",
     "    if(!person||depth<0)return '';"].join('\n'),
    ["function inheritedCountry(person,depth,seen){",
     "    if(!person||depth<0)return '';",
     "    if(!seen)seen=new Set();",
     "    if(seen.has(person.id))return '';",
     "    seen.add(person.id);"].join('\n')),

  P('heritage-pays-parents',
    "inheritedCountry : propagation du jeu aux parents",
    'inheritedCountry(people.get(parentId),depth-1)',
    'inheritedCountry(people.get(parentId),depth-1,seen)'),

  P('heritage-pays-conjoint',
    "inheritedCountry : propagation du jeu au conjoint (ligne fautive d'origine)",
    'inheritedCountry(people.get(partnerId),0)',
    'inheritedCountry(people.get(partnerId),0,seen)'),

  P('pays-memoise',
    "countryOf mémoïsé : la fonction est pure sur des données figées et était recalculée à chaque rendu",
    ["function countryOf(person){",
     "    for(const place of placesOf(person)){"].join('\n'),
    ["const countryCache=new Map();",
     "  function countryOf(person){",
     "    if(countryCache.has(person.id))return countryCache.get(person.id);",
     "    const value=countryOfUncached(person);",
     "    countryCache.set(person.id,value);",
     "    return value;",
     "  }",
     "  function countryOfUncached(person){",
     "    for(const place of placesOf(person)){"].join('\n')),

  P('rendu-non-silencieux',
    "render() encapsulé : un échec de rendu laissait l'écran figé sans aucun message",
    'function render(preserve=false,anchorId=null){const activeAnchor=anchorId||state.focus;',
    ["function render(preserve=false,anchorId=null){",
     "    try{return renderInner(preserve,anchorId);}",
     "    catch(error){",
     "      console.error(\"Rendu de l'arbre impossible :\",error);",
     "      try{toast(\"Affichage impossible pour cette vue. Reviens a la vue familiale.\");}catch(e){}",
     "      return false;",
     "    }",
     "  }",
     "  function renderInner(preserve=false,anchorId=null){const activeAnchor=anchorId||state.focus;"].join('\n')),

  P('mobile-partage',
    "Mobile : le bouton « Partager » était masqué par display:none!important, sans équivalent dans le menu",
    '.top>.brand,.top>.topactions{display:none!important;}',
    '.top>.brand{display:none!important;}'),

  P('mobile-direction',
    "Mobile : les commandes Ancêtres / Descendance / Vue familiale et le recentrage étaient supprimés",
    '.toolbar .spacer,#up,#down,#both,#center,#toggleDad,#toggleMom,#export{display:none!important;}',
    '.toolbar .spacer,#toggleDad,#toggleMom,#export{display:none!important;}'),

  P('modale-mermaid-semantique',
    "Modale Mermaid : role=dialog / aria-modal / titre associé",
    '<div id="modal" class="modal">',
    '<div id="modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="mermaidtitle">'),

  P('modale-mermaid-titre',
    "Modale Mermaid : identifiant du titre",
    '<b>Diagramme Mermaid · vertical</b>',
    '<b id="mermaidtitle">Diagramme Mermaid · vertical</b>'),

  P('annuaire-semantique',
    "Annuaire : role=dialog / aria-modal / titre associé",
    '<div id="directory" class="modal">',
    '<div id="directory" class="modal" role="dialog" aria-modal="true" aria-labelledby="directorytitle">'),

  P('annuaire-titre',
    "Annuaire : identifiant du titre",
    '<b>Toutes les fiches de famille</b>',
    '<b id="directorytitle">Toutes les fiches de famille</b>'),

  P('carte-focus',
    "Cartes : la valeur en ligne sur <rect> écrasait l'indicateur de focus clavier",
    'rx="15" ry="15" style="fill:${fill};stroke:${stroke};stroke-width:${core?.has(id)?2.6:id===D.rootId?2.4:1.3}"',
    'rx="15" ry="15" class="card-face" style="--fill:${fill};--stroke:${stroke};--sw:${core?.has(id)?2.6:id===D.rootId?2.4:1.3}"'),

  P('favicon-lien',
    "Déclarer le favicon servi par le serveur (le navigateur redemandait /favicon.ico à chaque chargement)",
    '<meta name="theme-color" content="#173c35">',
    '<meta name="theme-color" content="#173c35">\n<link rel="icon" href="/favicon.svg" type="image/svg+xml">'),

  P('feuille-correctifs',
    "Feuille de correctifs : focus des cartes, anneau du champ de recherche, contrastes AA, mouvements réduits",
    ["  .canvas{height:calc(100dvh - 250px)}",
     "}",
     "",
     "</style>"].join('\n'),
    ["  .canvas{height:calc(100dvh - 250px)}",
     "}",
     "",
     CSS_FIXES(),
     "</style>"].join('\n')),

  P('rechargement-et-accessibilite',
    "Rechargement conditionnel (il vidait zoom, recherche et portée toutes les 10 min) + gestion du focus des modales et après re-rendu",
    "setInterval(()=>{if(document.visibilityState==='visible')location.reload();},600000);",
    SCRIPT_FIXES())
];

function CSS_FIXES(){
  return [
    "",
    "/* ===== correctifs d'audit — a reporter dans la source privee de l'application ===== */",
    "",
    "/* 1) Indicateur de focus des cartes. La couleur etait ecrite en attribut style",
    "      sur <rect>, ce qui ecrasait .person:focus rect : aucune carte n'affichait",
    "      de focus visible (WCAG 2.4.7). Les valeurs passent par des proprietes CSS. */",
    ".person rect{fill:var(--fill,#fffdf8);stroke:var(--stroke,var(--card-line));stroke-width:var(--sw,1.3)}",
    ".person:focus rect,.person:focus-visible rect{stroke:#173c35!important;stroke-width:3.2px!important}",
    "",
    "/* 2) Anneau de focus du champ de recherche : outline:none sans remplacement. */",
    ".search input:focus,.search input:focus-visible{outline:2px solid #275447;outline-offset:2px}",
    "",
    "/* 3) Contrastes WCAG AA : ces gris secondaires mesuraient de 2,96 a 4,29. */",
    ".section-label,.count,.note,.legend,.metric,.brand small,.context-note,.source-note,.heading p{color:#5c6a63}",
    "",
    "/* 4) Reglage systeme « mouvement reduit » : les transitions CSS restantes. */",
    "@media (prefers-reduced-motion: reduce){",
    "  .toast,.panel,.btn,.nav button,.modal,.dialog{transition:none!important;animation:none!important}",
    "}",
    ""
  ].join('\n');
}

function SCRIPT_FIXES(){
  return [
    "/* Remplace le rechargement inconditionnel : un onglet laisse ouvert ne perdait",
    "   plus son zoom, son deplacement, sa recherche et sa portee toutes les dix",
    "   minutes. Un onglet reellement inactif se rafraichit toujours. */",
    "(function(){",
    "  var IDLE=5*60*1000,last=Date.now();",
    "  ['pointerdown','keydown','wheel','touchstart'].forEach(function(e){addEventListener(e,function(){last=Date.now();},{passive:true,capture:true});});",
    "  function occupe(){",
    "    if(document.querySelector('input:focus,textarea:focus,select:focus'))return true;",
    "    return !!document.querySelector('.modal.open,.panel.open');",
    "  }",
    "  setInterval(function(){",
    "    if(document.visibilityState!=='visible')return;",
    "    if(Date.now()-last<IDLE)return;",
    "    if(occupe())return;",
    "    location.reload();",
    "  },60000);",
    "})();",
    "",
    "/* Accessibilite : les modales n'avaient ni piege de focus ni arriere-plan inerte,",
    "   et un re-rendu de l'arbre renvoyait le focus sur BODY (il fallait re-parcourir",
    "   toute la page au clavier).",
    "   L'application construit son interface de facon asynchrone : les elements sont",
    "   donc surveilles a l'apparition plutot que supposes presents au chargement. */",
    "(function(){",
    "  var FOND={modal:['header.top','#layout','#panel'],directory:['header.top','#layout','#panel'],editmodal:['#app']};",
    "  var piege=null,precedent=null,declencheur=null,dernierFocus=null;",
    "  function focusables(racine){",
    "    return [].slice.call(racine.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex=\"-1\"])'))",
    "      .filter(function(e){return e.offsetWidth>0||e.offsetHeight>0;});",
    "  }",
    "  function fond(id,inerte){",
    "    (FOND[id]||[]).forEach(function(sel){",
    "      var e=document.querySelector(sel);if(!e)return;",
    "      try{if(inerte)e.setAttribute('inert','');else e.removeAttribute('inert');}catch(err){}",
    "    });",
    "  }",
    "  function ouvrir(id){",
    "    var m=document.getElementById(id);if(!m||piege)return;",
    "    piege=m;",
    "    precedent=(document.activeElement&&document.activeElement!==document.body)?document.activeElement:declencheur;",
    "    var d=m.querySelector('.dialog')||m;",
    "    if(!d.getAttribute('tabindex'))d.setAttribute('tabindex','-1');",
    "    fond(id,true);",
    "    requestAnimationFrame(function(){var l=focusables(d);(l[0]||d).focus();});",
    "  }",
    "  function fermer(){",
    "    if(!piege)return;",
    "    fond(piege.id,false);",
    "    piege=null;",
    "    if(precedent&&document.contains(precedent)){try{precedent.focus();}catch(err){}}",
    "    precedent=null;",
    "  }",
    "  document.addEventListener('click',function(e){",
    "    var t=e.target&&e.target.closest?e.target.closest('button,a'):null;",
    "    if(t)declencheur=t;",
    "  },true);",
    "  document.addEventListener('keydown',function(e){",
    "    if(!piege)return;",
    "    if(e.key==='Escape'){",
    "      var b=piege.querySelector('.close');",
    "      if(b)b.click();else piege.classList.remove('open');",
    "      return;",
    "    }",
    "    if(e.key!=='Tab')return;",
    "    var l=focusables(piege.querySelector('.dialog')||piege);",
    "    if(!l.length)return;",
    "    var premier=l[0],dernier=l[l.length-1];",
    "    if(e.shiftKey&&document.activeElement===premier){e.preventDefault();dernier.focus();}",
    "    else if(!e.shiftKey&&document.activeElement===dernier){e.preventDefault();premier.focus();}",
    "  },true);",
    "  document.addEventListener('focusin',function(e){",
    "    var t=e.target;if(!t||!t.getAttribute||!t.matches)return;",
    "    if(t.matches('#tree [data-person]'))dernierFocus='[data-person=\"'+t.getAttribute('data-person')+'\"]';",
    "    else if(t.matches('#tree [data-toggle]'))dernierFocus='[data-toggle=\"'+t.getAttribute('data-toggle')+'\"][data-direction=\"'+t.getAttribute('data-direction')+'\"]';",
    "  });",
    "  function attacher(){",
    "    ['modal','directory','editmodal'].forEach(function(id){",
    "      var m=document.getElementById(id);",
    "      if(!m||m.dataset.auditSuivi)return;",
    "      m.dataset.auditSuivi='1';",
    "      var etait=m.classList.contains('open');",
    "      if(etait)ouvrir(id);",
    "      new MutationObserver(function(){",
    "        var est=m.classList.contains('open');",
    "        if(est&&!etait)ouvrir(id);else if(!est&&etait)fermer();",
    "        etait=est;",
    "      }).observe(m,{attributes:true,attributeFilter:['class']});",
    "    });",
    "    var toile=document.getElementById('canvas');",
    "    if(toile&&!toile.dataset.auditSuivi){",
    "      toile.dataset.auditSuivi='1';",
    "      new MutationObserver(function(){",
    "        if(!dernierFocus)return;",
    "        if(document.activeElement&&document.activeElement!==document.body)return;",
    "        var sel=dernierFocus;",
    "        requestAnimationFrame(function(){var e=document.querySelector('#tree '+sel);if(e)try{e.focus();}catch(err){}});",
    "      }).observe(toile,{childList:true});",
    "    }",
    "  }",
    "  var prevu=false;",
    "  function planifier(){if(prevu)return;prevu=true;requestAnimationFrame(function(){prevu=false;attacher();});}",
    "  attacher();",
    "  new MutationObserver(planifier).observe(document.documentElement,{childList:true,subtree:true});",
    "})();"
  ].join('\n');
}

export function patchApp(html){
  const applied = [], skipped = [], missing = [], broken = [];
  let out = html;
  for (const patch of PATCHES) {
    // Certains correctifs remplacent un texte par une version qui le contient
    // (par exemple « ...,depth-1) » devient « ...,depth-1,seen) »). Se fier à la
    // presence du texte d'origine ne suffit donc pas : on considere le correctif
    // comme applique des que sa forme cible est presente.
    if (out.includes(patch.to)) {
      skipped.push(patch);
      continue;
    }
    const occurrences = out.split(patch.from).length - 1;
    if (occurrences !== 1) {
      missing.push({...patch, occurrences});
      continue;
    }
    out = out.replace(patch.from, patch.to);
    applied.push(patch);
  }
  // Controle final : chaque forme cible doit etre presente dans le resultat.
  for (const patch of PATCHES) if (!out.includes(patch.to)) broken.push(patch.id);
  return {html: out, applied, skipped, missing, broken};
}

export function report(result){
  const lines = [];
  for (const p of result.applied) lines.push('  applique   ' + p.id + ' — ' + p.but);
  for (const p of result.skipped) lines.push('  deja la    ' + p.id);
  for (const p of result.missing) lines.push('  INTROUVABLE ' + p.id + ' (occurrences=' + p.occurrences + ') — ' + p.but);
  for (const id of result.broken || []) lines.push('  NON VERIFIE ' + id);
  return lines.join('\n');
}

const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/patch-app.mjs');
if (invokedDirectly) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const checkOnly = process.argv.includes('--check');
  const allowPartial = process.argv.includes('--allow-partial');
  const input = args[0] || 'index.html';
  const output = args[1] || null;

  const result = patchApp(readFileSync(input, 'utf8'));
  console.log('Correctifs de l\'application — ' + input);
  console.log(report(result));
  console.log(result.applied.length + ' applique(s), ' + result.skipped.length + ' deja present(s), ' + result.missing.length + ' introuvable(s)');

  if (result.broken.length) {
    console.error('\nECHEC : correctif(s) non verifiable(s) apres application : ' + result.broken.join(', '));
    process.exit(1);
  }
  if (result.missing.length && !allowPartial) {
    console.error('\nECHEC : ' + result.missing.length + ' correctif(s) ne s\'appliquent plus.');
    console.error('Le HTML a change de forme. Reportez les correctifs dans la source privee,');
    console.error('puis mettez a jour les ancrages de scripts/patch-app.mjs.');
    process.exit(1);
  }
  if (checkOnly) process.exit(0);
  writeFileSync(output || input, result.html, 'utf8');
  console.log('Ecrit : ' + (output || input));
}
