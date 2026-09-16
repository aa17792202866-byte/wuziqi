const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const Gomoku=require('./dist/game.js');
function createServer(){
 const rooms=new Map(),limits=new Map();
 const files={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/game.js':'game.js','/app.js':'app.js'};
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
 const snapshot=room=>({code:room.code,board:room.game.board,history:room.game.history,winner:room.game.winner,line:room.game.line,draw:room.game.draw,turn:room.game.turn,players:room.players.map(p=>p?{online:p.streams.size>0}:null),pending:room.pending,startedAt:room.startedAt,elapsed:room.elapsed});
 function broadcast(room){const data='data: '+JSON.stringify(snapshot(room))+'\n\n';for(const player of room.players)if(player)for(const stream of player.streams)stream.write(data)}
 const player=()=>({token:crypto.randomBytes(24).toString('hex'),streams:new Set()});
 function fail(message,status=400){throw Object.assign(new Error(message),{status})}
 async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>4096)fail('请求过大',413)}try{return JSON.parse(data||'{}')}catch{fail('请求格式错误')}}
 const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 // A browser from another origin must not make room-changing requests.
 if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'请从本网站页面操作'});
 if(req.method==='GET'&&files[url.pathname]){const file=files[url.pathname];res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});return fs.createReadStream(path.join(__dirname,'dist',file)).pipe(res)}
 if(req.method==='GET'&&url.pathname==='/api/info'){const port=server.address().port;const addresses=Object.values(os.networkInterfaces()).flat().filter(x=>x.family==='IPv4'&&!x.internal).map(x=>`http://${x.address}:${port}`);return json(res,200,{addresses})}
 if(req.method==='POST'){
 const ip=req.socket.remoteAddress;let rate=limits.get(ip);if(!rate||Date.now()-rate.at>60000){rate={at:Date.now(),count:0};limits.set(ip,rate)}if(++rate.count>180)fail('操作太频繁，请稍后再试',429);
 }
 if(req.method==='POST'&&url.pathname==='/api/rooms'){
 if(rooms.size>=1000)fail('房间已满，请稍后再试',503);
 let code;do{code=String(crypto.randomInt(100000,1000000))}while(rooms.has(code));
 const first=player();const room={code,players:[first,null],game:new Gomoku(),pending:null,startedAt:null,elapsed:0,updated:Date.now()};rooms.set(code,room);return json(res,201,{code,token:first.token,color:1,state:snapshot(room)})}
 const match=url.pathname.match(/^\/api\/rooms\/(\d{6})\/(join|events|action|state)$/);if(!match)fail('页面或房间接口不存在',404);
 const room=rooms.get(match[1]);if(!room)fail('房间不存在或已过期，请重新创建',404);
 const op=match[2];
 if(op==='join'&&req.method==='POST'){if(room.players[1])fail('房间已有两名玩家',409);const second=player();room.players[1]=second;room.updated=Date.now();broadcast(room);return json(res,200,{code:room.code,token:second.token,color:2,state:snapshot(room)})}
 const token=req.headers.authorization?.replace(/^Bearer /,'')||(op==='events'?url.searchParams.get('token'):null);const index=room.players.findIndex(p=>p&&p.token===token);if(index<0)fail('身份已失效，请重新加入房间',401);const p=room.players[index];room.updated=Date.now();
 if(op==='events'&&req.method==='GET'){
 if(p.streams.size>=4)fail('打开的对局窗口过多，请关闭多余窗口',429);
 res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');p.streams.add(res);broadcast(room);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);res.on('close',()=>{clearInterval(heartbeat);p.streams.delete(res);room.updated=Date.now();broadcast(room)});return}
 if(op==='state'&&req.method==='GET')return json(res,200,snapshot(room));
 if(op!=='action'||req.method!=='POST')fail('请求方式不支持',405);
 const input=await body(req);const game=room.game;
 if(!room.players.every(x=>x&&x.streams.size))fail('等待双方连接后再操作',409);
 if(input.type==='move'){
 if(room.pending)fail('请先处理对方的请求',409);
 if(game.winner||game.draw)fail('本局已结束',409);
 if(game.turn!==index+1)fail('还没轮到你',409);
 if(!Number.isInteger(input.row)||!Number.isInteger(input.col)||input.row<0||input.row>14||input.col<0||input.col>14)fail('落子坐标无效');
 if(!game.play(input.row,input.col))fail('这里已有棋子',409);
 if(room.startedAt===null)room.startedAt=Date.now();
 if(game.winner||game.draw){room.elapsed=Date.now()-room.startedAt;room.startedAt=null}
 }else if(input.type==='request'){
 if(room.pending)fail('已有请求等待处理',409);
 if(!['undo','restart'].includes(input.kind))fail('请求类型无效');
 if(!game.history.length)fail('当前没有可撤回的棋局',409);
 room.pending={kind:input.kind,by:index+1};
 }else if(input.type==='respond'){
 if(!room.pending)fail('没有待处理的请求',409);
 if(room.pending.by===index+1)fail('请等待对方回应',409);
 if(typeof input.accept!=='boolean')fail('回应无效');
 if(input.accept){if(room.pending.kind==='restart'){game.reset();room.startedAt=null;room.elapsed=0}else{const ended=game.winner||game.draw;game.undo();if(ended)room.startedAt=Date.now()-room.elapsed;if(!game.history.length){room.startedAt=null;room.elapsed=0}}}room.pending=null;
 }else if(input.type==='cancel'){if(!room.pending||room.pending.by!==index+1)fail('没有可取消的请求',409);room.pending=null}else fail('未知操作');
 broadcast(room);return json(res,200,snapshot(room));
 }catch(error){if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'服务暂时不可用，请重试'});else res.end()}});
 const cleanup=setInterval(()=>{const now=Date.now();for(const [code,room]of rooms)if(now-room.updated>6*3600000&&!room.players.some(p=>p?.streams.size))rooms.delete(code);for(const [ip,rate]of limits)if(now-rate.at>60000)limits.delete(ip)},60000);cleanup.unref();server.on('close',()=>clearInterval(cleanup));return server;
}
if(require.main===module){const port=Number(process.env.PORT||3210);const server=createServer();server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`端口 ${port} 已被使用，请关闭已运行的五子棋窗口或设置 PORT。`:e.message);process.exit(1)});server.listen(port,'0.0.0.0',()=>{console.log(`五子棋已启动\n本机：http://localhost:${port}`);for(const x of Object.values(os.networkInterfaces()).flat())if(x.family==='IPv4'&&!x.internal)console.log(`局域网：http://${x.address}:${port}`);console.log('保持此窗口开启；按 Ctrl+C 停止。')})}
module.exports={createServer};
