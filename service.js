const {randomUUID,randomInt,createHash}=require('node:crypto');
const Game=require('./dist/game');
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status})};
const newGame=()=>({id:randomUUID(),board:Array(225).fill(0),history:[],winner:0,line:[],draw:false,startedAt:null,endedAt:null,reason:null,events:[],participants:[]});
function engine(game){return Object.assign(new Game(),game)}

class Service {
 constructor(store,options={}){
  this.store=store;this.connections=new Map();this.lastSeen=new Map();this.now=options.now||Date.now;this.inviteTTL=options.inviteTTL||30000;this.offlineGrace=options.offlineGrace??10000;this.storageError=false;
  store.transaction(()=>{for(const room of store.rooms()){room.ready=[false,false];room.pending=null;store.saveRoom(room)}store.run("UPDATE invitations SET status='expired' WHERE status='pending'")});
 }
 online(id){return !!this.connections.get(id)?.size}
 status(id){if(!this.online(id))return 'reconnecting';return this.store.roomFor(id)?.phase||'idle'}
 both(room){return room.players.every(id=>id&&this.online(id))}
 snapshot(id){
  const s=this.store,room=s.roomFor(id),now=this.now();
  const players=[...new Set([...this.connections.keys(),...this.lastSeen.keys()])].filter(uid=>this.online(uid)||now-(this.lastSeen.get(uid)||0)<this.offlineGrace).map(uid=>({...s.player(uid),status:this.status(uid),online:this.online(uid)})).filter(u=>u.id).sort((a,b)=>(a.status==='idle'?0:1)-(b.status==='idle'?0:1)||a.nickname.localeCompare(b.nickname));
  const invitations=s.all("SELECT i.*,a.nickname AS senderName,b.nickname AS recipientName FROM invitations i JOIN users a ON a.id=i.sender JOIN users b ON b.id=i.recipient WHERE (sender=? OR recipient=?) AND status='pending'",id,id);
  const result={revision:s.revision,serverTime:now,me:s.user(id),players,invitations,room:null,notifications:s.all('SELECT id,message,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 15',id),storageError:this.storageError};
  if(room)result.room={...room,players:room.players.map(uid=>uid?{...s.player(uid),online:this.online(uid)}:null),myColor:room.players.indexOf(id)+1,turn:room.game.history.length%2+1};
  return result;
 }
 broadcast(){for(const [id,connections]of this.connections){let data;try{data='data: '+JSON.stringify(this.snapshot(id))+'\n\n'}catch{continue}for(const c of connections){if(!c.res.destroyed)c.res.write(data)}}}
 changed(fn){try{const result=this.store.transaction(fn);this.storageError=false;this.broadcast();return result}catch(e){if(!e.status){this.storageError=true;this.broadcast()}throw e}}
 cancelInvites(id,message){const s=this.store;for(const invite of s.all("SELECT * FROM invitations WHERE (sender=? OR recipient=?) AND status='pending'",id,id)){s.run("UPDATE invitations SET status='cancelled' WHERE id=?",invite.id);s.notify([invite.sender,invite.recipient],message)}}
 connect(id,connection){let connections=this.connections.get(id);if(!connections){connections=new Set();this.connections.set(id,connections)}connections.add(connection);this.lastSeen.delete(id);this.changed(()=>{});}
 disconnect(id,connection){const connections=this.connections.get(id);connections?.delete(connection);if(connections?.size)return;
  this.connections.delete(id);this.lastSeen.set(id,this.now());
  this.changed(()=>{const room=this.store.roomFor(id);if(room&&room.phase==='preparing'){room.ready[room.players.indexOf(id)]=false;if(room.pending){room.pending=null;this.store.notify(room.players,'连接中断，先手申请已取消。')}this.store.saveRoom(room)}});
 }
 sweep(){const s=this.store,now=this.now();const offline=[...this.lastSeen].filter(([,t])=>now-t>=this.offlineGrace);const expired=s.all("SELECT * FROM invitations WHERE status='pending' AND expires_at<=?",now);const pending=s.rooms().filter(r=>r.pending&&r.pending.expiresAt<=now);
  if(!offline.length&&!expired.length&&!pending.length)return;
  this.changed(()=>{for(const [id]of offline)this.cancelInvites(id,'玩家已离线，邀请已取消。');for(const i of expired){s.run("UPDATE invitations SET status='expired' WHERE id=?",i.id);s.notify([i.sender,i.recipient],'对战邀请已过期。')}for(const room of pending){room.pending=null;s.saveRoom(room);s.notify(room.players,'对局申请已过期。')}});
  for(const [id]of offline)this.lastSeen.delete(id);
 }
 createRoom(black,white=null){const s=this.store;if(s.roomFor(black)||(white&&s.roomFor(white)))fail('玩家已进入其他房间');let code;do{code=String(randomInt(100000,1000000))}while(s.room(code));const room={code,players:[black,white],ready:[false,false],phase:white?'preparing':'waiting',pending:null,version:0,game:newGame()};s.saveRoom(room);for(const id of room.players)if(id)this.cancelInvites(id,'玩家已进入房间，其他邀请已取消。');return room}
 finish(room,reason,winner=0,actor=null){
  const s=this.store,g=room.game;if(room.phase!=='playing')fail('本局已经结束或尚未开始');
  g.reason=reason;g.winner=winner;g.endedAt=this.now();g.draw=reason==='draw';if(reason!=='five')g.line=[];
  g.events.push({id:randomUUID(),type:reason,actor,at:this.now()});room.phase='ended';room.pending=null;room.ready=[false,false];
  s.run('INSERT INTO matches VALUES (?,?,?,?,?,?,?,?)',g.id,g.participants[0].id,g.participants[1].id,winner?g.participants[winner-1].id:null,reason,g.startedAt,g.endedAt,JSON.stringify(g));
 }
 leave(id,confirmed){const s=this.store,room=s.roomFor(id);if(!room)return;if(room.phase==='playing'){if(confirmed!==true)fail('离开将按投降处理，请先确认',400);this.finish(room,'resign',room.players.indexOf(id)===0?2:1,id)}const index=room.players.indexOf(id);room.players[index]=null;room.ready=[false,false];room.pending=null;
  if(!room.players.some(Boolean)){s.run('DELETE FROM rooms WHERE code=?',room.code);return}
  if(room.phase!=='ended'){room.phase='waiting';room.game=newGame()}
  s.saveRoom(room);s.notify(room.players,'对方已离开房间。');
 }
 swap(room){room.players.reverse();room.ready=[false,false];room.pending=null;this.store.notify(room.players,'先后手已交换，请重新准备。')}
 action(id,input){
  const s=this.store;if(!input||typeof input!=='object'||!/^[-a-zA-Z0-9_]{12,100}$/.test(input.opId||''))fail('缺少有效操作编号',400);
  const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  this.changed(()=>{
   const previous=s.get('SELECT fingerprint FROM operations WHERE user_id=? AND id=?',id,input.opId);if(previous){if(previous.fingerprint!==fingerprint)fail('操作编号不能重复用于其他请求',400);return}
   this.execute(id,input);
   s.run('INSERT INTO operations VALUES (?,?,?,?)',id,input.opId,fingerprint,this.now());
  });return this.snapshot(id);
 }
 execute(id,input){
  const s=this.store,now=this.now();
  if(input.type==='profile'){const nick=typeof input.nickname==='string'?input.nickname.trim():'';if([...nick].length<2||[...nick].length>20)fail('昵称应为2～20个字符',400);s.run('UPDATE users SET nickname=? WHERE id=?',nick,id);return}
  if(!this.online(id))fail('请等待连接恢复后再操作');
  if(input.type==='create'){if(s.roomFor(id))fail('请先离开当前房间');this.createRoom(id);return}
  if(input.type==='join'){
   if(typeof input.code!=='string'||!/^\d{6}$/.test(input.code))fail('请输入六位房间码',400);const current=s.roomFor(id);if(current){if(current.code===input.code)return;fail('请先离开当前房间')}
   const room=s.room(input.code);if(!room)fail('房间不存在',404);if(room.phase!=='waiting'||room.players.every(Boolean))fail('房间已满或不可加入');const slot=room.players.indexOf(null);room.players[slot]=id;room.phase='preparing';room.ready=[false,false];s.saveRoom(room);this.cancelInvites(id,'玩家已进入房间，邀请已取消。');return;
  }
  if(input.type==='invite'){
   if(typeof input.target!=='string')fail('请选择有效玩家',400);
   if(id===input.target)fail('不能邀请自己');if(s.roomFor(id)||s.roomFor(input.target)||!this.online(input.target)||!s.user(input.target))fail('只能邀请空闲在线玩家');
   if(s.get("SELECT id FROM invitations WHERE (sender=? OR (sender=? AND recipient=?)) AND status='pending'",id,input.target,id))fail('已有待处理邀请，请先处理');
   s.run('INSERT INTO invitations VALUES (?,?,?,?,?,?)',randomUUID(),id,input.target,'pending',now+this.inviteTTL,now);return;
  }
  if(input.type==='invitation'){
   const inv=s.get('SELECT * FROM invitations WHERE id=?',input.id||'');if(!inv||![inv.sender,inv.recipient].includes(id))fail('邀请不存在',404);if(inv.status!=='pending'||inv.expires_at<=now)fail('邀请已失效');
   if(input.answer==='cancel'){if(inv.sender!==id)fail('不能撤回他人的邀请',403);s.run("UPDATE invitations SET status='cancelled' WHERE id=?",inv.id);s.notify([inv.recipient],'对方撤回了邀请。');return}
   if(inv.recipient!==id)fail('请等待对方回应',403);if(!['accept','reject'].includes(input.answer))fail('回应无效',400);
   if(input.answer==='reject'){s.run("UPDATE invitations SET status='rejected' WHERE id=?",inv.id);s.notify([inv.sender],'对方拒绝了邀请。');return}
   if(!this.online(inv.sender)||!this.online(inv.recipient))fail('对方已断线');s.run("UPDATE invitations SET status='accepted' WHERE id=?",inv.id);this.createRoom(inv.sender,inv.recipient);return;
  }
  const room=s.roomFor(id);if(!room)fail('你尚未进入房间');
  if(input.roomCode!==room.code||input.gameId!==room.game.id)fail('棋局已变化，请刷新状态后重试');
  // Resignation and leaving must remain possible after an opponent's recent move.
  if(!['resign','leave'].includes(input.type)&&input.version!==room.version)fail('对局状态已更新，请重试');
  const color=room.players.indexOf(id)+1,g=room.game;
  if(input.type==='leave'){this.leave(id,input.confirmed);return}
  if(input.type==='resign'){if(input.confirmed!==true)fail('请先确认投降',400);this.finish(room,'resign',color===1?2:1,id);s.saveRoom(room);return}
  if(input.type==='cancel'){
   const pending=room.pending;
   if(!pending||pending.id!==input.requestId||pending.expiresAt<=now)fail('申请已失效');
   if(pending.by!==id)fail('不能撤回对方申请',403);
   room.pending=null;s.saveRoom(room);s.notify(room.players,'申请已撤回。');return;
  }
  if(!this.both(room))fail('等待双方连接后再操作');
  if(input.type==='ready'){
   if(room.phase!=='preparing'||room.pending)fail('目前不能准备');if(typeof input.ready!=='boolean')fail('准备状态无效',400);room.ready[color-1]=input.ready;
   if(room.ready.every(Boolean)){room.phase='playing';g.startedAt=now;g.participants=room.players.map(uid=>s.player(uid));g.events.push({id:randomUUID(),type:'start',at:now})}
  }else if(input.type==='swap'){
   if(room.phase!=='preparing'||color!==1)fail('仅准备阶段的先手可直接让先');this.swap(room);
  }else if(input.type==='request'){
   if(room.pending)fail('已有待处理申请');const kind=input.kind;
   if(kind==='swap'){if(room.phase!=='preparing'||color!==2)fail('仅准备阶段的后手可申请先手')}
   else if(kind==='undo'){if(room.phase!=='playing'||!g.history.length)fail('本局不可悔棋')}
   else if(kind==='restart'){if(!['playing','ended'].includes(room.phase))fail('本局尚未开始')}
   else fail('未知申请类型',400);
   room.pending={id:randomUUID(),kind,by:id,expiresAt:now+this.inviteTTL};
  }else if(input.type==='respond'||input.type==='cancel'){
   const pending=room.pending;if(!pending||pending.id!==input.requestId||pending.expiresAt<=now)fail('申请已失效');
   if(input.type==='cancel'){if(pending.by!==id)fail('不能撤回对方申请',403);room.pending=null;s.notify(room.players,'申请已撤回。')}
   else{
    if(pending.by===id)fail('请等待对方回应',403);if(typeof input.accept!=='boolean')fail('回应无效',400);
    if(input.accept){
     if(pending.kind==='swap')this.swap(room);
     if(pending.kind==='undo'){const last=g.history.pop();g.board[last.row*15+last.col]=0;g.events.push({id:randomUUID(),type:'undo',actor:id,removedMove:last.id,at:now});}
     if(pending.kind==='restart'){if(room.phase==='playing')this.finish(room,'restart',0,id);room.game=newGame();room.phase='preparing';room.ready=[false,false]}
     s.notify(room.players,'申请已同意。');
    }else s.notify([pending.by],'对方拒绝了申请。');room.pending=null;
   }
  }else if(input.type==='move'){
   if(room.phase!=='playing'||room.pending)fail('现在不能落子');if(g.history.length%2+1!==color)fail('还没轮到你');if(input.ply!==g.history.length)fail('步数已变化，请重试');
   if(!Number.isInteger(input.row)||!Number.isInteger(input.col)||input.row<0||input.row>14||input.col<0||input.col>14)fail('落子坐标无效',400);
   const game=engine(g);if(!game.play(input.row,input.col))fail('这里已有棋子');Object.assign(g,{board:game.board,history:game.history,winner:game.winner,line:game.line,draw:game.draw});
   Object.assign(g.history.at(-1),{id:randomUUID(),at:now,ply:g.history.length,playerId:id});g.events.push({type:'move',...g.history.at(-1)});
   if(g.winner)this.finish(room,'five',g.winner,id);else if(g.draw)this.finish(room,'draw');
  }else fail('未知操作',400);
  s.saveRoom(room);
 }
 history(id,page=1,result='all'){
  const s=this.store;let where='(black_id=? OR white_id=?)',args=[id,id];
  if(result==='win'){where+=' AND winner_id=?';args.push(id)}
  else if(result==='loss'){where+=' AND winner_id IS NOT NULL AND winner_id!=?';args.push(id)}
  else if(result==='draw'||result==='restart'){where+=' AND reason=?';args.push(result)}
  else if(result!=='all')fail('筛选条件无效',400);
  const total=s.get('SELECT COUNT(*) AS count FROM matches WHERE '+where,...args).count;
  const items=s.all('SELECT payload FROM matches WHERE '+where+' ORDER BY ended_at DESC,id DESC LIMIT 10 OFFSET ?',...args,(page-1)*10).map(row=>{const g=JSON.parse(row.payload);const color=g.participants.findIndex(p=>p.id===id)+1;return {id:g.id,participants:g.participants,color,result:g.reason==='restart'?'restart':g.draw?'draw':g.winner===color?'win':'loss',reason:g.reason,startedAt:g.startedAt,endedAt:g.endedAt,moves:g.history.length}});
  return {items,total,page,pages:Math.max(1,Math.ceil(total/10))};
 }
 replay(id,matchId){const row=this.store.get('SELECT payload FROM matches WHERE id=? AND (black_id=? OR white_id=?)',matchId,id,id);if(!row)fail('对局不存在或无权访问',404);return JSON.parse(row.payload)}
}
module.exports={Service,fail};

