import {gunzipSync} from 'node:zlib';
import {createHmac,randomBytes,scryptSync,timingSafeEqual,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';

const env=globalThis.Bun?.env||process.env;
const DATA_DIR=env.DATA_DIR||'/data';
const STORE=DATA_DIR+'/contributions.json';
const PIN_HASH=env.EDIT_PIN_HASH||'';
const PIN_SALT=env.EDIT_PIN_SALT||'';
const SECRET=env.EDIT_SESSION_SECRET||'';
const SECURE=env.LOCAL_TEST==='1'?'':'; Secure';

/* --- page publique, servie comme avant depuis APP_CHUNK_* --- */
let compressed='';
for(let i=0;i<Number(env.APP_CHUNK_COUNT||0);i++)compressed+=env['APP_CHUNK_'+i]||'';
if(!compressed)throw new Error('Application bundle missing');
const app=gunzipSync(Buffer.from(compressed,'base64')).toString('utf8');

const base={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
const headers={...base,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"};
const jsonHeaders={...base,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};

/* --- stockage des ajouts de la famille (volume /data) --- */
function loadDb(){
  try{const db=JSON.parse(readFileSync(STORE,'utf8'));return db&&Array.isArray(db.items)?db:{version:1,items:[]};}
  catch{return {version:1,items:[]};}
}
function saveDb(db){
  try{mkdirSync(DATA_DIR,{recursive:true});const tmp=STORE+'.tmp';writeFileSync(tmp,JSON.stringify(db),'utf8');renameSync(tmp,STORE);return true;}
  catch(error){console.error('ecriture impossible',error);return false;}
}

/* --- session signee apres saisie du code familial --- */
function sign(value){return createHmac('sha256',SECRET).update(value).digest('base64url');}
function newSession(){
  const payload=Buffer.from(JSON.stringify({exp:Date.now()+12*3600*1000,n:randomBytes(8).toString('hex')})).toString('base64url');
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
function ipOf(req){
  return String(req.headers.get('x-railway-client-ip')||req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim();
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
function dateOk(value){
  if(!value)return true;
  return /^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$/.test(value)||/^[0-9]{3,4}$/.test(value);
}
function json(body,status,extra){
  return new Response(JSON.stringify(body),{status:status||200,headers:{...jsonHeaders,...(extra||{})}});
}

async function contributions(req){
  const ip=ipOf(req);
  const db=loadDb();
  if(req.method==='GET')return json({unlocked:isUnlocked(req),items:db.items});
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
      if(!item.birthDate&&!item.birthPlace&&!item.deathDate&&!item.deathPlace&&!item.given&&!item.surname&&!item.note)
        return json({error:'aucune information a enregistrer'},400);
    }else{
      const relation=body&&body.relation;
      if(!['child','parent','partner'].includes(relation))return json({error:'relation invalide'},400);
      item.relation=relation;
      item.anchorId=clean(body.anchorId,60);
      if(!item.anchorId||(!item.given&&!item.surname))return json({error:'nom requis'},400);
    }
    if(!dateOk(item.birthDate)||!dateOk(item.deathDate))return json({error:'date invalide'},400);
    if(db.items.length>=3000)return json({error:'limite atteinte'},400);
    db.items.push(item);
    if(!saveDb(db))return json({error:'enregistrement impossible'},500);
    return json({ok:true,item:item});
  }
  if(req.method==='DELETE'){
    if(!isUnlocked(req))return json({error:'code familial requis'},401);
    const id=new URL(req.url).searchParams.get('id')||'';
    const before=db.items.length;
    db.items=db.items.filter(it=>it.id!==id);
    if(db.items.length===before)return json({error:'ajout introuvable'},404);
    if(!saveDb(db))return json({error:'enregistrement impossible'},500);
    return json({ok:true});
  }
  return json({error:'methode non supportee'},405);
}

export async function handle(req){
  const url=new URL(req.url),path=url.pathname;

  if(path==='/favicon.ico')return new Response(null,{status:204});
  if(path==='/health')return new Response('ok',{headers:{'Cache-Control':'no-store'}});
  if(path==='/robots.txt')return new Response('User-agent: *\nDisallow: /\n',{headers:{'Content-Type':'text/plain'}});

  if(path==='/api/state')return json({unlocked:isUnlocked(req),pinConfigured:!!(PIN_HASH&&PIN_SALT),count:loadDb().items.length});
  if(path==='/api/lock')return json({ok:true},200,{'Set-Cookie':'family_edit=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'+SECURE});
  if(path==='/api/unlock'&&req.method==='POST'){
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
  if(req.method==='GET'&&(path==='/'||path==='/app'))return new Response(app,{headers});
  return new Response('Page introuvable',{status:404,headers:{'Cache-Control':'no-store'}});
}
if(globalThis.Bun)Bun.serve({port:Number(env.PORT||3000),fetch:handle});
