const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const {createServer}=require('../server');
test('two clients: rooms, synchronization, permissions, win, consent, reconnect',{timeout:15000},async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;const streams=[];
 async function request(path,data,token){const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json()}}
 async function watch(session){const record={states:[],request:null};await new Promise((resolve,reject)=>{record.request=http.get(base+`/api/rooms/${session.code}/events?token=${session.token}`,r=>{let buffer='';r.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);if(event.startsWith('data: ')){record.states.push(JSON.parse(event.slice(6)));resolve()}}})});record.request.on('error',reject)});streams.push(record);return record}
 async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,15))}assert.fail('timed out waiting for synchronized state')}
 try{
 const black=(await request('/api/rooms',{})).data;const prefix=`/api/rooms/${black.code}`;
 assert.equal((await request(prefix+'/action',{type:'move',row:0,col:0},black.token)).status,409);
 const white=(await request(prefix+'/join',{})).data;assert.equal(white.color,2);assert.equal((await request(prefix+'/join',{})).status,409);
 assert.equal((await request(prefix+'/state',undefined,'wrong')).status,401);
 const a=await watch(black),b=await watch(white);
 const act=(who,data)=>request(prefix+'/action',data,who.token);
 assert.equal((await act(white,{type:'move',row:0,col:0})).status,409);
 assert.equal((await act(black,{type:'move',row:-1,col:0})).status,400);
 for(let col=0;col<5;col++){assert.equal((await act(black,{type:'move',row:7,col})).status,200);if(col===0){assert.equal((await act(white,{type:'move',row:7,col})).status,409)}if(col<4)assert.equal((await act(white,{type:'move',row:0,col:col*2})).status,200)}
 await until(()=>a.states.at(-1).winner===1&&b.states.at(-1).winner===1);assert.deepEqual(a.states.at(-1).board,b.states.at(-1).board);
 assert.equal((await act(white,{type:'move',row:1,col:0})).status,409);
 await act(black,{type:'request',kind:'undo'});assert.equal((await act(black,{type:'respond',accept:true})).status,409);
 const undo=await act(white,{type:'respond',accept:true});assert.equal(undo.data.winner,0);assert.equal(undo.data.history.length,8);
 await act(white,{type:'request',kind:'restart'});const rejected=await act(black,{type:'respond',accept:false});assert.equal(rejected.data.history.length,8);
 await act(black,{type:'request',kind:'restart'});const reset=await act(white,{type:'respond',accept:true});assert.equal(reset.data.history.length,0);assert.equal(reset.data.turn,1);
 await act(black,{type:'request',kind:'undo'});assert.equal((await request(prefix+'/state',undefined,black.token)).data.pending,null);
 b.request.destroy();await until(()=>a.states.at(-1).players[1].online===false);assert.equal((await act(black,{type:'move',row:7,col:7})).status,409);
 const reconnected=await watch(white);await until(()=>a.states.at(-1).players[1].online);assert.equal((await act(black,{type:'move',row:7,col:7})).status,200);await until(()=>reconnected.states.at(-1).history.length===1);
 }finally{for(const s of streams)s.request.destroy();server.closeAllConnections();await new Promise(r=>server.close(r))}
});
