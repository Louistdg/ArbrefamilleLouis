// Convertit un export GEDCOM MyHeritage vers la structure window.FAMILY_DATA.
//
// Les regles reproduites ici ont ete deduites de l'observation de l'export
// precedent : types d'evenements conserves, sens du drapeau « connu », mise en
// forme des citations, et champs calcules (branches, generations, lien a la
// racine). Le mode --verifier recalcule tout et compare aux donnees deja en
// ligne : c'est la preuve que les regles sont justes avant d'ajouter quiconque.
//
// Usage :
//   node scripts/gedcom-vers-donnees.mjs <fichier.ged> --verifier
//   node scripts/gedcom-vers-donnees.mjs <fichier.ged> <sortie.json>

import {readFileSync, writeFileSync} from 'node:fs';

/* ------------------------------------------------------------------ lecture */

export function lireGedcom(texte) {
  const source = texte.replace(/^\uFEFF/, '').split(/\r?\n/);
  const racine = {enfants: []};
  const pile = [racine];
  source.forEach((brut, index) => {
    const m = /^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/.exec(brut);
    if (!m) return;
    const [, niveau, xref, tag, valeur] = m;
    const n = Number(niveau);
    const noeud = {niveau: n, tag, xref: xref || null, valeur: (valeur || '').trim(), enfants: [], ligne: index + 1};
    // CONC colle la suite du texte, CONT ajoute un retour a la ligne.
    const parent = pile[Math.max(0, n - 1)];
    if ((tag === 'CONC' || tag === 'CONT') && parent) {
      parent.valeur += (tag === 'CONT' ? '\n' : '') + noeud.valeur;
      return;
    }
    pile[n] = noeud;
    pile.length = n + 1;
    (pile[n - 1] || racine).enfants.push(noeud);
  });
  return racine.enfants;
}

const enfantsDe = (noeud, tag) => noeud.enfants.filter(x => x.tag === tag);
const premier = (noeud, tag) => noeud.enfants.find(x => x.tag === tag) || null;
const valeurDe = (noeud, tag) => { const x = premier(noeud, tag); return x ? x.valeur : ''; };
const deroule = (v) => String(v || '').replace(/@@/g, '@').trim();

