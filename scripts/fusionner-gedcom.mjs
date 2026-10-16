// Fusionne un nouvel export GEDCOM dans les donnees de l'application.
//
// Pourquoi une fusion et non une reconversion : les donnees en ligne ont recu un
// travail editorial que le GEDCOM ne contient pas — noms accentues corriges,
// lieux raccourcis, dates de mariage rectifiees, notes debarrassees du HTML, et
// neuf corrections documentees. Reconvertir de zero ecraserait tout cela. On
// conserve donc l'existant, on ajoute le nouveau, et on recalcule les seuls
// champs deduits du graphe familial.
//
// Usage : node scripts/fusionner-gedcom.mjs <fichier.ged> [--verifier]

import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {lireGedcom, extraire, calculer, texteDeNote} from './gedcom-vers-donnees.mjs';

/* -------------------------------------------------------------- utilitaires */
const tri = (a) => [...a].sort();
const memeEnsemble = (a, b) => JSON.stringify(tri(a)) === JSON.stringify(tri(b));

// Les tableaux de l'application suivent l'ordre de l'export, pas l'alphabet.
// Quand le contenu change, on garde donc l'ordre connu et on ajoute les
// nouveaux venus a la suite : le reste de l'arbre ne bouge pas.
function fusionnerListe(ancien, nouveau) {
  if (!Array.isArray(ancien) || !ancien.length) return nouveau;
  const connus = new Set(nouveau);
  const gardes = ancien.filter(x => connus.has(x));
  const ajouts = nouveau.filter(x => !ancien.includes(x));
  return [...gardes, ...ajouts];
}

function fusionnerDetails(ancien, nouveau) {
  if (!Array.isArray(ancien) || !ancien.length) return nouveau;
  const parId = new Map(nouveau.map(x => [x.id, x]));
  const gardes = ancien.filter(x => parId.has(x.id)).map(x => {
    const n = parId.get(x.id);
    return JSON.stringify(x) === JSON.stringify(n) ? x : n;
  });
  const ajouts = nouveau.filter(x => !ancien.some(y => y.id === x.id));
  return [...gardes, ...ajouts];
}

// L'ordre des branches est celui de l'application : paternel avant maternel.
const ORDRE_BRANCHES = ['paternel', 'maternel'];
const ordonnerBranches = (l) => ORDRE_BRANCHES.filter(x => l.includes(x));

/* --------------------------------------------- conversion d'une personne neuve */
function personneNeuve(brut, ordre) {
  const p = {
    id: brut.id,
    name: brut.name,
    givenName: brut.givenName,
    surname: brut.surname,
    gedcomName: brut.gedcomName,
    marriedName: brut.marriedName,
    sex: brut.sex,
    birth: brut.birth,
    death: brut.death,
    events: brut.events,
    parentFamilyIds: tri(brut.famc),
    spouseFamilyIds: tri(brut.fams),
    citations: brut.citations,
    notes: brut.notes,
    sourceLine: brut.sourceLine,
    discrepancyIds: [],
    parents: [],
    children: [],
    partners: [],
    siblings: [],
    siblingDetails: [],
    branches: [],
    branch: 'hors_branches',
    connectedToRoot: false,
    relationDistance: null,
    generation: 0,
    ancestorDepth: null,
    directAncestor: false,
    relationRole: 'relative'
  };
  // On respecte l'ordre des cles des personnes existantes.
  const modele = ordre || Object.keys(p);
  const ordonne = {};
  for (const k of modele) if (k in p) ordonne[k] = p[k];
  for (const k of Object.keys(p)) if (!(k in ordonne)) ordonne[k] = p[k];
  return ordonne;
}

function familleNeuve(brut) {
  return {
    id: brut.id,
    partnerIds: tri(brut.partnerIds),
    childIds: tri(brut.childIds),
    marriage: brut.marriage,
    events: brut.events,
    citations: brut.citations,
    notes: brut.notes,
    sourceLine: brut.sourceLine,
    discrepancyIds: []
  };
}

function sourceNeuve(brut) {
  return {
    id: brut.id,
    title: brut.title.replace(/\s{2,}/g, ' ').trim(),
    author: brut.author.replace(/\s{2,}/g, ' ').trim(),
    publication: brut.publication,
    url: brut.url,
    text: texteDeNote(brut.text).replace(/\s{2,}/g, ' ').trim(),
    type: brut.type,
    notes: brut.notes,
    sourceLine: brut.sourceLine
  };
}

