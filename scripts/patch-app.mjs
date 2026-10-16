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
    "Plancher d'échelle de fit() porté à 0,75 : une branche s'ouvre désormais à une échelle lisible (dates comprises), centrée sur la personne de départ, au lieu d'être écrasée jusqu'à 0,42 où plus rien n'était lisible. Mesuré : branche paternelle 0,496 -> 0,75, dates 0/21 -> 21/21. La vue par défaut est inchangée (0,7503)",
    'zoomTierSmall=small;const threshold=small?.72:.34;',
    'zoomTierSmall=small;const threshold=small?.72:.75;'),

  P('espacement-generations',
    "Espacement entre générations réduit de 350 à 200 : 108 unités de vide étaient perdues par rang alors que les cartes n'en font que 242, ce qui forçait une échelle inutilement petite. Routage des liens vérifié visuellement",
    'nodesep:52,ranksep:350',
    'nodesep:52,ranksep:200'),

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

  P('recherche-troncature',
    "La recherche s'arrêtait à 25 résultats sans le dire : le nombre total est désormais annoncé",
    'box.innerHTML=found.slice(0,25).map(p=>',
    "box.innerHTML=(found.length>25?'<p class=\"note\">'+found.length+' résultats, les 25 premiers sont affichés — précise ta recherche.</p>':'')+found.slice(0,25).map(p=>"),

  P('effacement-client',
    "Une correction ne pouvait jamais vider un champ : le client transmet maintenant un effacement explicite (null), distinct d'un champ non touché",
    'for(const key in after)if(after[key]&&after[key]!==before[key]){payload[key]=after[key];changed++;}',
    "for(const key in after)if(after[key]!==before[key]){payload[key]=after[key]===''?null:after[key];changed++;}"),

  P('effacement-naissance',
    "applyContributions : un effacement explicite de la date de naissance est appliqué (null), les anciens ajouts à chaîne vide restent ignorés",
    'if(it.birthDate){target.birth.date=gedDate(it.birthDate);target.birth.known=true;}',
    "if(it.birthDate===null){target.birth.date='';target.birth.known=false;}else if(it.birthDate){target.birth.date=gedDate(it.birthDate);target.birth.known=true;}"),

  P('effacement-lieu-naissance',
    "applyContributions : effacement explicite du lieu de naissance",
    'if(it.birthPlace)target.birth.place=it.birthPlace;',
    "if(it.birthPlace===null)target.birth.place='';else if(it.birthPlace)target.birth.place=it.birthPlace;"),

  P('effacement-deces',
    "applyContributions : effacement explicite de la date de décès",
    'if(it.deathDate){target.death.date=gedDate(it.deathDate);target.death.known=true;}',
    "if(it.deathDate===null){target.death.date='';target.death.known=false;}else if(it.deathDate){target.death.date=gedDate(it.deathDate);target.death.known=true;}"),

  P('effacement-lieu-deces',
    "applyContributions : effacement explicite du lieu de décès",
    'if(it.deathPlace)target.death.place=it.deathPlace;',
    "if(it.deathPlace===null)target.death.place='';else if(it.deathPlace)target.death.place=it.deathPlace;"),

  P('effacement-prenom',
    "applyContributions : effacement explicite du prénom",
    'if(it.given)target.givenName=it.given;',
    "if(it.given===null)target.givenName='';else if(it.given)target.givenName=it.given;"),

  P('effacement-nom',
    "applyContributions : effacement explicite du nom de famille",
    'if(it.surname)target.surname=it.surname;',
    "if(it.surname===null)target.surname='';else if(it.surname)target.surname=it.surname;"),

  P('effacement-recalcul-nom',
    "applyContributions : le nom affiché est recalculé dès qu'un effacement touche le prénom ou le nom",
    'if(it.given||it.surname)target.name=',
    'if(it.given!==undefined||it.surname!==undefined)target.name='),

  P('arbre-groupe-accessible',
    "Le groupe SVG de l'arbre est nommé : les 400 cartes n'étaient qu'une liste de boutons sans contexte pour un lecteur d'écran",
    '<g id="viewport">',
    "<g id=\"viewport\" role=\"group\" aria-label=\"Personnes de l'arbre familial\">"),

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
    "/* 4) Sur telephone, le titre, le compteur, la legende (qui porte aussi la",
    "      case « Afficher les fratries ») et le recentrage etaient supprimes par",
    "      des feuilles de style successives : l'utilisateur ne savait plus quelle",
    "      branche il regardait, ni ce que signifiaient les couleurs. */",
    "@media(max-width:850px){",
    "  .heading{display:flex!important;align-items:baseline;gap:8px;margin:0 2px 5px;padding:0;min-width:0}",
    "  .heading h1{font-size:15px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    "  .heading p{font-size:11px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    "  .legend{display:flex!important;flex-wrap:wrap;gap:2px 10px;font-size:10px;margin:3px 2px 0;line-height:1.3}",
    "  .legend label{margin-left:auto;display:inline-flex!important;align-items:center;gap:4px}",
    "  #center{display:inline-flex!important;align-items:center}",
    "}",
    "",
    "/* 5) Lien d'evitement : 23 tabulations etaient necessaires avant la premiere",
    "      carte de l'arbre. */",
    ".lien-evitement{position:absolute;left:-9999px;top:0;z-index:99;background:#275447;color:#fff;padding:9px 14px;border-radius:0 0 10px 0;font:600 13px system-ui,sans-serif}",
    ".lien-evitement:focus{left:0;outline:2px solid #173c35;outline-offset:2px}",
    "",
    "/* 6) Reglage systeme « mouvement reduit » : les transitions CSS restantes. */",
    "@media (prefers-reduced-motion: reduce){",
    "  .toast,.panel,.btn,.nav button,.modal,.dialog{transition:none!important;animation:none!important}",
    "}",
    ""
  ].join('\n');
}