// Les notes de l'export sont en HTML : l'application n'affiche que le texte.
// Les balises de paragraphe deviennent des retours a la ligne, les liens leur
// adresse, et les entites HTML sont decodees.
export function texteDeNote(brut) {
  return String(brut || '')
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/gi, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------- types d'evenements gardes */

// Types conserves dans l'application. CENS, RESI et OBJE ne le sont pas : les
// adresses et courriels d'un RESI ne doivent pas se retrouver sur une page
// publique, et l'export precedent les avait deja ecartes.
const EVENEMENTS_PERSONNE = new Set(['BIRT', 'DEAT', 'CHR', 'BAPM', 'BURI', 'OCCU', 'NATI', 'RELI', 'EVEN', 'CHR']);
const EVENEMENTS_FAMILLE = new Set(['MARR', 'DIV', 'EVEN']);

function evenement(n, type) {
  const description = valeurDe(n, 'TYPE');
  const notes = enfantsDe(n, 'NOTE').map(x => deroule(x.valeur));
  const citations = citationsDe(n);
  return {
    type,
    value: deroule(description || (n.valeur && n.valeur !== 'Y' ? n.valeur : '')),
    date: valeurDe(n, 'DATE'),
    place: deroule(valeurDe(n, 'PLAC')),
    description: deroule(description),
    notes,
    citations,
    sourceLine: n.ligne
  };
}

function citationsDe(noeud) {
  return enfantsDe(noeud, 'SOUR').map(s => {
    const donnees = premier(s, 'DATA');
    const even = premier(s, 'EVEN');
    return {
      sourceId: s.valeur,
      page: deroule(valeurDe(s, 'PAGE')),
      quality: deroule(valeurDe(s, 'QUAY')),
      text: donnees ? deroule(valeurDe(donnees, 'TEXT')) : deroule(valeurDe(s, 'TEXT')),
      date: donnees ? valeurDe(donnees, 'DATE') : '',
      kind: even ? deroule(even.valeur) : deroule(valeurDe(s, 'TYPE')),
      sourceLine: s.ligne
    };
  });
}

/* ---------------------------------------------------------------- personnes */

export function extraire(racine) {
  const personnes = new Map(), familles = new Map(), sources = new Map();

  for (const r of racine) {
    if (r.tag === 'INDI') {
      const nom = premier(r, 'NAME');
      const brut = nom ? nom.valeur : '';
      // « Prenoms /Nom/ » puis eventuellement « /Nom marie/ » apres le second
      // slash. Les prenoms et le nom viennent de la ligne NAME, accents
      // compris : les sous-champs GIVN/SURN de MyHeritage sont sans accents.
      const morceaux = brut.split('/');
      const given = (morceaux[0] || '').trim();
      const surnom = (morceaux[1] || '').trim();
      const marie = morceaux.length > 3 ? (morceaux[2] || '').trim() : '';
      const marnm = nom ? deroule(valeurDe(nom, '_MARNM')) : '';
      const evenements = [];
      for (const n of r.enfants) {
        if (!EVENEMENTS_PERSONNE.has(n.tag)) continue;
        const e = evenement(n, n.tag);
        // Un evenement sans date, sans lieu et sans description n'apporte rien.
        if (!e.date && !e.place && !e.description && !e.value && !e.notes.length && !e.citations.length) continue;
        evenements.push(e);
      }
      const birt = premier(r, 'BIRT'), deat = premier(r, 'DEAT');
      personnes.set(r.xref, {
        id: r.xref,
        givenName: deroule(given),
        surname: deroule(surnom),
        // Un nom vide recoit le libelle de remplacement deja utilise par
        // l'application, plutot que de rester une case muette dans l'arbre.
        name: brut.replace(/\//g, ' ').replace(/\s+/g, ' ').trim() || 'Pr\u00e9nom et nom inconnus',
        gedcomName: deroule(brut),
        marriedName: marnm || deroule(marie),
        sex: deroule(valeurDe(r, 'SEX')) || '',
        birth: birt ? {date: valeurDe(birt, 'DATE'), place: deroule(valeurDe(birt, 'PLAC')), known: true, sourceLine: birt.ligne}
                    : {date: '', place: '', known: false, sourceLine: null},
        death: deat ? {date: valeurDe(deat, 'DATE'), place: deroule(valeurDe(deat, 'PLAC')), known: true, sourceLine: deat.ligne}
                    : {date: '', place: '', known: false, sourceLine: null},
        events: evenements,
        citations: citationsDe(r),
        notes: enfantsDe(r, 'NOTE').map(x => texteDeNote(x.valeur)).filter(Boolean),
        sourceLine: r.ligne,
        famc: enfantsDe(r, 'FAMC').map(x => x.valeur),
        fams: enfantsDe(r, 'FAMS').map(x => x.valeur)
      });
    } else if (r.tag === 'FAM') {
      const evenements = [];
      for (const n of r.enfants) {
        if (!EVENEMENTS_FAMILLE.has(n.tag)) continue;
        const e = evenement(n, n.tag);
        if (!e.date && !e.place && !e.description && !e.value && !e.notes.length && !e.citations.length) continue;
        evenements.push(e);
      }
      const marr = premier(r, 'MARR');
      familles.set(r.xref, {
        id: r.xref,
        partnerIds: [...enfantsDe(r, 'HUSB').map(x => x.valeur), ...enfantsDe(r, 'WIFE').map(x => x.valeur)],
        childIds: enfantsDe(r, 'CHIL').map(x => x.valeur),
        marriage: marr ? {date: valeurDe(marr, 'DATE'), place: deroule(valeurDe(marr, 'PLAC')), exists: true, sourceLine: marr.ligne}
                       : {date: '', place: '', exists: false, sourceLine: null},
        events: evenements,
        citations: citationsDe(r),
        notes: enfantsDe(r, 'NOTE').map(x => texteDeNote(x.valeur)).filter(Boolean),
        sourceLine: r.ligne
      });
    } else if (r.tag === 'SOUR') {
      sources.set(r.xref, {
        id: r.xref,
        title: deroule(valeurDe(r, 'TITL')),
        author: deroule(valeurDe(r, 'AUTH')),
        publication: deroule(valeurDe(r, 'PUBL')),
        url: deroule(valeurDe(r, 'WWW')),
        text: deroule(valeurDe(r, 'TEXT')),
        type: deroule(valeurDe(r, '_TYPE')),
        notes: enfantsDe(r, 'NOTE').map(x => texteDeNote(x.valeur)).filter(Boolean),
        sourceLine: r.ligne
      });
    }
  }
  return {personnes, familles, sources};
}

/* ------------------------------------------------------- champs calcules */

export function calculer(personnes, familles, racineId) {
  const parentDe = new Map(), enfantsDeP = new Map(), conjoints = new Map();
  // Les listes respectent l'ordre de l'export (FAMC puis FAMS, puis l'ordre des
  // HUSB/WIFE/CHIL de chaque famille) : c'est celui qu'utilise l'application, et
  // un tri alphabetique ferait apparaitre des differences qui n'en sont pas.
  for (const p of personnes.values()) {
    const par = [], enf = [], conj = [];
    for (const f of p.famc) {
      const fam = familles.get(f);
      if (!fam) continue;
      for (const a of fam.partnerIds) if (a !== p.id && !par.includes(a)) par.push(a);
    }
    for (const f of p.fams) {
      const fam = familles.get(f);
      if (!fam) continue;
      for (const a of fam.partnerIds) if (a !== p.id && !conj.includes(a)) conj.push(a);
      for (const c of fam.childIds) if (c !== p.id && !enf.includes(c)) enf.push(c);
    }
    parentDe.set(p.id, par);
    conjoints.set(p.id, conj);
    enfantsDeP.set(p.id, enf);
  }

  // Ancetres de la racine, et cote (paternel / maternel) de chacun.
  const cote = new Map();
  const remonter = (depart, etiquette) => {
    const vus = new Set(), pile = [depart];
    while (pile.length) {
      const id = pile.pop();
      if (!id || vus.has(id)) continue;
      vus.add(id);
      if (!cote.has(id)) cote.set(id, new Set());
      cote.get(id).add(etiquette);
      for (const a of parentDe.get(id) || []) pile.push(a);
    }
  };
  const personneRacine = personnes.get(racineId);
  const pereDe = [...(parentDe.get(racineId) || [])];
  // Les parents de la racine sont tries : pere puis mere, comme dans l'export.
  const famillesParents = [...familles.values()].filter(f => f.childIds.includes(racineId));
  const pere = famillesParents[0]?.partnerIds[0], mere = famillesParents[0]?.partnerIds[1];
  if (pere) remonter(pere, 'paternel');
  if (mere) remonter(mere, 'maternel');

  // Branches. Deux sources, et une subtilite qui compte : la parente par
  // alliance apporte le COTE de la personne epousee, pas ses branches
  // accumulees. Sans cela, l'epouse d'un descendant de la ligne paternelle
  // serait classee « paternel » alors qu'elle n'a aucun lien de sang — c'est
  // exactement l'ecart que presentait Marie Athalie PIROT. En revanche les
  // branches descendent bien des parents vers les enfants.
  const branches = new Map();
  for (const p of personnes.values()) {
    const b = new Set(cote.get(p.id) || []);
    for (const q of conjoints.get(p.id) || []) for (const v of cote.get(q) || []) b.add(v);
    branches.set(p.id, b);
  }
  let bouge = true, tours = 0;
  while (bouge && tours++ < 40) {
    bouge = false;
    for (const p of personnes.values()) {
      const b = branches.get(p.id);
      const avant = b.size;
      for (const r of parentDe.get(p.id) || []) for (const v of branches.get(r) || []) b.add(v);
      if (b.size !== avant) bouge = true;
    }
  }

  // Generation : la racine vaut 0, un enfant +1, un conjoint la meme valeur.
  const generation = new Map([[racineId, 0]]);
  bouge = true; tours = 0;
  while (bouge && tours++ < 60) {
    bouge = false;
    for (const p of personnes.values()) {
      if (!generation.has(p.id)) continue;
      const g = generation.get(p.id);
      for (const c of enfantsDeP.get(p.id) || []) if (!generation.has(c)) { generation.set(c, g + 1); bouge = true; }
      for (const a of parentDe.get(p.id) || []) if (!generation.has(a)) { generation.set(a, g - 1); bouge = true; }
      for (const q of conjoints.get(p.id) || []) if (!generation.has(q)) { generation.set(q, g); bouge = true; }
    }
  }

  // Distance et connexite : parcours du graphe familial non oriente.
  const distance = new Map([[racineId, 0]]);
  let frontiere = [racineId];
  while (frontiere.length) {
    const suivante = [];
    for (const id of frontiere) {
      const d = distance.get(id);
      const voisins = [...(parentDe.get(id) || []), ...(enfantsDeP.get(id) || []), ...(conjoints.get(id) || [])];
      for (const v of voisins) if (!distance.has(v)) { distance.set(v, d + 1); suivante.push(v); }
    }
    frontiere = suivante;
  }

  return {parentDe, enfantsDeP, conjoints, cote, branches, generation, distance, pere, mere};
}
