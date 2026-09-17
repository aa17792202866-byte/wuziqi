const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const {Store}=require('./store');
const {Service,fail}=require('./service');
const {acquireServerLock}=require('./server-lock');
const {AIManager}=require('./ai-manager');
const scrypt=promisify(crypto.scrypt);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const SESSION_AGE=7*24*60*60*1000;
const passwordOptions={N:32768,r:8,p:1,maxmem:64*1024*1024};

function createServer(options={}){
 const dbPath=options.dbPath||process.env.GOMOKU_DB||path.join(__dirname,'data','gomoku.sqlite');
 const releaseLock=acquireServerLock(dbPath);
 let store,service;
 try{store=new Store(dbPath);service=new Service(store,options)}catch(error){store?.close();releaseLock();throw error}
 const aiManager=new AIManager(service);service.aiManager=aiManager;
 const limits=new Map();let closing=false,authJobs=0;
 const now=options.now||Date.now;
 const files={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/game.js':'game.js','/app.js':'app.js'};
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
 function rate(key,max,window=60000){let item=limits.get(key);if(!item||now()>item.until){item={count:0,until:now()+window};limits.set(key,item)}if(++item.count>max)fail('操作过于频繁，请稍后重试',429)}
 async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8192)fail('请求过大',413)}let value;try{value=JSON.parse(text||'{}')}catch{fail('请求格式错误',400)}if(!value||typeof value!=='object'||Array.isArray(value))fail('请求格式错误',400);return value}
 function session(req){const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('gomoku_session='))?.slice(15);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;return store.get('SELECT token_hash,user_id,expires_at FROM sessions WHERE token_hash=? AND expires_at>?',hash(token),now())}
 function requireSession(req){const current=session(req);if(!current)fail('登录已失效，请重新登录',401);return current}
 function cookie(res,token,age=604800){res.setHeader('Set-Cookie',`gomoku_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.COOKIE_SECURE==='1'?'; Secure':''}`)}
 function issueSession(userId,res){const token=crypto.randomBytes(32).toString('hex');store.run('INSERT INTO sessions VALUES (?,?,?)',hash(token),userId,now()+SESSION_AGE);cookie(res,token)}
 function endSessionConnections(tokenHash){for(const connections of service.connections.values())for(const c of [...connections])if(c.tokenHash===tokenHash){c.res.write('event: expired\ndata: {}\n\n');c.res.end()}}
 function networkAddresses(){return Object.values(os.networkInterfaces()).flat().filter(x=>x.family==='IPv4'&&!x.internal).map(x=>x.address)}
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   const url=new URL(req.url,'http://localhost');
   const host=(req.headers.host||'').split(':')[0].toLowerCase();
   if(!['localhost','127.0.0.1',os.hostname().toLowerCase(),...networkAddresses()].includes(host))fail('请使用本机或局域网地址访问',403);
   if(req.method==='POST'){
    if(req.headers.origin!==`http://${req.headers.host}`&&!(process.env.COOKIE_SECURE==='1'&&req.headers.origin===`https://${req.headers.host}`))fail('请求来源无效，请从本网站操作',403);
    if(!req.headers['content-type']?.startsWith('application/json')||req.headers['x-gomoku-request']!=='1')fail('请求校验失败',403);
    rate('write:'+req.socket.remoteAddress,300);
   }
   if(req.method==='GET'&&files[url.pathname]){const file=files[url.pathname];res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache'});return fs.createReadStream(path.join(__dirname,'dist',file)).pipe(res)}
   if(req.method==='GET'&&url.pathname==='/api/info')return json(res,200,{addresses:networkAddresses().map(x=>`http://${x}:${server.address().port}`)});
   if(req.method==='GET'&&url.pathname==='/api/session'){const current=session(req);return json(res,200,current?service.snapshot(current.user_id):null)}
   if(req.method==='POST'&&['/api/register','/api/login'].includes(url.pathname)){
    rate('auth:'+req.socket.remoteAddress,options.authLimit||25,600000);
    const input=await body(req),account=typeof input.account==='string'?input.account.trim().toLowerCase():'',password=input.password;
    if(!/^[a-z0-9_]{4,20}$/.test(account)||typeof password!=='string'||[...password].length<8||[...password].length>64)fail(url.pathname==='/api/login'?'账号或密码错误':'账号为4～20位字母、数字或下划线；密码为8～64个字符',400);
    rate('account:'+account,options.authLimit||20,600000);
    if(authJobs>=8)fail('登录请求较多，请稍后重试',429);authJobs++;
    let userId;
    try{
     if(url.pathname==='/api/register'){
      const nick=typeof input.nickname==='string'?input.nickname.trim():'';
      if([...nick].length<2||[...nick].length>20)fail('昵称应为2～20个字符',400);
      if(input.confirmPassword!==password)fail('两次输入的密码不一致',400);
      const salt=crypto.randomBytes(16).toString('hex');const derived=await scrypt(password,salt,64,passwordOptions);userId=crypto.randomUUID();
      store.transaction(()=>{if(store.get('SELECT id FROM users WHERE account=?',account))fail('账号已存在',409);store.run('INSERT INTO users VALUES (?,?,?,?,?,?)',userId,account,nick,derived.toString('hex'),salt,now());issueSession(userId,res)});
     }else{
      const user=store.get('SELECT * FROM users WHERE account=?',account);
      const derived=await scrypt(password,user?.salt||'00000000000000000000000000000000',64,passwordOptions);
      if(!user||!crypto.timingSafeEqual(derived,Buffer.from(user.password_hash,'hex')))fail('账号或密码错误',401);
      userId=user.id;store.transaction(()=>issueSession(userId,res));
     }
    }finally{authJobs--}
    return json(res,200,service.snapshot(userId));
   }
   const current=requireSession(req),uid=current.user_id;
   if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,service.snapshot(uid));
   if(req.method==='GET'&&url.pathname==='/api/events'){
    if((service.connections.get(uid)?.size||0)>=12)fail('打开的窗口过多，请关闭多余窗口',429);
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');
    const connection={res,tokenHash:current.token_hash};
    res.on('close',()=>{if(closing)return;try{service.disconnect(uid,connection)}catch(e){console.error('Connection state could not be saved:',e.code||e.message)}});
    service.connect(uid,connection);return;
   }
   if(req.method==='GET'&&url.pathname==='/api/history'){
    const page=Number(url.searchParams.get('page')||1);if(!Number.isInteger(page)||page<1||page>100000)fail('页码无效',400);
    return json(res,200,service.history(uid,page,url.searchParams.get('result')||'all',url.searchParams.get('mode')||'all'));
   }
   const replay=url.pathname.match(/^\/api\/history\/([a-f0-9-]{36})$/);
   if(req.method==='GET'&&replay)return json(res,200,service.replay(uid,replay[1]));
   if(req.method==='POST'&&url.pathname==='/api/action'){
    const input=await body(req);const fresh=requireSession(req);if(fresh.user_id!==uid)fail('请重新登录',401);
    if(input.type==='invite')rate('invite:'+uid,20);
    return json(res,200,service.action(uid,input));
   }
   if(req.method==='POST'&&url.pathname==='/api/logout'){
    const input=await body(req);requireSession(req);
    service.changed(()=>{service.leave(uid,input.confirmed);store.run('DELETE FROM sessions WHERE token_hash=?',current.token_hash)});
    cookie(res,'',0);endSessionConnections(current.token_hash);return json(res,200,{ok:true});
   }
   fail('接口不存在',404);
  }catch(error){
   if(!error.status)console.error('Request failed:',error.code||error.message);
   if(!res.headersSent)json(res,error.status||503,{error:error.status?error.message:'保存或读取失败，操作未确认。请稍后重试，旧棋局已保留。'});else res.end();
  }
 });
 let ticks=0;
 const timer=setInterval(()=>{
  try{
   service.sweep();
   aiManager.sync();
   for(const connections of service.connections.values())for(const c of [...connections]){
    if(!store.get('SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?',c.tokenHash,now())){c.res.write('event: expired\ndata: {}\n\n');c.res.end()}
    else if(ticks%10===0)c.res.write(': heartbeat\n\n');
   }
   if(++ticks%60===0){for(const [key,value]of limits)if(value.until<now())limits.delete(key)}
  }catch(e){service.storageError=true;service.broadcast();console.error('Background save failed:',e.code||e.message)}
 },options.tickMs||1000);timer.unref();
 server.store=store;server.service=service;
 let shutdownPromise;
 server.shutdown=()=>shutdownPromise||=(async()=>{closing=true;clearInterval(timer);aiManager.close();for(const connections of service.connections.values())for(const c of connections)c.res.end();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();releaseLock()})();
 return server;
}
if(require.main===module){
 const port=Number(process.env.PORT||3210);const server=createServer();
 server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${port} 已被使用，请关闭已运行的五子棋或更改 PORT。`:e.message);process.exitCode=1});
 server.listen(port,'0.0.0.0',()=>{console.log(`五子棋已启动\n本机：http://localhost:${port}`);for(const x of Object.values(os.networkInterfaces()).flat())if(x.family==='IPv4'&&!x.internal)console.log(`局域网：http://${x.address}:${port}`);console.log('保持此窗口开启；按 Ctrl+C 停止。')});
 let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await server.shutdown();process.exit(0)};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
module.exports={createServer};
