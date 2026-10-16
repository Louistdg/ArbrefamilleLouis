// Determine les regles exactes qu'a suivies le convertisseur d'origine.
import fs from 'node:fs';
const html = fs.readFileSync('C:/Documents/deepseek-harness/default-workspace/ArbrefamilleLouis/index.html', 'utf8');
const d = html.indexOf('{', html.indexOf('window.FAMILY_DATA='));
let p = 0, s = false, e = false, fin = -1;
for (let k = d; k < html.length; k++) {
  const c = html[k];
  if (s) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') s = false; continue; }
  if (c === '"') { s = true; continue; }
  if (c === '{') p++; else if (c === '}') { p--; if (!p) { fin = k + 1; break; } }
}
const D = JSON.parse(html.slice(d, fin));

const compte = (arr, f) => { const m = new Map(); for (const x of arr) { const k = f(x); m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };

console.log('=== types d\'evenements conserves (personnes) ===');
compte(D.people.flatMap(x => x.events || []), e => e.type).forEach(([k, v]) => console.log('  ' + String(k).padEnd(10) + v));
console.log('=== types d\'evenements conserves (familles) ===');
compte(D.families.flatMap(x => x.events || []), e => e.type).forEach(([k, v]) => console.log('  ' + String(k).padEnd(10) + v));
console.log('=== sortes de citations ===');
compte(D.people.flatMap(x => x.citations || []).concat(D.families.flatMap(x => x.citations || [])), c => c.kind || '(vide)').forEach(([k, v]) => console.log('  ' + String(k).padEnd(20) + v));

console.log('\n=== naissance inconnue mais evenement present ? ===');
const sansDate = D.people.filter(x => x.events?.some(e => e.type === 'BIRT' && !e.date));
console.log('  personnes avec un BIRT sans date : ' + sansDate.length);
console.log('  exemples birth.known : ' + JSON.stringify([...new Set(D.people.map(x => x.birth.known))]));
const connuSansDate = D.people.filter(x => x.birth.known && !x.birth.date);
console.log('  birth.known=true et sans date : ' + connuSansDate.length + (connuSansDate.length ? ' -> ' + connuSansDate.slice(0, 3).map(x => x.name + ' [' + JSON.stringify(x.birth) + ']').join(' | ') : ''));
const decesSansDate = D.people.filter(x => x.death.known && !x.death.date);
console.log('  death.known=true et sans date : ' + decesSansDate.length + (decesSansDate.length ? ' -> ' + decesSansDate.slice(0, 3).map(x => x.name + ' [' + JSON.stringify(x.death) + ']').join(' | ') : ''));
const decesConnu = D.people.filter(x => x.death.known).length;
console.log('  personnes avec deces connu : ' + decesConnu + ' / ' + D.people.length);

console.log('\n=== place sans date, date sans place ===');
console.log('  birth date vide + place remplie : ' + D.people.filter(x => !x.birth.date && x.birth.place).length);
console.log('  birth date remplie + place vide : ' + D.people.filter(x => x.birth.date && !x.birth.place).length);

console.log('\n=== divorce ===');
console.log('  familles avec un evenement DIV : ' + D.families.filter(f => f.events?.some(e => e.type === 'DIV')).length);
console.log('  familles avec une cle divorce  : ' + D.families.filter(f => 'divorce' in f).length);
console.log('  familles mariage.exists=false   : ' + D.families.filter(f => f.marriage && f.marriage.exists === false).length);
console.log('  familles marriage absent        : ' + D.families.filter(f => !f.marriage).length);

console.log('\n=== cohérence des identifiants ===');
const ids = new Set(D.people.map(x => x.id));
console.log('  personnes en double : ' + (D.people.length - ids.size));
const fids = new Set(D.families.map(x => x.id));
console.log('  familles en double  : ' + (D.families.length - fids.size));
const sids = new Set(D.sources.map(x => x.id));
console.log('  sources en double   : ' + (D.sources.length - sids.size));
let refKo = 0, selfKo = 0, incoherent = 0;
for (const x of D.people) {
  for (const f of x.parentFamilyIds || []) if (!fids.has(f)) refKo++;
  for (const f of x.spouseFamilyIds || []) if (!fids.has(f)) refKo++;
  for (const y of x.parents || []) if (!ids.has(y)) refKo++;
  for (const y of x.children || []) if (!ids.has(y)) refKo++;
  for (const y of x.partners || []) if (!ids.has(y)) refKo++;
  if ((x.parents || []).includes(x.id) || (x.partners || []).includes(x.id) || (x.children || []).includes(x.id)) selfKo++;
}
for (const f of D.families) {
  for (const y of [...f.partnerIds, ...f.childIds]) if (!ids.has(y)) refKo++;
  if (f.partnerIds.includes(f.childIds[0]) || f.partnerIds.some(z => f.childIds.includes(z))) selfKo++;
}
console.log('  references cassees  : ' + refKo);
console.log('  auto-references     : ' + selfKo);

console.log('\n=== coherence parents/enfants symetrique ===');
let asym = 0;
for (const x of D.people) for (const c of x.children || []) {
  const e = D.people.find(y => y.id === c);
  if (!e || !(e.parents || []).includes(x.id)) asym++;
}
console.log('  enfant declare sans parent reciproque : ' + asym);

console.log('\n=== citations dupliquees (meme source, meme page, meme texte) ===');
let dupTotal = 0;
const dupExemples = [];
for (const x of D.people) {
  const vus = new Map();
  for (const c of x.citations || []) {
    const cle = c.sourceId + '|' + (c.page || '') + '|' + (c.text || '') + '|' + (c.kind || '');
    vus.set(cle, (vus.get(cle) || 0) + 1);
  }
  const n = [...vus.values()].filter(v => v > 1).reduce((a, b) => a + b - 1, 0);
  if (n) { dupTotal += n; if (dupExemples.length < 6) dupExemples.push(x.name + ' (' + n + ' en trop)'); }
}
console.log('  citations en trop dans l\'application : ' + dupTotal);
dupExemples.forEach(x => console.log('    - ' + x));
