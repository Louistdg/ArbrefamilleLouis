// Tests du service Railway, executes avec Node (Bun n'est pas necessaire : la
// fonction n'importe que des modules node: et n'appelle Bun.serve que si Bun
// existe).
//
// Usage : node scripts/test-server.mjs

import {gzipSync} from 'node:zlib';
import {scryptSync,randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const BASE = 'https://socle.test';
const PIN = '1611';
const SALT = randomBytes(8).toString('hex');
const DATA_DIR = mkdtempSync(join(tmpdir(), 'arbre-test-'));

process.env.DATA_DIR = DATA_DIR;
process.env.EDIT_PIN_SALT = SALT;
process.env.EDIT_PIN_HASH = scryptSync(PIN, SALT, 32).toString('hex');
process.env.EDIT_SESSION_SECRET = randomBytes(16).toString('hex');
process.env.LOCAL_TEST = '1';

// Document d'essai de taille realiste : les assertions sur la compression n'ont
// de sens qu'au-dela de quelques kilo-octets (sur 80 octets, gzip est plus gros).
const HTML = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Arbre familial</title></head><body>'
  + '<div class="shell">'.repeat(1)
  + 'Une ligne de contenu familial repetee pour rendre la compression mesurable. '.repeat(700)
  + '</div></body></html>';
const gz = gzipSync(Buffer.from(HTML, 'utf8'), {level: 9}).toString('base64');
process.env.APP_CHUNK_COUNT = '2';
process.env.APP_CHUNK_0 = gz.slice(0, Math.ceil(gz.length / 2));
process.env.APP_CHUNK_1 = gz.slice(Math.ceil(gz.length / 2));

const {handle} = await import('../railway-function.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  ECHEC ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
};
const call = (path, opts = {}) => handle(new Request(BASE + path, opts));
const jpost = (path, body, headers = {}) => call(path, {
  method: 'POST', body: JSON.stringify(body),
  headers: {'content-type': 'application/json', ...headers}
});

console.log('Tests du service Railway (donnees dans ' + DATA_DIR + ')\n');

/* ---------------- transport du document ---------------- */
console.log('1) Document : en-tetes, HEAD, cache, encodages');
const r1 = await call('/');
const html1 = await r1.text();
ok('GET / repond 200', r1.status === 200, r1.status);
ok('le HTML servi est complet', html1 === HTML);
ok('Content-Type text/html', /text\/html/.test(r1.headers.get('content-type') || ''));
ok('ETag present', !!r1.headers.get('etag'), r1.headers.get('etag'));
ok('Last-Modified present', !!r1.headers.get('last-modified'));
ok('Cache-Control autorise la revalidation (no-cache, plus no-store)',
  /no-cache/.test(r1.headers.get('cache-control') || '') && !/no-store/.test(r1.headers.get('cache-control') || ''),
  r1.headers.get('cache-control'));
ok('Vary: Accept-Encoding', /accept-encoding/i.test(r1.headers.get('vary') || ''));
ok('CSP durcie : object-src none', /object-src 'none'/.test(r1.headers.get('content-security-policy') || ''));
ok('CSP durcie : form-action none', /form-action 'none'/.test(r1.headers.get('content-security-policy') || ''));
ok('X-Frame-Options DENY', r1.headers.get('x-frame-options') === 'DENY');
ok('Content-Language fr', r1.headers.get('content-language') === 'fr');

const etag = r1.headers.get('etag');

const rHead = await call('/', {method: 'HEAD'});
ok('HEAD / repond 200 (etait 404)', rHead.status === 200, rHead.status);
ok('HEAD / ne renvoie pas de corps', (await rHead.text()) === '');
ok('HEAD / annonce la taille du corps', Number(rHead.headers.get('content-length')) === Buffer.byteLength(HTML),
  rHead.headers.get('content-length'));

ok('GET /index.html repond 200 (etait 404)', (await call('/index.html')).status === 200);
ok('GET /app repond 200', (await call('/app')).status === 200);

const rCond = await call('/', {headers: {'if-none-match': etag}});
ok('If-None-Match reconnu -> 304', rCond.status === 304, rCond.status);
ok('le 304 conserve l ETag', rCond.headers.get('etag') === etag);
ok('le 304 conserve le cache', /no-cache/.test(rCond.headers.get('cache-control') || ''));

const rBr = await call('/', {headers: {'accept-encoding': 'gzip, deflate, br'}});
ok('Accept-Encoding br -> Content-Encoding br', rBr.headers.get('content-encoding') === 'br', rBr.headers.get('content-encoding'));
const lenBr = (await rBr.arrayBuffer()).byteLength;
const rGz = await call('/', {headers: {'accept-encoding': 'gzip'}});
ok('Accept-Encoding gzip -> Content-Encoding gzip', rGz.headers.get('content-encoding') === 'gzip');
const lenGz = (await rGz.arrayBuffer()).byteLength;
const rId = await call('/', {headers: {'accept-encoding': 'identity'}});
ok('identity -> aucune compression', rId.headers.get('content-encoding') === null);
const lenId = (await rId.arrayBuffer()).byteLength;
ok('brotli est plus petit que gzip (' + lenBr + ' < ' + lenGz + ')', lenBr < lenGz, {lenBr, lenGz});
ok('gzip est plus petit que non compresse', lenGz < lenId, {lenGz, lenId});
ok('un ETag distinct par encodage', rBr.headers.get('etag') !== rGz.headers.get('etag'));
const rQ = await call('/', {headers: {'accept-encoding': 'br;q=0, gzip'}});
ok('br;q=0 est respecte (repli sur gzip)', rQ.headers.get('content-encoding') === 'gzip', rQ.headers.get('content-encoding'));

/* ---------------- routes simples ---------------- */
console.log('\n2) Routes annexes');
const rFav = await call('/favicon.ico');
ok('favicon repond 200 (etait 204 sans corps)', rFav.status === 200, rFav.status);
ok('favicon est une image SVG', /image\/svg\+xml/.test(rFav.headers.get('content-type') || ''));
ok('favicon mis en cache une semaine', /max-age=604800/.test(rFav.headers.get('cache-control') || ''));
ok('favicon.svg repond 200', (await call('/favicon.svg')).status === 200);
const rHealth = await call('/health');
ok('/health repond ok', (await rHealth.text()) === 'ok');
ok('/health annonce text/plain', /text\/plain/.test(rHealth.headers.get('content-type') || ''));
const rRobots = await call('/robots.txt');
ok('/robots.txt interdit l indexation', (await rRobots.text()).includes('Disallow: /'));
ok('route inconnue -> 404', (await call('/nope')).status === 404);
const rSw = await call('/sw.js');
const swSource = await rSw.text();
ok('/sw.js servi en javascript', rSw.status === 200 && /javascript/.test(rSw.headers.get('content-type') || ''), rSw.status);
ok('le service worker met en cache mais sert le reseau en priorite',
  swSource.includes('await fetch(req)') && swSource.includes('caches.match(req)'));
ok('le service worker ne met pas les API en cache', swSource.includes("indexOf('/api/')===0"));
ok('le service worker est revalide a chaque chargement', /no-cache/.test(rSw.headers.get('cache-control') || ''));

const rState = await call('/api/state');
const state = await rState.json();
ok('/api/state n expose plus pinConfigured', !('pinConfigured' in state), Object.keys(state));
ok('/api/state n expose plus le nombre d ajouts', !('count' in state), Object.keys(state));
ok('/api/state donne unlocked', typeof state.unlocked === 'boolean');

/* ---------------- limitation de debit ---------------- */
console.log('\n3) Protection du code familial');
const ipA = '203.0.113.10';
let lastWrong = 0;
for (let i = 1; i <= 9; i++) {
  const r = await jpost('/api/unlock', {pin: '999999'}, {'x-forwarded-for': ipA});
  lastWrong = r.status;
  if (i < 9) ok('tentative ' + i + ' refusee en 401', r.status === 401, r.status);
}
ok('la 9e tentative est limitee en 429', lastWrong === 429, lastWrong);
const rGoodAfterLimit = await jpost('/api/unlock', {pin: PIN}, {'x-forwarded-for': ipA});
ok('un code correct reste bloque pendant la fenetre', rGoodAfterLimit.status === 429, rGoodAfterLimit.status);

// La cle de limitation doit etre le dernier maillon (pose par le proxy), pas le
// premier (fourni par le client et donc falsifiable).
const ipB = '203.0.113.11';
for (let i = 1; i <= 8; i++) await jpost('/api/unlock', {pin: '999999'}, {'x-forwarded-for': '10.0.0.' + i + ', ' + ipB});
const rSpoof = await jpost('/api/unlock', {pin: '999999'}, {'x-forwarded-for': '10.0.0.250, ' + ipB});
ok('un premier maillon falsifie ne contourne pas la limitation', rSpoof.status === 429, rSpoof.status);

const rPrio = await jpost('/api/unlock', {pin: '999999'}, {'x-railway-client-ip': '203.0.113.12', 'x-forwarded-for': ipA});
ok('l en-tete de la plateforme est prioritaire sur un IP deja limite', rPrio.status === 401, rPrio.status);

/* ---------------- contributions ---------------- */
console.log('\n4) Contributions : autorisation, validation, ecriture');
ok('POST sans deverrouillage -> 401', (await jpost('/api/contributions', {})).status === 401);

const ipOk = '203.0.113.20';
const rUnlock = await jpost('/api/unlock', {pin: PIN}, {'x-forwarded-for': ipOk});
ok('code correct -> 200', rUnlock.status === 200, rUnlock.status);
const setCookie = rUnlock.headers.get('set-cookie') || '';
ok('cookie HttpOnly', /HttpOnly/i.test(setCookie));
ok('cookie SameSite=Lax', /SameSite=Lax/i.test(setCookie));
ok('cookie d une duree de 12 h', /Max-Age=43200/.test(setCookie));
ok('en essai local, pas de Secure (LOCAL_TEST=1 autorise le HTTP)', !/Secure/i.test(setCookie), setCookie);
const cookie = setCookie.split(';')[0];

const auth = {'x-forwarded-for': ipOk, cookie};
ok('POST avec deverrouillage -> 200', (await jpost('/api/contributions', {relation: 'child', anchorId: '@I1@', given: 'Test'}, auth)).status === 200);
ok('relation invalide -> 400', (await jpost('/api/contributions', {relation: 'nimporte', anchorId: '@I1@', given: 'x'}, auth)).status === 400);
ok('nom manquant -> 400', (await jpost('/api/contributions', {relation: 'child', anchorId: '@I1@'}, auth)).status === 400);
ok('corps illisible -> 400', (await call('/api/contributions', {method: 'POST', body: '{', headers: {...auth, 'content-type': 'application/json'}})).status === 400);
ok('corps trop long -> 413', (await jpost('/api/contributions', {relation: 'child', anchorId: '@I1@', given: 'x'.repeat(9000)}, auth)).status === 413);

// Validation de calendrier : l ancienne expression acceptait 1937-13-45.
const dateEdit = (d) => jpost('/api/contributions', {kind: 'edit', targetId: '@I1@', birthDate: d}, auth);
ok('date 1937-13-45 refusee', (await dateEdit('1937-13-45')).status === 400);
ok('date 2020-02-30 refusee', (await dateEdit('2020-02-30')).status === 400);
ok('date 2019-02-29 refusee (annee non bissextile)', (await dateEdit('2019-02-29')).status === 400);
ok('date 2020-02-29 acceptee (annee bissextile)', (await dateEdit('2020-02-29')).status === 200);
ok('date 1937 acceptee', (await dateEdit('1937')).status === 200);
ok('date 1937-05 acceptee', (await dateEdit('1937-05')).status === 200);
ok('date 1937-05-12 acceptee', (await dateEdit('1937-05-12')).status === 200);
ok('date 0000 refusee', (await dateEdit('0000')).status === 400);

const before = (await (await call('/api/contributions')).json()).items.length;
const results = await Promise.all(Array.from({length: 10}, (_, i) =>
  jpost('/api/contributions', {relation: 'child', anchorId: '@I1@', given: 'Parallele' + i}, auth)));
ok('10 ajouts simultanes tous acceptes', results.every(r => r.status === 200), results.map(r => r.status));
const after = (await (await call('/api/contributions')).json()).items.length;
ok('aucun ajout perdu (lecture-modifier-ecrire serialise)', after === before + 10, {before, after});

/* ---------------- effacement d'un champ errone ---------------- */
console.log('\n4b) Effacement d\'un champ : absent = inchange, null = effacer, texte = renseigner');
const edit = (body) => jpost('/api/contributions', {kind: 'edit', targetId: '@I1@', ...body}, auth);
ok('une correction vide de tout contenu est refusee', (await edit({note: ''})).status === 400);
const rSet = await edit({birthDate: '1937-05-12', note: 'acte'});
ok('une correction qui renseigne est acceptee', rSet.status === 200, rSet.status);
const itemSet = (await rSet.json()).item;
ok('le champ absent n\'est pas stocke (donc non applique)', !('birthPlace' in itemSet), Object.keys(itemSet));
ok('le champ renseigne est stocke', itemSet.birthDate === '1937-05-12');

const rClear = await edit({birthDate: null});
ok('un effacement seul est accepte', rClear.status === 200, rClear.status);
const itemClear = (await rClear.json()).item;
ok('l\'effacement est stocke comme null', itemClear.birthDate === null, itemClear.birthDate);
ok('les autres champs restent absents', !('birthPlace' in itemClear));

const rOld = await edit({birthDate: '', birthPlace: '', note: 'precision'});
ok('une correction vide est refusee', (await edit({birthDate: '', birthPlace: ''})).status === 400);
ok('une chaine vide reste acceptee des qu\'un autre champ est renseigne', rOld.status === 200, rOld.status);
const itemOld = (await rOld.json()).item;
ok('une chaine vide n\'est PAS un effacement (stockee telle quelle)', itemOld.birthDate === '', JSON.stringify(itemOld.birthDate));

/* ---------------- le prenom de l'auteur n'est pas public ---------------- */
console.log('\n4c) Prenom de l\'auteur : visible seulement apres deverrouillage');
const anonyme = (await (await call('/api/contributions')).json()).items;
ok('aucun prenom d\'auteur sans deverrouillage',
  anonyme.every(it => it.author === undefined), anonyme.map(it => it.author).filter(Boolean));
const avecSession = (await (await call('/api/contributions', {headers: {cookie}})).json()).items;
ok('les ajouts restent lisibles sans deverrouillage', anonyme.length === avecSession.length);
ok('le nombre d\'ajouts est identique avec et sans session', anonyme.length > 0);

const items = (await (await call('/api/contributions')).json()).items;
const victim = items[items.length - 1];
ok('DELETE avec deverrouillage -> 200', (await call('/api/contributions?id=' + encodeURIComponent(victim.id), {method: 'DELETE', headers: auth})).status === 200);
ok('DELETE sans deverrouillage -> 401', (await call('/api/contributions?id=' + encodeURIComponent(victim.id), {method: 'DELETE'})).status === 401);
ok('DELETE d un ajout absent -> 404', (await call('/api/contributions?id=inexistant', {method: 'DELETE', headers: auth})).status === 404);
ok('methode non supportee -> 405', (await call('/api/contributions', {method: 'PUT', headers: auth})).status === 405);

const stored = JSON.parse(readFileSync(join(DATA_DIR, 'contributions.json'), 'utf8'));
ok('le stockage est un JSON valide sur disque', Array.isArray(stored.items));
ok('aucun fichier temporaire laisse derriere', !readFileSync(join(DATA_DIR, 'contributions.json'), 'utf8').includes('.tmp'));

/* ---------------- attributs du cookie en conditions de production ---------------- */
console.log('\n5) Cookie en conditions de production');
// LOCAL_TEST=1 retire volontairement l'attribut Secure pour permettre les essais
// en HTTP local. On charge une seconde instance du module sans ce drapeau pour
// verifier ce qui est reellement envoye par Railway.
delete process.env.LOCAL_TEST;
const prod = await import('../railway-function.js?prod=1');
const rProd = await prod.handle(new Request(BASE + '/api/unlock', {
  method: 'POST', body: JSON.stringify({pin: PIN}),
  headers: {'content-type': 'application/json', 'x-forwarded-for': '203.0.113.99'}
}));
const cookieProd = rProd.headers.get('set-cookie') || '';
ok('en production, le code correct est accepte', rProd.status === 200, rProd.status);
ok('en production, le cookie est marque Secure', /Secure/i.test(cookieProd), cookieProd);
ok('en production, le cookie reste HttpOnly et SameSite=Lax',
  /HttpOnly/i.test(cookieProd) && /SameSite=Lax/i.test(cookieProd), cookieProd);

rmSync(DATA_DIR, {recursive: true, force: true});
console.log('\n' + pass + ' reussite(s), ' + fail + ' echec(s)');
process.exit(fail ? 1 : 0);