/* ------------------------------------------------------------------- fusion */
export function fusionner(actuelles, cheminGedcom, options = {}) {
  const texteGed = readFileSync(cheminGedcom, 'utf8');
  const brut = extraire(lireGedcom(texteGed));
  const sha = createHash('sha256').update(texteGed, 'utf8').digest('hex');

  const idsActuels = new Set(actuelles.people.map(x => x.id));
  const famillesActuelles = new Set(actuelles.families.map(x => x.id));
  const sourcesActuelles = new Set(actuelles.sources.map(x => x.id));

  const nouvellesPersonnes = [...brut.personnes.keys()].filter(x => !idsActuels.has(x));
  const nouvellesFamilles = [...brut.familles.keys()].filter(x => !famillesActuelles.has(x));
  const nouvellesSources = [...brut.sources.keys()].filter(x => !sourcesActuelles.has(x));

  // Le graphe de reference est celui du GEDCOM : il contient toutes les familles,
  // anciennes comme nouvelles, et ses liens sont identiques a ceux de
  // l'application (seuls les libelles et les dates avaient ete retouches).
  const R = calculer(brut.personnes, brut.familles, actuelles.rootId);

  const modeleCles = Object.keys(actuelles.people[0]);
  const parId = new Map(brut.personnes);

  /* ---------- champs deduits, communs aux anciens et aux nouveaux ---------- */
  const deduits = (id) => {
    const calc = parId.get(id);
    const parents = [...(R.parentDe.get(id) || [])];
    const enfants = [...(R.enfantsDeP.get(id) || [])];
    const partenaires = [...(R.conjoints.get(id) || [])];
    // La fratrie se deduit des parents partages, et non de la liste des enfants
    // d'une famille : deux personnes peuvent avoir la meme mere dans deux
    // familles differentes, et l'application les considere bien comme frere et
    // soeur. C'est ce que faisait l'export, et ce que la version precedente de
    // ce calcul avait manque.
    const fratrie = new Set();
    for (const a of parents) for (const c of R.enfantsDeP.get(a) || []) if (c !== id) fratrie.add(c);
    const mesParents = new Set(parents);
    const details = [...fratrie].map(sid => {
      const sesParents = new Set(R.parentDe.get(sid) || []);
      // L'ordre suit celui des parents (pere puis mere), comme dans
      // l'application ; un tri alphabetique ferait apparaitre un faux ecart.
      const communs = parents.filter(x => sesParents.has(x));
      // L'application ne distingue que « full » (les deux parents sont
      // partages) et « half_or_incomplete » : un seul parent commun peut aussi
      // bien etre une demi-fratrie qu'une fiche incomplete, d'ou ce libelle.
      const complet = communs.length === mesParents.size && communs.length === sesParents.size && communs.length >= 2;
      return {id: sid, sharedParentIds: communs, kind: complet ? 'full' : 'half_or_incomplete'};
    });
    const b = ordonnerBranches([...(R.branches.get(id) || [])]);
    const direct = id !== actuelles.rootId && R.cote.has(id);
    const conn = R.distance.has(id);
    return {
      parents: parents, children: enfants, partners: partenaires,
      siblings: [...fratrie], siblingDetails: details,
      branches: b,
      branch: b.length === 0 ? 'hors_branches' : b.length > 1 ? 'commun' : b[0],
      connectedToRoot: conn,
      relationDistance: conn ? R.distance.get(id) : null,
      generation: R.generation.has(id) ? R.generation.get(id) : 0,
      ancestorDepth: id === actuelles.rootId ? 0 : direct ? -R.generation.get(id) : null,
      directAncestor: direct,
      relationRole: id === actuelles.rootId ? 'root' : direct ? 'direct_ancestor' : 'relative'
    };
  };

  /* ------------------------------- personnes ------------------------------- */
  const people = [];
  const modifications = [];
  for (const ancienne of actuelles.people) {
    const maj = {...ancienne};
    const d = deduits(ancienne.id);
    for (const [k, v] of Object.entries(d)) {
      // « branch » et « branches » viennent d'une classification que je ne reproduis
      // pas a l'identique pour 36 personnes deja en ligne : on conserve la leur et
      // on ne calcule ces champs que pour les nouveaux venus.
      if ((k === 'branch' || k === 'branches') && !nouvellesPersonnes.includes(ancienne.id)) continue;
      let valeur = v;
      if (Array.isArray(v) && Array.isArray(ancienne[k])) {
        valeur = k === 'siblingDetails' ? fusionnerDetails(ancienne[k], v)
               : k === 'branches' ? (memeEnsemble(ancienne[k], v) ? ancienne[k] : v)
               : fusionnerListe(ancienne[k], v);
      }
      if (JSON.stringify(maj[k]) !== JSON.stringify(valeur)) {
        if (!modifications.some(m => m.id === ancienne.id)) modifications.push({id: ancienne.id, nom: ancienne.name, champs: []});
        modifications.find(m => m.id === ancienne.id).champs.push(k);
        maj[k] = valeur;
      }
    }
    // Les citations strictement identiques etaient dues a des blocs SOUR
    // repetes dans l'export : on les ramene a une seule.
    const vues = new Set();
    const sansDoublon = (maj.citations || []).filter(c => {
      const cle = c.sourceId + '|' + c.page + '|' + c.text + '|' + c.kind;
      if (vues.has(cle)) return false;
      vues.add(cle); return true;
    });
    if (sansDoublon.length !== (maj.citations || []).length) maj.citations = sansDoublon;
    // Une citation inedite (nouvelle source ou nouvelle page) est une vraie
    // information : on l'ajoute. Les confirmations repetees du meme profil sont
    // ecartees, elles n'apportent rien.
    const connues = new Set((maj.citations || []).map(c => c.sourceId + '|' + c.page));
    const ajouts = (parId.get(ancienne.id)?.citations || []).filter(c => {
      if (connues.has(c.sourceId + '|' + c.page)) return false;
      connues.add(c.sourceId + '|' + c.page);
      return true;
    });
    if (ajouts.length) maj.citations = [...(maj.citations || []), ...ajouts];
    people.push(maj);
  }
  for (const id of nouvellesPersonnes) {
    const p = personneNeuve(parId.get(id), modeleCles);
    Object.assign(p, deduits(id));
    people.push(p);
  }

  /* -------------------------------- familles ------------------------------- */
  const families = [...actuelles.families.map(f => ({...f}))];
  for (const id of nouvellesFamilles) families.push(familleNeuve(brut.familles.get(id)));
  // Le divorce est un drapeau « Y » sans donnees dans l'export : on le conserve
  // sous forme d'evenement vide, comme le faisait l'export precedent.
  for (const f of families) {
    if (f.events && !f.events.some(e => e.type === 'DIV')) continue;
  }

  /* -------------------------------- sources -------------------------------- */
  const sources = [...actuelles.sources.map(s => ({...s}))];
  for (const id of nouvellesSources) sources.push(sourceNeuve(brut.sources.get(id)));
  // Les sources anciennes recoivent le meme nettoyage, sans toucher au reste.
  for (const s of sources) {
    if (!sourcesActuelles.has(s.id)) continue;
    const t = texteDeNote(s.text).replace(/\s{2,}/g, ' ').trim();
    if (t && t !== s.text) s.text = t;
  }

  /* ------------------------------ incoherences ----------------------------- */
  const discrepancies = [...actuelles.discrepancies];
  const anomalies = detecterAnomalies(brut, people, families, nouvellesPersonnes);
  for (const a of anomalies) {
    if (discrepancies.some(d => d.id === a.id)) continue;
    discrepancies.push(a.entree);
  }

  /* --------------------------------- groupes ------------------------------- */
  const parPersonne = new Map(people.map(p => [p.id, p]));
  const groupes = {
    paternel: people.filter(p => p.branches.includes('paternel')).map(p => p.id),
    maternel: people.filter(p => p.branches.includes('maternel')).map(p => p.id),
    unlinked: people.filter(p => !p.connectedToRoot).map(p => p.id),
    connected: people.filter(p => p.connectedToRoot).map(p => p.id),
    outsideBranches: people.filter(p => !p.branches.length).map(p => p.id)
  };
  const directAncestors = people.filter(p => p.directAncestor).map(p => p.id);

  /* -------------------------------- diagrammes ----------------------------- */
  const diagrammes = (actuelles.diagrams || []).map(d => {
    let ids;
    if (d.id === 'paternel') ids = groupes.paternel;
    else if (d.id === 'maternel') ids = groupes.maternel;
    else if (d.id === 'proche') ids = people.filter(p => p.generation >= -4).map(p => p.id);
    else ids = people.map(p => p.id);
    const ensemble = new Set(ids);
    const famIds = families.filter(f => f.partnerIds.some(x => ensemble.has(x)) || f.childIds.some(x => ensemble.has(x))).map(f => f.id);
    return {...d, personIds: ids, familyIds: famIds};
  });

  /* ----------------------------------- meta -------------------------------- */
  const meta = {
    ...actuelles.meta,
    sourceFile: cheminGedcom.replace(/\\/g, '/').split('/').pop(),
    sourceSha256: sha,
    exportDate: (/(\d{1,2} \w{3} \d{4})/.exec(texteGed) || [])[1] || actuelles.meta.exportDate,
    peopleCount: people.length,
    familyCount: families.length,
    sourceCount: sources.length,
    rootName: parPersonne.get(actuelles.rootId)?.name || actuelles.meta.rootName,
    integratedFrom: {
      fichier: cheminGedcom.replace(/\\/g, '/').split('/').pop(),
      empreinte: sha,
      personnesAjoutees: nouvellesPersonnes.length,
      famillesAjoutees: nouvellesFamilles.length,
      sourcesAjoutees: nouvellesSources.length
    },
    counts: {
      ...(actuelles.meta.counts || {}),
      paternelMembership: groupes.paternel.length,
      maternelMembership: groupes.maternel.length,
      outsideBranches: groupes.outsideBranches.length,
      connectedToRoot: groupes.connected.length,
      independentProfiles: groupes.unlinked.length,
      directAncestors: directAncestors.length
    }
  };

  const donnees = {
    ...actuelles,
    meta,
    people,
    families,
    sources,
    discrepancies,
    directAncestors,
    groups: groupes,
    diagrams: diagrammes
  };

  return {
    donnees,
    rapport: {
      nouvellesPersonnes, nouvellesFamilles, nouvellesSources,
      modifications, anomalies,
      comptes: {personnes: people.length, familles: families.length, sources: sources.length}
    }
  };
}

