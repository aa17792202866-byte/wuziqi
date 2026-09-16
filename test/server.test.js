const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createServer}=require('../server');

async function fixture(t,options={}){
 const server=createServer({dbPath:':memory:',authLimit:500,...options});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const connections=[];
 t.after(async()=>{for(const c of connections)c.destroy();await server.shutdown()});
 async function request(route,data,cookie){const r=await fetch(base+route,{method:data===undefined?'GET':'POST',headers:{Origin:base,'Content-Type':'application/json','X-Gomoku-Request':'1',...(cookie?{Cookie:cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 async function register(account){const r=await request('/api/register',{account,nickname:account,password:'a-strong-test-password',confirmPassword:'a-strong-test-password'});assert.equal(r.status,200);return {id:r.body.me.id,cookie:r.cookie}}
 async function connect(user){const record={states:[],request:null};await new Promise((resolve,reject)=>{record.request=http.get(base+'/api/events',{headers:{Cookie:user.cookie}},r=>{let buffer='';r.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);if(event.startsWith('data: ')){record.states.push(JSON.parse(event.slice(6)));resolve()}}})});record.request.on('error',reject)});connections.push(record.request);return record}
 async function state(user){return (await request('/api/state',undefined,user.cookie)).body}
 async function act(user,input,raw=false){let payload=input;if(!raw){const s=await state(user),r=s.room;payload={...input,opId:crypto.randomUUID(),...(r?{roomCode:r.code,gameId:r.game.id,version:r.version}:{})}}return request('/api/action',payload,user.cookie)}
 async function room(a,b){const created=await act(a,{type:'create'});assert.equal(created.status,200);assert.equal((await act(b,{type:'join',code:created.body.room.code})).status,200)}
 async function start(a,b){assert.equal((await act(a,{type:'ready',ready:true})).status,200);assert.equal((await act(b,{type:'ready',ready:true})).body.room.phase,'playing')}
 return {server,base,request,register,connect,state,act,room,start};
}
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10))}assert.fail('event synchronization timed out')}

test('registration, sessions, origin protection, multi-connection presence and revocation',async t=>{
 const f=await fixture(t),a=await f.register('player_a');
 assert.match(a.cookie,/gomoku_session=/);
 assert.equal((await f.request('/api/state')).status,401);
 const duplicate=await f.request('/api/register',{account:'PLAYER_A',nickname:'重复用户',password:'password-123',confirmPassword:'password-123'});assert.equal(duplicate.status,409);
 assert.equal((await f.request('/api/login',{account:'missing_user',password:'bad-password'})).body.error,'账号或密码错误');
 assert.equal((await f.request('/api/login',{account:'player_a',password:'bad-password'})).body.error,'账号或密码错误');
 const login=await f.request('/api/login',{account:'PLAYER_A',password:'a-strong-test-password'});assert.equal(login.body.me.id,a.id);
 const storage=f.server.store.get('SELECT * FROM users WHERE id=?',a.id);assert.notEqual(storage.password_hash,'a-strong-test-password');assert.equal(storage.salt.length,32);
 const one=await f.connect(a),two=await f.connect(a);assert.equal((await f.state(a)).players.filter(p=>p.id===a.id).length,1);one.request.destroy();await new Promise(r=>setTimeout(r,30));assert.equal((await f.state(a)).players[0].online,true);
 const csrf=await fetch(f.base+'/api/action',{method:'POST',headers:{Cookie:a.cookie,Origin:'http://evil.example','Content-Type':'application/json','X-Gomoku-Request':'1'},body:'{}'});assert.equal(csrf.status,403);
 assert.equal((await f.request('/api/logout',{},a.cookie)).status,200);assert.equal((await f.request('/api/state',undefined,a.cookie)).status,401);
 assert.equal((await f.request('/api/state',undefined,login.cookie)).status,200);
 two.request.destroy();
});

