import {gunzipSync,brotliCompressSync,constants} from 'node:zlib';
import {createHmac,createHash,randomBytes,scryptSync,timingSafeEqual,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';

const env=globalThis.Bun?.env||process.env;
const DATA_DIR=env.DATA_DIR||'/data';
const STORE=DATA_DIR+'/contributions.json';
const PIN_HASH=env.EDIT_PIN_HASH||'';
const PIN_SALT=env.EDIT_PIN_SALT||'';
const SECRET=env.EDIT_SESSION_SECRET||'';
const SECURE=env.LOCAL_TEST==='1'?'':'; Secure';
const PRE_ENCODED=env.APP_PRE_ENCODED!=='0';
const SESSION_MS=12*3600*1000;

/* --- page publique, servie comme avant depuis APP_CHUNK_* --- */
let compressed='';
for(let i=0;i<Number(env.APP_CHUNK_COUNT||0);i++)compressed+=env['APP_CHUNK_'+i]||'';
if(!compressed)throw new Error('Application bundle missing');

// Le bundle est stocke deja compresse en gzip+base64 dans les variables Railway.
// On conserve les octets gzip tels quels (encodage servi sans recalcul) et on
// derive une variante brotli une seule fois au demarrage : environ -33 % sur le
// fil par rapport a gzip, et plus aucune recompression a la volee par la plateforme.
const gzipBytes=Buffer.from(compressed,'base64');
const appBytes=gunzipSync(gzipBytes);
let brotliBytes=null;
if(PRE_ENCODED){
  try{
    brotliBytes=brotliCompressSync(appBytes,{params:{
      [constants.BROTLI_PARAM_QUALITY]:9,
      [constants.BROTLI_PARAM_SIZE_HINT]:appBytes.length
    }});
  }catch(error){
    console.error('brotli indisponible, repli sur gzip',error);
  }
}

// Un validateur distinct par representation (RFC 9110) : melanger les encodages
// derriere un meme ETag ferait servir la mauvaise representation depuis un cache.
const hash=createHash('sha256').update(appBytes).digest('base64url').slice(0,32);
const TAGS={identity:'W/"'+hash+'-id"',gzip:'W/"'+hash+'-gz"',br:'W/"'+hash+'-br"'};
const BUILD_TIME=new Date();

const base={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
const csp="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
// no-cache (et non no-store) : le navigateur conserve la page mais revalide
// systematiquement. Le document est identique pour tout le monde et porte un
// ETag, donc une relecture coute environ 200 octets au lieu de 157 Ko.
const appCache='no-cache, must-revalidate';
const headers={...base,'Content-Type':'text/html; charset=utf-8','Content-Language':'fr','Cache-Control':appCache,'Content-Security-Policy':csp,'X-Frame-Options':'DENY','Cross-Origin-Opener-Policy':'same-origin'};
const jsonHeaders={...base,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};

const FAVICON='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Notre histoire"><rect width="64" height="64" rx="18" fill="#275447"/><text x="32" y="46" font-size="40" text-anchor="middle" fill="#f7e8c9" font-family="Georgia,serif">\u2727</text></svg>';

// Service worker minimal : reseau d'abord, cache en secours. En ligne il ne sert
// jamais de version perimee ; hors ligne il evite la page blanche, alors que
// l'application est deja entierement autonome (aucune sous-ressource externe).
const SW_SOURCE=[
  "const CACHE='arbre-famille-v1';",
  "self.addEventListener('install',()=>self.skipWaiting());",
  "self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));",
  "self.addEventListener('fetch',e=>{",
  "  const req=e.request;",
  "  if(req.method!=='GET')return;",
  "  const url=new URL(req.url);",
  "  if(url.origin!==self.location.origin)return;",
  "  if(url.pathname.indexOf('/api/')===0)return;",
  "  e.respondWith((async()=>{",
  "    try{",
  "      const frais=await fetch(req);",
  "      if(frais&&frais.ok&&frais.type==='basic'){const c=await caches.open(CACHE);c.put(req,frais.clone());}",
  "      return frais;",
  "    }catch(err){",
  "      const garde=await caches.match(req);",
  "      if(garde)return garde;",
  "      if(req.mode==='navigate'){const page=await caches.match('/');if(page)return page;}",
  "      return new Response('Hors ligne',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});",
  "    }",
  "  })());",
  "});"
].join('\n');

/* --- stockage des ajouts de la famille (volume /data) --- */
function loadDb(){
  try{const db=JSON.parse(readFileSync(STORE,'utf8'));return db&&Array.isArray(db.items)?db:{version:1,items:[]};}
  catch{return {version:1,items:[]};}
}
function saveDb(db){
  try{mkdirSync(DATA_DIR,{recursive:true});const tmp=STORE+'.tmp';writeFileSync(tmp,JSON.stringify(db),'utf8');renameSync(tmp,STORE);return true;}
  catch(error){console.error('ecriture impossible',error);return false;}
}

// L'ecriture est un cycle lire-modifier-ecrire : deux contributions simultanees
// pourraient s'ecraser mutuellement. Une file d'attente en memoire suffit, le
// service tournant dans un seul processus.
let ioChain=Promise.resolve();
function withWriteLock(fn){
  const run=ioChain.then(fn,fn);
  ioChain=run.then(()=>undefined,()=>undefined);
  return run;
}

/* --- session signee apres saisie du code familial --- */
function sign(value){return createHmac('sha256',SECRET).update(value).digest('base64url');}
function newSession(){
  const payload=Buffer.from(JSON.stringify({exp:Date.now()+SESSION_MS,n:randomBytes(8).toString('hex')})).toString('base64url');
  return payload+'.'+sign(payload);
}
function isUnlocked(req){
  try{
    const cookie=(req.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('family_edit='));
    if(!cookie)return false;
    const parts=cookie.slice('family_edit='.length).split('.');
    const payload=parts[0],mac=parts[1];
    if(!payload||!mac)return false;
    const a=Buffer.from(sign(payload)),b=Buffer.from(mac);
    if(a.length!==b.length||!timingSafeEqual(a,b))return false;
    return Number(JSON.parse(Buffer.from(payload,'base64url').toString()).exp)>Date.now();
  }catch{return false;}
}
function pinOk(pin){
  if(!PIN_HASH||!PIN_SALT)return false;
  if(!/^[0-9]{4,8}$/.test(pin))return false;
  try{
    const expected=Buffer.from(PIN_HASH,'hex');
    const got=scryptSync(pin,PIN_SALT,expected.length);
    return expected.length===got.length&&timingSafeEqual(expected,got);
  }catch{return false;}
}

/* --- limitation de debit --- */
const attempts=new Map(),writes=new Map();
// Le premier maillon de X-Forwarded-For est fourni par le client : s'y fier
// laisserait un attaquant choisir sa propre cle de limitation. On prefere
// l'en-tete pose par la plateforme, sinon le dernier maillon (ajoute par le
// proxy le plus proche de l'application).
function ipOf(req){
  const direct=req.headers.get('x-railway-client-ip');
  if(direct)return direct.split(',')[0].trim();
  const parts=(req.headers.get('x-forwarded-for')||'').split(',').map(s=>s.trim()).filter(Boolean);
  return parts.length?parts[parts.length-1]:'unknown';
}
function tooMany(map,key,max,windowMs){
  const now=Date.now();
  const list=(map.get(key)||[]).filter(t=>now-t<windowMs);
  if(list.length>=max){map.set(key,list);return true;}
  list.push(now);map.set(key,list);
  if(map.size>5000)for(const [k,v] of map)if(!v.some(t=>now-t<windowMs))map.delete(k);
  return false;
}

function clean(value,max){
  return String(value==null?'':value).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max||90);
}
// Champ d'une correction : absent (inchange), null (effacer), texte (renseigner).
function champ(body,key,max){
  if(!Object.prototype.hasOwnProperty.call(body,key))return undefined;
  if(body[key]===null)return null;
  return clean(body[key],max);
}
// Validation de calendrier reelle : l'ancienne expression acceptait 1937-13-45.
function dateOk(value){
  if(!value)return true;
  if(/^[0-9]{3,4}$/.test(value)){const y=Number(value);return y>=1000&&y<=2100;}
  const m=/^([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2}))?)?$/.exec(value);
  if(!m)return false;
  const year=Number(m[1]);
  if(year<1000||year>2100)return false;
  if(m[2]===undefined)return true;
  const month=Number(m[2]);
  if(month<1||month>12)return false;
  if(m[3]===undefined)return true;
  const day=Number(m[3]);
  const last=new Date(Date.UTC(year,month,0)).getUTCDate();
  return day>=1&&day<=last;
}
function json(body,status,extra){
  return new Response(JSON.stringify(body),{status:status||200,headers:{...jsonHeaders,...(extra||{})}});
}