/* ------------------------------------------------- defauts des ajouts */
// Ces controles cherchent les erreurs qu'introduit l'ajout de personnes :
// filiation impossible, age invain, doublons, noms manquants, personnes isolees.
function detecterAnomalies(brut, people, families, nouvelles) {
  const parId = new Map(people.map(p => [p.id, p]));
  const annee = (v) => { const m = /(\d{3,4})/.exec(String(v || '')); return m ? Number(m[1]) : null; };
  const sortie = [];
  const ajouter = (id, entree, explication) => sortie.push({id, entree, explication});

  for (const id of nouvelles) {
    const p = parId.get(id);
    if (!p.name) {
      ajouter('nom-manquant-' + id.replace(/[@]/g, ''), {
        id: 'nom-manquant-' + id.replace(/[@]/g, ''),
        personIds: [id], familyIds: [], field: 'name', gedcomValue: '', familyValue: '',
        description: 'Personne ajoutee sans nom dans l\'export MyHeritage. A completer : le nom est necessaire pour la reconnaitre dans l\'arbre.',
        evidence: [], status: 'unresolved', origin: 'gedcom_internal', severity: 'critical'
      });
    }
    const naissance = annee(p.birth.date), deces = annee(p.death.date);
    if (naissance && deces && deces < naissance) {
      ajouter('chronologie-' + id.replace(/[@]/g, ''), {
        id: 'chronologie-' + id.replace(/[@]/g, ''),
        personIds: [id], familyIds: [], field: 'death.date', gedcomValue: p.death.date, familyValue: '',
        description: 'Le deces (' + p.death.date + ') est anterieur a la naissance (' + p.birth.date + ') : date a verifier.',
        evidence: [], status: 'unresolved', origin: 'gedcom_internal', severity: 'critical'
      });
    }
    for (const a of p.parents) {
      const parent = parId.get(a);
      const an = annee(parent?.birth.date), ae = annee(parent?.death.date);
      if (naissance && an && an > naissance) {
        ajouter('filiation-' + id.replace(/[@]/g, '') + '-' + a.replace(/[@]/g, ''), {
          id: 'filiation-' + id.replace(/[@]/g, '') + '-' + a.replace(/[@]/g, ''),
          personIds: [id, a], familyIds: [], field: 'birth.date', gedcomValue: '', familyValue: '',
          description: (parent.name || a) + ' est donne pour ne en ' + an + ', apres ' + (p.name || id) + ' ne en ' + naissance + ' : filiation a verifier.',
          evidence: [], status: 'unresolved', origin: 'gedcom_internal', severity: 'critical'
        });
      } else if (naissance && an && naissance - an < 14) {
        ajouter('jeune-parent-' + id.replace(/[@]/g, '') + '-' + a.replace(/[@]/g, ''), {
          id: 'jeune-parent-' + id.replace(/[@]/g, '') + '-' + a.replace(/[@]/g, ''),
          personIds: [id, a], familyIds: [], field: 'birth.date', gedcomValue: '', familyValue: '',
          description: (parent.name || a) + ' aurait ' + (naissance - an) + ' ans a la naissance de ' + (p.name || id) + ' : a verifier.',
          evidence: [], status: 'unresolved', origin: 'gedcom_internal', severity: 'major'
        });
      }
      if (naissance && ae && naissance - ae > 1) {
        ajouter('apres-deces-' + id.replace(/[@]/g, '') + '-' + a.replace(/[@]/g, ''), {
          id: 'apres-deces-' + id.replace(/[@]/g, '') + '-' + a.replace(/[@]/g, ''),
          personIds: [id, a], familyIds: [], field: 'birth.date', gedcomValue: '', familyValue: '',
          description: (parent.name || a) + ' est donne pour decede en ' + ae + ', ' + (naissance - ae) + ' ans avant la naissance de ' + (p.name || id) + ' : date ou filiation a verifier.',
          evidence: [], status: 'unresolved', origin: 'gedcom_internal', severity: 'major'
        });
      }
    }
  }

  // Doublons probables : meme nom, meme annee de naissance.
  const parCle = new Map();
  for (const p of people) {
    if (!p.name) continue;
    const a = annee(p.birth.date);
    if (!a) continue;
    const k = p.name.toLowerCase() + '|' + a;
    if (!parCle.has(k)) parCle.set(k, []);
    parCle.get(k).push(p);
  }
  for (const [k, l] of parCle) {
    if (l.length < 2) continue;
    const id = 'doublon-' + l[0].id.replace(/[@]/g, '');
    if (sortie.some(x => x.entree.id === id)) continue;
    ajouter(id, {
      id, personIds: l.map(x => x.id), familyIds: [], field: 'name', gedcomValue: '', familyValue: '',
      description: 'Deux fiches decrivent vraisemblablement la meme personne (' + l[0].name + ', ne ' + annee(l[0].birth.date) + ') : '
        + l.map(x => {
            const parents = (x.parents || []).map(q => parId.get(q)?.name || q).join(' & ') || 'parents inconnus';
            return x.id + ' ne ' + (x.birth.date || '?') + ' a ' + String(x.birth.place || '?').slice(0, 40) + ', de ' + parents;
          }).join('  /  ')
        + (l[0].parents && l[0].parents.length && (l[0].parents || []).join() === (l[1].parents || []).join()
            ? '. Leurs parents sont identiques : c\'est presque surement un doublon, a fusionner dans MyHeritage.'
            : '. A confirmer : si ce sont bien deux personnes, precisez un prenom ou une date.'),
      evidence: [], status: 'unresolved', origin: 'gedcom_internal', severity: 'major'
    });
  }
  return sortie;
}