test('invitations, ready, swap consent, resignation, replay permissions and no duplicate writes',async t=>{
 const f=await fixture(t),a=await f.register('alice'),b=await f.register('bobby'),c=await f.register('carol');
 const ac=await f.connect(a),bc=await f.connect(b);await f.connect(c);
 assert.equal((await f.act(a,{type:'invite',target:a.id})).status,409);
 await f.act(a,{type:'invite',target:b.id});await f.act(c,{type:'invite',target:b.id});
 const invitations=(await f.state(b)).invitations;assert.equal(invitations.length,2);
 const invite=invitations.find(i=>i.sender===a.id);assert.equal((await f.act(b,{type:'invitation',id:invite.id,answer:'accept'})).status,200);
 assert.equal((await f.state(c)).invitations.length,0);assert.equal((await f.act(c,{type:'join',code:(await f.state(a)).room.code})).status,409);
 assert.equal((await f.act(b,{type:'swap'})).status,409);
 await f.act(a,{type:'ready',ready:true});await f.act(b,{type:'request',kind:'swap'});assert.equal((await f.act(a,{type:'ready',ready:true})).status,409);
 await f.act(a,{type:'swap'});let room=(await f.state(a)).room;assert.equal(room.myColor,2);assert.equal(room.pending,null);assert.deepEqual(room.ready,[false,false]);
 await f.act(a,{type:'request',kind:'swap'});const pending=(await f.state(b)).room.pending;await f.act(b,{type:'respond',requestId:pending.id,accept:true});assert.equal((await f.state(a)).room.myColor,1);
 await f.start(a,b);assert.equal((await f.act(a,{type:'swap'})).status,409);
 assert.equal((await f.act(b,{type:'move',row:0,col:0,ply:0})).status,409);
 room=(await f.state(a)).room;const move={type:'move',row:7,col:7,ply:0,roomCode:room.code,gameId:room.game.id,version:room.version,opId:crypto.randomUUID()};
 assert.equal((await f.act(a,move,true)).status,200);assert.equal((await f.act(a,move,true)).body.room.game.history.length,1);assert.equal((await f.act(a,{...move,col:8},true)).status,400);
 await until(()=>bc.states.at(-1).room.game.history.length===1);
 await f.act(b,{type:'move',row:7,col:8,ply:1});await f.act(a,{type:'request',kind:'undo'});const undo=(await f.state(b)).room.pending;await f.act(b,{type:'respond',requestId:undo.id,accept:true});assert.equal((await f.state(a)).room.game.history.length,1);
 await f.act(b,{type:'request',kind:'restart'});bc.request.destroy();await until(()=>!f.server.service.online(b.id));
 const resigned=await f.act(a,{type:'resign',confirmed:true});assert.equal(resigned.status,200);assert.equal(resigned.body.room.game.winner,2);assert.equal(resigned.body.room.pending,null);
 assert.equal((await f.act(a,{type:'resign',confirmed:true})).status,409);
 assert.equal((await f.act(a,{type:'request',kind:'undo'})).status,409);
 const hist=(await f.request('/api/history',undefined,a.cookie)).body;assert.equal(hist.total,1);assert.equal(hist.items[0].result,'loss');
 const replay=await f.request('/api/history/'+hist.items[0].id,undefined,b.cookie);assert.equal(replay.status,200);assert.equal(replay.body.history.length,1);assert.ok(replay.body.events.some(e=>e.type==='undo'));assert.equal(replay.body.reason,'resign');assert.deepEqual(replay.body.line,[]);
 assert.equal((await f.request('/api/history/'+hist.items[0].id,undefined,c.cookie)).status,404);
 await f.act(a,{type:'profile',nickname:'新的名字'});assert.equal((await f.request('/api/history/'+hist.items[0].id,undefined,a.cookie)).body.participants[0].nickname,'alice');
 await until(()=>ac.states.at(-1).room.phase==='ended');
});