function pickEncoding(req){
  if(!PRE_ENCODED)return {body:appBytes,encoding:'',tag:TAGS.identity};
  const raw=(req.headers.get('accept-encoding')||'').toLowerCase();
  const wanted=new Map();
  for(const part of raw.split(',')){
    const [name,...params]=part.trim().split(';');
    if(!name)continue;
    const q=params.map(p=>p.trim()).find(p=>p.startsWith('q='));
    wanted.set(name.trim(),q?Number(q.slice(2)):1);
  }
  const allowed=n=>{
    if(wanted.has(n))return wanted.get(n)>0;
    if(wanted.has('*'))return wanted.get('*')>0;
    return false;
  };
  if(brotliBytes&&allowed('br'))return {body:brotliBytes,encoding:'br',tag:TAGS.br};
  if(allowed('gzip'))return {body:gzipBytes,encoding:'gzip',tag:TAGS.gzip};
  return {body:appBytes,encoding:'',tag:TAGS.identity};
}

function appResponse(req,head){
  const {body,encoding,tag}=pickEncoding(req);
  const out={...headers,'ETag':tag,'Vary':'Accept-Encoding','Last-Modified':BUILD_TIME.toUTCString(),'Content-Length':String(body.length)};
  if(encoding)out['Content-Encoding']=encoding;
  const inm=req.headers.get('if-none-match');
  if(inm&&(inm.trim()==='*'||inm.split(',').some(t=>t.trim()===tag))){
    const fresh={...base,'ETag':tag,'Vary':'Accept-Encoding','Cache-Control':appCache};
    if(encoding)fresh['Content-Encoding']=encoding;
    return new Response(null,{status:304,headers:fresh});
  }
  return new Response(head?null:body,{status:200,headers:out});
}