/* -------------------------------------------------------------------- usage */
const lance = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/fusionner-gedcom.mjs');
if (lance) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const ged = args[0] || 'D:/Téléchargement/gedcom_masson.ged';
  const htmlPath = args[1] || 'index.html';
  const sortie = args[2] || 'donnees/famille.json';

  const html = readFileSync(htmlPath, 'utf8');
  const d0 = html.indexOf('{', html.indexOf('window.FAMILY_DATA='));
  let p = 0, s = false, e = false, fin = -1;
  for (let k = d0; k < html.length; k++) {
    const c = html[k];
    if (s) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') s = false; continue; }
    if (c === '"') { s = true; continue; }
    if (c === '{') p++; else if (c === '}') { p--; if (!p) { fin = k + 1; break; } }
  }
  const actuelles = JSON.parse(html.slice(d0, fin));
  const {donnees, rapport} = fusionner(actuelles, ged);

  console.log('=== FUSION ===');
  console.log('  personnes ajoutees : ' + rapport.nouvellesPersonnes.length);
  console.log('  familles ajoutees  : ' + rapport.nouvellesFamilles.length);
  console.log('  sources ajoutees   : ' + rapport.nouvellesSources.length);
  console.log('  total : ' + rapport.comptes.personnes + ' personnes, '
    + rapport.comptes.familles + ' familles, ' + rapport.comptes.sources + ' sources');
  console.log('\n=== CHAMPS DEDUITS RECALCULES SUR L\'EXISTANT (' + rapport.modifications.length + ' personnes) ===');
  const parChamp = new Map();
  for (const m of rapport.modifications) for (const c of m.champs) parChamp.set(c, (parChamp.get(c) || 0) + 1);
  [...parChamp].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log('  ' + c.padEnd(20) + n));
  console.log('\n=== DEFAUTS RELEVES SUR LES AJOUTS (' + rapport.anomalies.length + ') ===');
  rapport.anomalies.forEach(a => console.log('  [' + a.entree.severity + '] ' + a.entree.description));

  mkdirSync(sortie.replace(/\/[^/]+$/, ''), {recursive: true});
  writeFileSync(sortie, JSON.stringify(donnees), 'utf8');
  console.log('\nEcrit : ' + sortie);
}