test('normal five, restart archive, finished games are immutable and leave frees seats',async t=>{
 const f=await fixture(t),a=await f.register('first'),b=await f.register('second');await f.connect(a);await f.connect(b);await f.room(a,b);await f.start(a,b);
 for(let col=0;col<5;col++){assert.equal((await f.act(a,{type:'move',row:7,col,ply:col*2})).status,200);if(col<4)assert.equal((await f.act(b,{type:'move',row:0,col:col*2,ply:col*2+1})).status,200)}
 let r=(await f.state(a)).room;assert.equal(r.game.reason,'five');assert.equal(r.game.line.length,5);const firstId=r.game.id;
 assert.equal((await f.act(a,{type:'move',row:1,col:1,ply:9})).status,409);
 await f.act(a,{type:'request',kind:'restart'});await f.act(b,{type:'respond',requestId:(await f.state(b)).room.pending.id,accept:true});
 r=(await f.state(a)).room;assert.notEqual(r.game.id,firstId);assert.equal(r.phase,'preparing');assert.equal((await f.request('/api/history',undefined,a.cookie)).body.total,1);
 await f.start(a,b);await f.act(a,{type:'move',row:3,col:3,ply:0});await f.act(a,{type:'request',kind:'restart'});await f.act(b,{type:'respond',requestId:(await f.state(b)).room.pending.id,accept:true});assert.equal((await f.request('/api/history?result=restart',undefined,a.cookie)).body.total,1);
 await f.act(a,{type:'leave',confirmed:false});assert.equal((await f.state(a)).room,null);assert.equal((await f.state(b)).room.phase,'waiting');
 await f.act(a,{type:'join',code:(await f.state(b)).room.code});await f.start(a,b);await f.act(a,{type:'leave',confirmed:true});assert.equal((await f.state(b)).room.game.reason,'resign');assert.equal((await f.state(a)).room,null);
});

test('save failures roll back; retry succeeds once; disk restart restores matches and progress',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gomoku-test-'));const dbPath=path.join(dir,'data.sqlite');
 const f=await fixture(t,{dbPath}),a=await f.register('persist_a'),b=await f.register('persist_b');await f.connect(a);await f.connect(b);await f.room(a,b);await f.start(a,b);
 assert.throws(()=>createServer({dbPath}),/已有五子棋服务运行/);
 f.server.store.db.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON rooms BEGIN SELECT RAISE(ABORT,'test disk failure'); END;");
 const r=(await f.state(a)).room,payload={type:'move',row:7,col:7,ply:0,roomCode:r.code,gameId:r.game.id,version:r.version,opId:crypto.randomUUID()};
 assert.equal((await f.act(a,payload,true)).status,503);assert.equal((await f.state(a)).room.game.history.length,0);
 f.server.store.db.exec('DROP TRIGGER fail_save');assert.equal((await f.act(a,payload,true)).status,200);
 // Open a separate instance on the same durable database after closing the original.
 await f.server.shutdown();f.server.shutdown=async()=>{};
 const restored=await fixture(t,{dbPath});assert.equal((await restored.state(a)).room.game.history.length,1);assert.equal((await restored.state(b)).room.game.id,r.game.id);await restored.connect(a);await restored.connect(b);
 restored.server.store.db.exec("CREATE TRIGGER fail_archive BEFORE INSERT ON matches BEGIN SELECT RAISE(ABORT,'test archive failure'); END;");
 const active=(await restored.state(b)).room;
 const resignation={type:'resign',confirmed:true,roomCode:active.code,gameId:active.game.id,opId:crypto.randomUUID()};
 assert.equal((await restored.act(b,resignation,true)).status,503);assert.equal((await restored.state(b)).room.phase,'playing');assert.equal((await restored.request('/api/history',undefined,a.cookie)).body.total,0);
 restored.server.store.db.exec('DROP TRIGGER fail_archive');
 await restored.act(b,resignation,true);await restored.act(b,resignation,true);assert.equal((await restored.request('/api/history',undefined,a.cookie)).body.total,1);
 const log=await restored.request('/api/login',{account:'PERSIST_A',password:'a-strong-test-password'});assert.equal(log.body.me.id,a.id);
 t.after(()=>{const target=path.resolve(dir);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('gomoku-test-'));fs.rmSync(target,{recursive:true,force:true})});
});

test('invite/request expiration, multi-party race, session expiry and pending request cancellation',async t=>{
 let time=Date.now();const f=await fixture(t,{now:()=>time,offlineGrace:10,tickMs:20}),a=await f.register('expiry_a'),b=await f.register('expiry_b'),c=await f.register('expiry_c');
 await f.connect(a);const bConnection=await f.connect(b);await f.connect(c);
 await f.act(a,{type:'invite',target:b.id});time+=31000;f.server.service.sweep();assert.equal((await f.state(a)).invitations.length,0);
 await f.room(a,b);await f.act(b,{type:'request',kind:'swap'});time+=31000;f.server.service.sweep();assert.equal((await f.state(a)).room.pending,null);
 await f.act(a,{type:'ready',ready:true});await f.act(b,{type:'request',kind:'swap'});bConnection.request.destroy();await until(()=>!f.server.service.online(b.id));assert.equal((await f.state(a)).room.pending,null);
 await f.connect(b);await f.start(a,b);
 const r=(await f.state(a)).room;const [one,two]=await Promise.all([f.act(a,{type:'resign',confirmed:true,roomCode:r.code,gameId:r.game.id,opId:crypto.randomUUID()},true),f.act(b,{type:'resign',confirmed:true,roomCode:r.code,gameId:r.game.id,opId:crypto.randomUUID()},true)]);
 assert.deepEqual([one.status,two.status].sort(),[200,409]);assert.equal((await f.request('/api/history',undefined,a.cookie)).body.total,1);
 time+=8*24*3600000;assert.equal((await f.request('/api/state',undefined,a.cookie)).status,401);
});