async function contributions(req){
  const ip=ipOf(req);
  // Le prenom de la personne qui a propose un ajout n'a pas a etre public : il
  // n'est renvoye qu'a une session deverrouillee. Le reste des ajouts est
  // necessaire a l'affichage de l'arbre public.
  if(req.method==='GET'){
    const unlocked=isUnlocked(req);
    const items=loadDb().items;
    if(unlocked)return json({unlocked,items});
    return json({unlocked,items:items.map(it=>{
      if(!it||it.author===undefined)return it;
      const copie={...it};
      delete copie.author;
      return copie;
    })});
  }
  if(req.method==='POST'){
    if(!isUnlocked(req))return json({error:'code familial requis'},401);
    if(tooMany(writes,ip,40,3600*1000))return json({error:'trop d ajouts recents'},429);
    let body=null;
    try{
      const text=await req.text();
      if(text.length>8192)return json({error:'requete trop longue'},413);
      body=JSON.parse(text);
    }catch{return json({error:'requete invalide'},400);}
    const kind=body&&body.kind==='edit'?'edit':'person';
    const item={
      id:randomUUID(),createdAt:new Date().toISOString(),kind:kind,
      given:clean(body.given,60),surname:clean(body.surname,60),
      sex:['M','F','U'].includes(body.sex)?body.sex:'U',
      birthDate:clean(body.birthDate,12),birthPlace:clean(body.birthPlace,80),
      deathDate:clean(body.deathDate,12),deathPlace:clean(body.deathPlace,80),
      note:clean(body.note,400),author:clean(body.author,60)
    };
    if(kind==='edit'){
      item.targetId=clean(body.targetId,60);
      if(!item.targetId)return json({error:'personne cible manquante'},400);
      // Une correction doit pouvoir VIDER un champ errone. Trois cas sont donc
      // distingues : champ absent (inchange), null (effacer), texte (renseigner).
      // Les ajouts deja enregistres portent des chaines vides : leur sens
      // d'origine est conserve, ils ne declenchent aucun effacement.
      for(const [key,max] of [['given',60],['surname',60],['birthDate',12],['birthPlace',80],['deathDate',12],['deathPlace',80],['note',400]])
        item[key]=champ(body,key,max);
      const utile=['given','surname','birthDate','birthPlace','deathDate','deathPlace','note']
        .some(key=>item[key]===null||(item[key]!==undefined&&item[key]!==''));
      if(!utile)return json({error:'aucune information a enregistrer'},400);
    }else{
      const relation=body&&body.relation;
      if(!['child','parent','partner'].includes(relation))return json({error:'relation invalide'},400);
      item.relation=relation;
      item.anchorId=clean(body.anchorId,60);
      if(!item.anchorId||(!item.given&&!item.surname))return json({error:'nom requis'},400);
    }
    if(!dateOk(item.birthDate)||!dateOk(item.deathDate))return json({error:'date invalide'},400);
    // Lecture et ecriture dans la meme section critique : plus d'ajout perdu.
    return await withWriteLock(()=>{
      const db=loadDb();
      if(db.items.length>=3000)return json({error:'limite atteinte'},400);
      db.items.push(item);
      if(!saveDb(db))return json({error:'enregistrement impossible'},500);
      return json({ok:true,item:item});
    });
  }
  if(req.method==='DELETE'){
    if(!isUnlocked(req))return json({error:'code familial requis'},401);
    const id=new URL(req.url).searchParams.get('id')||'';
    return await withWriteLock(()=>{
      const db=loadDb();
      const before=db.items.length;
      db.items=db.items.filter(it=>it.id!==id);
      if(db.items.length===before)return json({error:'ajout introuvable'},404);
      if(!saveDb(db))return json({error:'enregistrement impossible'},500);
      return json({ok:true});
    });
  }
  return json({error:'methode non supportee'},405);
}