function SCRIPT_FIXES(){
  const L = [
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
    "/* Accessibilite, compteurs et hors ligne.",
    "   L'application construit son interface de facon asynchrone : chaque",
    "   amelioration est posee des que son element apparait. Une tache qui rend",
    "   false signale que sa precondition n'est pas encore remplie : elle sera",
    "   retentee au lieu d'etre abandonnee. */",
    "(function(){",
    "  var fait={};",
    "  function quand(cle,id,fn){",
    "    if(fait[cle])return;",
    "    var e=document.getElementById(id);",
    "    if(!e)return;",
    "    var r;",
    "    try{r=fn(e);}catch(err){console.error('amelioration '+cle,err);return;}",
    "    if(r===false)return;",
    "    fait[cle]=1;",
    "  }",
    "",
    "  /* --- modales : arriere-plan inerte, focus piege puis rendu --- */",
    "  var FOND={modal:['header.top','#layout','#panel'],directory:['header.top','#layout','#panel'],editmodal:['#app']};",
    "  var piege=null,precedent=null,declencheur=null;",
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
    "    if(e.key==='Escape'){var b=piege.querySelector('.close');if(b)b.click();else piege.classList.remove('open');return;}",
    "    if(e.key!=='Tab')return;",
    "    var l=focusables(piege.querySelector('.dialog')||piege);",
    "    if(!l.length)return;",
    "    var premier=l[0],dernier=l[l.length-1];",
    "    if(e.shiftKey&&document.activeElement===premier){e.preventDefault();dernier.focus();}",
    "    else if(!e.shiftKey&&document.activeElement===dernier){e.preventDefault();premier.focus();}",
    "  },true);",
    "  function suivreModale(id){",
    "    quand('modale-'+id,id,function(m){",
    "      var etait=m.classList.contains('open');",
    "      if(etait)ouvrir(id);",
    "      new MutationObserver(function(){",
    "        var est=m.classList.contains('open');",
    "        if(est&&!etait)ouvrir(id);else if(!est&&etait)fermer();",
    "        etait=est;",
    "      }).observe(m,{attributes:true,attributeFilter:['class']});",
    "    });",
    "  }",
    "",
    "  /* --- editeur : parente et sexe n'exposaient pas leur etat choisi --- */",
    "  var GROUPES=[['radio-rel','relchoice','Lien de parente'],['radio-sex','sexchoice','Sexe']];",
    "  function groupe(cle,id,libelle){",
    "    return function(){",
    "      quand(cle,id,function(g){",
    "        g.setAttribute('role','radiogroup');",
    "        g.setAttribute('aria-label',libelle);",
    "        var maj=function(){",
    "          g.querySelectorAll('button').forEach(function(b){",
    "            b.setAttribute('role','radio');",
    "            b.setAttribute('aria-checked',b.classList.contains('on')?'true':'false');",
    "          });",
    "        };",
    "        maj();",
    "        new MutationObserver(maj).observe(g,{attributes:true,subtree:true,attributeFilter:['class']});",
    "      });",
    "    };",
    "  }",
    "  /* Le formulaire est reconstruit a chaque ouverture : on rearme les taches. */",
    "  function suivreEditeur(){",
    "    quand('editeur','editmodal',function(m){",
    "      var body=m.querySelector('#editbody');",
    "      if(!body)return false;",
    "      if(body.dataset.auditEditeur)return;",
    "      body.dataset.auditEditeur='1';",
    "      new MutationObserver(function(){",
    "        fait['radio-rel']=0;fait['radio-sex']=0;",
    "        planifier();",
    "      }).observe(body,{childList:true});",
    "    });",
    "  }",
    "",
    "  /* --- le focus etait perdu (BODY) a chaque re-rendu de l'arbre --- */",
    "  var dernierFocus=null;",
    "  document.addEventListener('focusin',function(e){",
    "    var t=e.target;if(!t||!t.getAttribute||!t.matches)return;",
    "    if(t.matches('#tree [data-person]'))dernierFocus='[data-person=\"'+t.getAttribute('data-person')+'\"]';",
    "    else if(t.matches('#tree [data-toggle]'))dernierFocus='[data-toggle=\"'+t.getAttribute('data-toggle')+'\"][data-direction=\"'+t.getAttribute('data-direction')+'\"]';",
    "  });",
    "  function focusApresRendu(){",
    "    quand('focus-arbre','canvas',function(toile){",
    "      new MutationObserver(function(){",
    "        if(!dernierFocus)return;",
    "        if(document.activeElement&&document.activeElement!==document.body)return;",
    "        var sel=dernierFocus;",
    "        requestAnimationFrame(function(){var e=document.querySelector('#tree '+sel);if(e)try{e.focus();}catch(err){}});",
    "      }).observe(toile,{childList:true});",
    "    });",
    "  }",
    "",
    "  /* --- compteurs : la colonne annoncait la taille de la branche entiere",
    "        (354) alors que la vue n'en montrait que dix --- */",
    "  function compteurs(){",
    "    quand('compteurs','subtitle',function(sub){",
    "      var maj=function(){",
    "        var m=/([0-9][0-9 ]*)\\s+personnes/.exec(sub.textContent||'');",
    "        if(!m)return;",
    "        var n=m[1].replace(/\\s/g,'');",
    "        document.querySelectorAll('[data-scope]').forEach(function(b){",
    "          var span=b.querySelector('.count');if(!span)return;",
    "          if(b.dataset.origine===undefined)b.dataset.origine=span.textContent;",
    "          var actif=b.classList.contains('active');",
    "          var cible=actif?n:b.dataset.origine;",
    "          if(span.textContent!==cible)span.textContent=cible;",
    "          var titre=actif?'Personnes actuellement affichees':'Personnes rattachees a cette branche';",
    "          if(b.title!==titre)b.title=titre;",
    "        });",
    "      };",
    "      new MutationObserver(maj).observe(sub,{childList:true,characterData:true,subtree:true});",
    "      maj();",
    "    });",
    "  }",
    "",
    "  /* --- lien d'evitement : 23 tabulations avant la premiere carte --- */",
    "  function lienEvitement(){",
    "    quand('evitement','app',function(app){",
    "      var shell=app.querySelector('.shell');",
    "      if(!shell)return false;",
    "      if(document.getElementById('lien-arbre'))return;",
    "      var a=document.createElement('a');",
    "      a.id='lien-arbre';a.className='lien-evitement';a.href='#canvas';",
    "      a.textContent=\"Aller a l'arbre\";",
    "      a.addEventListener('click',function(ev){",
    "        ev.preventDefault();",
    "        var c=document.getElementById('canvas');",
    "        if(c){c.setAttribute('tabindex','-1');c.focus();}",
    "      });",
    "      shell.insertBefore(a,shell.firstChild);",
    "    });",
    "  }",
    "",
    "  /* --- hors ligne : sans service worker, une coupure reseau suivie d'un",
    "        rechargement donnait une page blanche --- */",
    "  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(function(){});",
    "",
    "  var TACHES=[",
    "    function(){['modal','directory','editmodal'].forEach(suivreModale);},",
    "    function(){GROUPES.forEach(function(g){groupe(g[0],g[1],g[2])();});},",
    "    suivreEditeur,",
    "    focusApresRendu,",
    "    compteurs,",
    "    lienEvitement",
    "  ];",
    "  var prevu=false;",
    "  function planifier(){if(prevu)return;prevu=true;requestAnimationFrame(function(){prevu=false;passer();});}",
    "  function passer(){TACHES.forEach(function(t){t();});}",
    "  passer();",
    "  new MutationObserver(planifier).observe(document.documentElement,{childList:true,subtree:true});",
    "})();"
  ];
  return L.join('\n');
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