test('full board draw is archived and history pagination/filtering stays private',async t=>{
 const f=await fixture(t),a=await f.register('draw_a'),b=await f.register('draw_b'),outsider=await f.register('draw_c');await f.connect(a);await f.connect(b);await f.room(a,b);await f.start(a,b);
 const buckets=[[],[]];for(let row=0;row<15;row++)for(let col=0;col<15;col++)buckets[(row+2*col)%4<2?0:1].push({row,col});
 for(let ply=0;ply<225;ply++){const color=ply%2;const pos=buckets[color].shift();const result=await f.act(color===0?a:b,{type:'move',...pos,ply});assert.equal(result.status,200)}
 let state=await f.state(a);assert.equal(state.room.game.reason,'draw');assert.equal(state.room.game.draw,true);assert.equal(state.room.game.history.length,225);
 let hist=(await f.request('/api/history?result=draw',undefined,a.cookie)).body;assert.equal(hist.total,1);assert.equal(hist.items[0].result,'draw');
 // Each subsequent result is created through the real state machine.
 for(let n=0;n<10;n++){await f.act(a,{type:'request',kind:'restart'});await f.act(b,{type:'respond',requestId:(await f.state(b)).room.pending.id,accept:true});await f.start(a,b);await f.act(a,{type:'resign',confirmed:true})}
 hist=(await f.request('/api/history',undefined,a.cookie)).body;assert.equal(hist.total,11);assert.equal(hist.items.length,10);assert.equal(hist.pages,2);
 const page2=(await f.request('/api/history?page=2',undefined,a.cookie)).body;assert.equal(page2.items.length,1);assert.equal((await f.request('/api/history?result=loss',undefined,a.cookie)).body.total,10);
 assert.equal((await f.request('/api/history',undefined,outsider.cookie)).body.total,0);
});

test('decline, cancel, pending move lock, late responses and request withdrawal while opponent offline',async t=>{
 const f=await fixture(t),a=await f.register('pending_a'),b=await f.register('pending_b');await f.connect(a);const stream=await f.connect(b);
 await f.act(a,{type:'invite',target:b.id});let invite=(await f.state(a)).invitations[0];await f.act(b,{type:'invitation',id:invite.id,answer:'reject'});assert.equal((await f.state(a)).invitations.length,0);
 await f.act(a,{type:'invite',target:b.id});invite=(await f.state(a)).invitations[0];await f.act(a,{type:'invitation',id:invite.id,answer:'cancel'});assert.equal((await f.state(b)).invitations.length,0);
 assert.equal((await f.act(b,{type:'invitation',id:invite.id,answer:'accept'})).status,409);
 await f.room(a,b);await f.act(b,{type:'request',kind:'swap'});const swap=(await f.state(a)).room.pending;await f.act(a,{type:'respond',requestId:swap.id,accept:false});assert.equal((await f.state(a)).room.myColor,1);
 await f.start(a,b);await f.act(a,{type:'move',row:0,col:0,ply:0});await f.act(a,{type:'request',kind:'undo'});
 const pending=(await f.state(a)).room.pending;assert.equal((await f.act(b,{type:'move',row:0,col:1,ply:1})).status,409);
 stream.request.destroy();await until(()=>!f.server.service.online(b.id));assert.equal((await f.act(a,{type:'cancel',requestId:pending.id})).status,200);
 await f.connect(b);assert.equal((await f.act(b,{type:'respond',requestId:pending.id,accept:true})).status,409);assert.equal((await f.state(a)).room.game.history.length,1);
});