async function route(req){
  const url=new URL(req.url),path=url.pathname,method=req.method;
  const head=method==='HEAD';
  const get=head||method==='GET';

  if(path==='/favicon.ico'||path==='/favicon.svg')
    return new Response(head?null:FAVICON,{status:200,headers:{...base,'Content-Type':'image/svg+xml','Cache-Control':'public, max-age=604800, immutable'}});
  // Sans service worker, une coupure reseau suivie d'un rechargement donnait une
  // page blanche, alors que l'application ne depend d'aucune ressource externe.
  if(path==='/sw.js')
    return new Response(head?null:SW_SOURCE,{status:200,headers:{...base,'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-cache','Service-Worker-Allowed':'/'}});
  if(path==='/health')return new Response(head?null:'ok',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  if(path==='/robots.txt')return new Response(head?null:'User-agent: *\nDisallow: /\n',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=3600'}});

  // L'application ne consulte pas cette route : on n'expose plus l'existence du
  // code familial ni le nombre d'ajouts en attente.
  if(path==='/api/state')return json({unlocked:isUnlocked(req)});
  if(path==='/api/lock')return json({ok:true},200,{'Set-Cookie':'family_edit=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'+SECURE});
  if(path==='/api/unlock'&&method==='POST'){
    const ip=ipOf(req);
    if(tooMany(attempts,ip,8,15*60*1000))return json({error:'trop de tentatives, reessaie dans quinze minutes'},429);
    let body=null;
    try{
      const text=await req.text();
      if(text.length>512)return json({error:'requete trop longue'},413);
      body=JSON.parse(text);
    }catch{return json({error:'requete invalide'},400);}
    if(!pinOk(String((body&&body.pin)||'')))return json({error:'code incorrect'},401);
    attempts.delete(ip);
    return json({ok:true},200,{'Set-Cookie':'family_edit='+newSession()+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200'+SECURE});
  }
  if(path==='/api/contributions')return contributions(req);
  // /index.html etait renvoye en 404 alors que le document existe ; GET et HEAD
  // sont desormais traites (les sondes de disponibilite utilisent HEAD).
  if(get&&(path==='/'||path==='/app'||path==='/index.html'))return appResponse(req,head);
  return new Response(head?null:'Page introuvable',{status:404,headers:{...base,'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
}

export async function handle(req){
  try{
    return await route(req);
  }catch(error){
    console.error('requete en echec',error);
    return new Response(JSON.stringify({error:'erreur interne'}),{status:500,headers:jsonHeaders});
  }
}
if(globalThis.Bun)Bun.serve({port:Number(env.PORT||3000),fetch:handle});
