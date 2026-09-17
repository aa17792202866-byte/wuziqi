const $=id=>document.getElementById(id);
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node};
const difficultyLabels={easy:'简单',normal:'普通',hard:'困难'};
const labels={ai:'人机对战中',idle:'空闲',waiting:'等待对手',preparing:'准备中',playing:'对局中',ended:'对局结束',reconnecting:'连接中'};
const resultLabels={win:'胜',loss:'负',draw:'平',restart:'重开'};
const reasonLabels={five:'五子连线',resign:'投降',draw:'棋盘下满 · 平局',restart:'双方同意重开'};
const kindLabels={swap:'交换先手',undo:'撤回最近一步',restart:'重新开始'};
let state=null,view='auth',source=null,connected=false,busy=false,registering=false,lastNotification=0,clockOffset=0,retryPayload=null;
let historyPage=1,historyGeneration=0,replay=null,replayIndex=0,playTimer=null,toastTimer=null;
let authGeneration=0;
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('gomoku-auth'):null;
channel?.addEventListener('message',()=>initialize());
function showError(text,retry=false){$('error').hidden=!text;$('error-text').textContent=text||'';$('retry').hidden=!retry}
function toast(text){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,6500)}
async function api(url,data){
 const response=await fetch(url,{method:data===undefined?'GET':'POST',credentials:'same-origin',headers:data===undefined?{}:{'Content-Type':'application/json','X-Gomoku-Request':'1'},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const value=await response.json();if(!response.ok){const error=new Error(value.error||'请求失败');error.status=response.status;throw error}return value;
}
function operationId(){return 'op-'+Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,'0')).join('')}
async function act(input,retrying=false){
 if(busy)return false;
 const room=state?.room;
 const payload=retrying?input:{...input,opId:operationId(),...(room?{roomCode:room.code,gameId:room.game.id,version:room.version}:{})};
 busy=true;showError('');render();
 try{applyState(await api('/api/action',payload));retryPayload=null;return true}
 catch(e){if(e.status===401){loggedOut();showError(e.message)}else{const recoverable=!e.status||e.status===503;retryPayload=recoverable?payload:null;showError(e.message||'连接失败，请重试',recoverable);if(e.status===409)await refreshState()}return false}
 finally{busy=false;render()}
}
async function refreshState(){try{applyState(await api('/api/state'))}catch(e){if(e.status===401)loggedOut()}}
function applyState(next){
 if(state&&next.me?.id===state.me.id&&next.revision<state.revision)return;
 const previousRoom=state?.room?.code;
 if(!state||state.me.id!==next.me.id){lastNotification=next.notifications[0]?.id||0;state=null}
 state=next;clockOffset=next.serverTime-Date.now();
 const notification=next.notifications.find(n=>n.id>lastNotification);if(notification)toast(notification.message);lastNotification=Math.max(lastNotification,next.notifications[0]?.id||0);
 if(view==='auth')view=next.room?'room':'lobby';
 else if(!previousRoom&&next.room&&['lobby','ai'].includes(view))view='room';
 if(view==='room'&&!next.room)view='lobby';
 render();
}
function openStream(){
 source?.close();const current=new EventSource('/api/events');source=current;
 current.onmessage=e=>{if(source!==current)return;connected=true;applyState(JSON.parse(e.data))};
 current.addEventListener('expired',()=>{if(source===current){loggedOut();showError('登录已失效，请重新登录。')}});
 current.onerror=async()=>{if(source!==current)return;connected=false;render();try{await api('/api/state')}catch(e){if(e.status===401&&source===current){loggedOut();showError('登录已失效，请重新登录。')}}};
}
function loggedOut(){source?.close();source=null;state=null;connected=false;view='auth';lastNotification=0;retryPayload=null;stopPlayback();$('nickname-dialog').close();render()}
async function initialize(){const generation=++authGeneration;source?.close();source=null;connected=false;state=null;try{const next=await api('/api/session');if(generation!==authGeneration)return;if(!next){loggedOut();return}applyState(next);openStream()}catch(e){if(generation!==authGeneration)return;loggedOut();if(e.status!==401)showError('无法连接网站，请确认启动窗口仍在运行。')}}
function navigate(next){if(next==='room'&&!state?.room)return;view=next;stopPlayback();render();if(next==='history')loadHistory();window.scrollTo({top:0,behavior:'instant'})}
function button(text,handler,disabled=false,reason=''){const b=el('button',text);b.type='button';b.disabled=disabled||busy;b.title=disabled?reason:'';b.onclick=handler;return b}
function disable(id,value,reason=''){const node=$(id);node.disabled=!!value||busy;node.title=node.disabled?reason:''}
function name(player){return player?.nickname||'等待加入'}
function dateText(time){return new Date(time).toLocaleString('zh-CN',{hour12:false})}
function duration(ms){const seconds=Math.max(0,Math.floor(ms/1000));return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')}
function endText(game){if(game.reason==='restart')return game.mode==='ai'?'玩家重新开始':'双方同意重开';if(game.reason==='draw')return '棋逢对手，平局';const winner=game.winner===1?'黑方':'白方';return game.reason==='resign'?(game.winner===1?'白方':'黑方')+'投降，'+winner+'获胜':winner+'获胜！'}
function render(){
 for(const page of ['auth','ai','lobby','room','history','replay'])$(page+'-view').hidden=page!==view;
 $('nav').hidden=$('account-bar').hidden=!state;$('guest-label').hidden=!!state;
 $('current-room').hidden=!state?.room;
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===view));
 $('connection').hidden=!state;$('connection').textContent=state?.storageError?'保存暂时不可用，未确认操作请稍后重试，旧棋局已保留。':connected?'已连接 · 状态实时同步':'连接中…自动恢复后即可继续操作';
 if(!state){$('incoming-alert').hidden=true;return;}
 const incoming=state.invitations.filter(i=>i.recipient===state.me.id).length;
 $('incoming-alert').hidden=!incoming||view==='lobby';$('incoming-text').textContent='收到 '+incoming+' 条对战邀请';
 $('nickname-button').textContent=state.me.nickname;
 renderLobby();if(state.room)renderRoom();
}
function renderLobby(){
 $('online-count').textContent=state.players.filter(p=>p.online).length+' 位在线';
 const list=$('player-list');list.replaceChildren();
 for(const player of state.players){const row=el('div',undefined,'player-row');const own=player.id===state.me.id;row.append(el('span',Array.from(player.nickname)[0],'avatar'));const details=el('div',undefined,'details');details.append(el('div',player.nickname+(own?'（你）':''),'player-name'),el('small',labels[player.status]));row.append(details);
  if(!own){const reason=!connected?'等待连接恢复':state.room?'请先离开当前房间':player.status!=='idle'?'对方当前不可邀请':state.invitations.some(i=>i.sender===state.me.id)?'请先处理已发出的邀请':'';row.append(button('邀请对战',()=>act({type:'invite',target:player.id}),!!reason,reason))}list.append(row)
 }
 if(!state.players.length)list.append(el('p','正在获取在线棋友…','empty'));
 if(state.players.length===1)list.append(el('p','还没有其他棋友在线。\n让好友打开下方局域网地址并登录。','empty'));
 disable('open-ai',!connected||!!state.room,'请先离开当前房间');
 disable('create-room',!connected||!!state.room,'请连接后操作；已有房间时请先离开');$('join-form').querySelector('button').disabled=busy||!connected||!!state.room;
 $('lobby-room-note').textContent=state.room?'你正在房间 '+state.room.code+'，可点击顶部「当前对局」返回。':'';
 const invites=$('invite-list');invites.replaceChildren();
 for(const inv of state.invitations){const own=inv.sender===state.me.id;const box=el('div',undefined,'invite-item');box.append(el('p',own?'邀请 '+inv.recipientName+' 对战':inv.senderName+' 邀请你对战'));const time=el('p',undefined,'small muted');time.dataset.expires=inv.expires_at;box.append(time);const actions=el('div',undefined,'button-grid');if(own)actions.append(button('撤回',()=>act({type:'invitation',id:inv.id,answer:'cancel'}),!connected));else actions.append(button('接受',()=>act({type:'invitation',id:inv.id,answer:'accept'}),!connected),button('拒绝',()=>act({type:'invitation',id:inv.id,answer:'reject'}),!connected));box.append(actions);invites.append(box)}
 if(!state.invitations.length)invites.append(el('p','暂无待处理邀请','muted'));tick();
}
function renderRoom(){
 const r=state.room,g=r.game,both=r.players.every(p=>p?.online),preparing=r.phase==='preparing',playing=r.phase==='playing',ended=r.phase==='ended',ai=r.mode==='ai';
 $('room-code-label').textContent=(ai?'人机 · '+difficultyLabels[r.difficulty]:'房间 '+r.code)+' / 你执'+(r.myColor===1?'黑':'白');$('room-heading').textContent=ai?'人机对战':labels[r.phase];
 $('phase').textContent=ended?'本局结束':preparing?'双方准备后开局':playing&&r.turn===r.myColor?'轮到你了':'静候好棋';
 $('game-status').textContent=ai&&playing&&r.turn!==r.myColor?'电脑思考中':ended?endText(g):r.phase==='waiting'?'等待好友加入':!both?'等待对手连接':preparing?'准备好了吗？':(r.turn===1?'黑方':'白方')+'落子';
 $('game-hint').textContent=r.aiError?r.aiError:ai&&playing&&r.turn!==r.myColor?'电脑正在计算下一手，可悔棋或主动投降。':ended?'棋谱已保存，可复盘或邀请对方再来一局。':r.phase==='waiting'?'把六位房间码发给好友，即可相约。':!both?'双方连接后继续；对局中仍可主动投降。':r.pending?'请先处理申请，再继续对弈。':preparing?'可在开局前交换先手，交换后需重新准备。':r.turn===r.myColor?'点击空白交叉点落子。':'对方正在思考。';
 const players=$('room-players');players.replaceChildren();r.players.forEach((p,index)=>{const row=el('div',undefined,'room-player'+(playing&&r.turn===index+1?' active':''));row.append(el('span',undefined,'stone '+(index===0?'black':'white')));const text=el('div');text.append(el('p',name(p)+(p?.id===state.me.id?'（你）':'')),el('small',(index===0?'黑棋 · 先手':'白棋 · 后手')+' / '+(!p?'空位':!p.online?'离线':preparing?(r.ready[index]?'已准备':'未准备'):'在线')));row.append(text);players.append(row)});
 $('moves').textContent=String(g.history.length).padStart(2,'0');const last=g.history.at(-1);$('last-move').textContent=last?`上一手 · ${last.row+1}行 ${last.col+1}列`:'等待第一手';
 $('prepare-controls').hidden=!preparing;$('game-controls').hidden=!playing&&!ended;
 $('ready').textContent=r.ready[r.myColor-1]?'取消准备':'准备';disable('ready',!connected||!both||!!r.pending,'双方在线且无待处理申请时才可准备');
 $('swap').textContent=r.myColor===1?'让对方先手':'申请先手';disable('swap',!connected||!both||(!!r.pending&&r.myColor!==1),'等待双方在线或申请处理完成');
 disable('undo',!connected||!both||!playing||(ai?!g.history.some(m=>m.color===r.myColor):!g.history.length)||!!r.pending,ai?'没有可撤回的玩家落子，电脑开局落子不可单独撤回':'仅对局中有落子且无待处理申请时可悔棋');
 $('restart').textContent=ai&&ended?'再来一局':'重新开始';$('retry-ai').hidden=!r.aiError;disable('retry-ai',!connected); 
 $('leave-room').textContent=ai?'返回大厅':'离开房间';
 document.querySelector('.rules p:last-child').textContent=ai?'悔棋恢复到你上次落子之前。重新开始只需自己确认。':'悔棋与重开需要对方同意。投降由自己确认，立即结束本局。';
 if(ai&&ended)$('game-hint').textContent='棋谱已保存，可复盘、再来一局或返回大厅调整设置。';
 disable('restart',!connected||!both||!!r.pending,'双方在线且无待处理申请时可请求重开');
 $('resign').hidden=!playing;disable('resign',!connected,'等待自己的连接恢复');$('view-result').hidden=!ended;
 disable('leave-room',!connected,'等待连接恢复');
 $('request-box').hidden=!r.pending;if(r.pending){const own=r.pending.by===state.me.id;$('request-text').textContent=(own?'已向对方申请':'对方申请')+kindLabels[r.pending.kind]+'。';const expiry=el('span',undefined,'small muted');expiry.dataset.expires=r.pending.expiresAt;$('request-text').append(document.createElement('br'),expiry);$('accept').hidden=$('reject').hidden=own;$('cancel-request').hidden=!own;for(const id of ['accept','reject'])disable(id,!connected||!both,'双方在线后才能处理');disable('cancel-request',!connected,'连接恢复后可撤回')}
 drawBoard(boardCells,g.board,g.history,g.line,canPlay(),$('numbers').checked);tick();
}
function canPlay(){const r=state?.room;return !!r&&connected&&!busy&&r.phase==='playing'&&!r.pending&&r.turn===r.myColor&&r.players.every(p=>p?.online)}
function makeBoard(container,replaying){const cells=[];for(let row=0;row<15;row++){const rowNode=el('div',undefined,'grid-row');rowNode.setAttribute('role','row');container.append(rowNode);for(let col=0;col<15;col++){
 const cell=el('button');cell.type='button';cell.className='cell'+(row===0?' top':'')+(row===14?' bottom':'')+(col===0?' left':'')+(col===14?' right':'')+([[3,3],[3,11],[7,7],[11,3],[11,11]].some(([r,c])=>r===row&&c===col)?' star':'');cell.setAttribute('role','gridcell');cell.tabIndex=!replaying&&row===7&&col===7?0:-1;
 if(!replaying){cell.onclick=()=>{if(canPlay()&&!state.room.game.board[row*15+col])act({type:'move',row,col,ply:state.room.game.history.length})};cell.onkeydown=e=>{const delta={ArrowLeft:[0,-1],ArrowRight:[0,1],ArrowUp:[-1,0],ArrowDown:[1,0]}[e.key];if(!delta)return;e.preventDefault();const next=Math.max(0,Math.min(14,row+delta[0]))*15+Math.max(0,Math.min(14,col+delta[1]));cells.forEach(c=>c.tabIndex=-1);cells[next].tabIndex=0;cells[next].focus()}}
 cells.push(cell);rowNode.append(cell);
 }}return cells}
function drawBoard(cells,board,moves,line,enabled,numbers){const order=new Map(moves.map((m,i)=>[m.row*15+m.col,i+1]));const last=moves.at(-1);cells.forEach((cell,i)=>{const color=board[i],key=color+':'+(numbers?order.get(i):'');if(cell.dataset.piece!==key){cell.dataset.piece=key;cell.replaceChildren();if(color)cell.append(el('span',numbers?String(order.get(i)):'','stone '+(color===1?'black':'white')))}cell.classList.toggle('occupied',!!color);cell.classList.toggle('latest',!!last&&i===last.row*15+last.col);cell.classList.toggle('winner',line.includes(i));cell.setAttribute('aria-label',`${Math.floor(i/15)+1}行${i%15+1}列，${color?(color===1?'黑棋':'白棋'):'空位'}`);cell.setAttribute('aria-disabled',String(!enabled||!!color))});$('board').classList.toggle('show-numbers',$('numbers').checked)}
const boardCells=makeBoard($('board'),false),replayCells=makeBoard($('replay-board'),true);
function tick(){const now=Date.now()+clockOffset;document.querySelectorAll('[data-expires]').forEach(node=>node.textContent=Math.max(0,Math.ceil((Number(node.dataset.expires)-now)/1000))+' 秒后过期');const g=state?.room?.game;if(g)$('time').textContent=g.startedAt===null?'00:00':duration((g.endedAt||now)-g.startedAt)}
async function loadHistory(){const generation=++historyGeneration;const list=$('history-list');list.replaceChildren(el('p','正在读取棋谱…','empty'));try{const result=await api(`/api/history?page=${historyPage}&result=${$('history-filter').value}&mode=${$('history-mode').value}`);if(generation!==historyGeneration)return;list.replaceChildren();for(const match of result.items){const row=el('article',undefined,'card history-item');row.append(el('span',resultLabels[match.result],'result-badge '+match.result));const content=el('div',undefined,'history-content');const other=match.participants.find(p=>p.id!==state.me.id);content.append(el('strong','对阵 '+name(other)+(match.mode==='ai'?' · '+difficultyLabels[match.difficulty]:' · 联机')),el('p',`${dateText(match.startedAt)} · ${match.color===1?'执黑':'执白'} · ${match.moves} 手`),el('p',(match.mode==='ai'&&match.reason==='restart'?'玩家重新开始':reasonLabels[match.reason])+' · 用时 '+duration(match.endedAt-match.startedAt)));row.append(content,button('复盘',()=>openReplay(match.id)));list.append(row)}if(!result.items.length)list.append(el('p','这里还没有棋谱。完成一局后，就能回来复盘。','card empty'));$('history-page').textContent=`第 ${result.page} / ${result.pages} 页 · 共 ${result.total} 局`;$('history-prev').disabled=result.page<=1;$('history-next').disabled=result.page>=result.pages}catch(e){list.replaceChildren(el('p','读取失败，可切换筛选或重新进入此页重试。','empty'));showError(e.message)}}
async function openReplay(id){try{replay=await api('/api/history/'+id);replayIndex=0;navigate('replay');$('replay-title').textContent=name(replay.participants[0])+' vs '+name(replay.participants[1]);$('replay-meta').textContent=dateText(replay.startedAt)+' · 共 '+replay.history.length+' 手 · '+(replay.mode==='ai'?'人机 · '+difficultyLabels[replay.difficulty]+' · ':'')+(replay.mode==='ai'&&replay.reason==='restart'?'玩家重新开始':reasonLabels[replay.reason]);$('replay-range').max=replay.history.length;const list=$('replay-moves');list.replaceChildren();replay.history.forEach((m,i)=>list.append(button(`${i+1}. ${m.color===1?'黑':'白'} ${m.row+1},${m.col+1}`,()=>setReplayStep(i+1))));const events=$('replay-events');events.replaceChildren();const eventLabels={start:'开始对局',undo:'悔棋',five:'五子连线结束',resign:'投降',draw:'平局',restart:'双方重开'};for(const event of replay.events.filter(e=>e.type!=='move'))events.append(el('p',dateText(event.at)+' · '+(eventLabels[event.type]||event.type)));renderReplay()}catch(e){showError(e.message)}}
function renderReplay(){if(!replay)return;const moves=replay.history.slice(0,replayIndex),board=Array(225).fill(0);for(const m of moves)board[m.row*15+m.col]=m.color;const terminal=replayIndex===replay.history.length;drawBoard(replayCells,board,moves,terminal?replay.line:[],false,true);$('replay-step').textContent=`第 ${replayIndex} / ${replay.history.length} 手`;$('replay-range').value=replayIndex;$('replay-result').textContent=terminal?endText(replay):'棋局回放';const last=moves.at(-1);$('replay-current').textContent=last?`${last.color===1?'黑':'白'}方 · ${last.row+1}行 ${last.col+1}列 · ${dateText(last.at)}`:'开局，黑棋先行';$('replay-first').disabled=$('replay-prev').disabled=replayIndex===0;$('replay-last').disabled=$('replay-next').disabled=terminal;$('replay-play').disabled=!replay.history.length;$('replay-moves').querySelectorAll('button').forEach((b,i)=>b.classList.toggle('selected',i===replayIndex-1))}
function stopPlayback(){clearInterval(playTimer);playTimer=null;$('replay-play').textContent='播放'}
function setReplayStep(step,automatic=false){if(!automatic)stopPlayback();replayIndex=Math.max(0,Math.min(replay.history.length,step));renderReplay();if(replayIndex===replay.history.length)stopPlayback()}
function startPlayback(){if(playTimer){stopPlayback();return}if(!replay.history.length)return;if(replayIndex===replay.history.length)setReplayStep(0);$('replay-play').textContent='暂停';playTimer=setInterval(()=>setReplayStep(replayIndex+1,true),Number($('replay-speed').value))}
function setAuthMode(register){registering=register;$('register-tab').classList.toggle('selected',register);$('login-tab').classList.toggle('selected',!register);$('nickname-field').hidden=$('confirm-field').hidden=!register;$('nickname').required=$('confirm-password').required=register;$('auth-title').textContent=register?'创建你的棋手账号':'欢迎回来';$('auth-description').textContent=register?'同一账号，留住每一局棋谱。':'登录后，在大厅与好友相遇。';$('password').autocomplete=register?'new-password':'current-password';$('auth-submit').textContent=register?'注册并进入大厅':'登录并进入大厅';showError('')}
$('login-tab').onclick=()=>setAuthMode(false);$('register-tab').onclick=()=>setAuthMode(true);
$('auth-form').onsubmit=async e=>{e.preventDefault();if(busy)return;if(registering&&$('password').value!==$('confirm-password').value){showError('两次输入的密码不一致');return}busy=true;$('auth-submit').disabled=true;showError('');try{const next=await api(registering?'/api/register':'/api/login',{account:$('account').value,nickname:$('nickname').value,password:$('password').value,confirmPassword:$('confirm-password').value});state=null;applyState(next);openStream();$('password').value=$('confirm-password').value='';channel?.postMessage('changed')}catch(error){showError(error.message)}finally{busy=false;$('auth-submit').disabled=false;render()}};
$('logout').onclick=async()=>{const playing=state?.room?.phase==='playing';if(playing&&!confirm('退出登录将按投降处理，确认退出？'))return;try{await api('/api/logout',{confirmed:playing});loggedOut();channel?.postMessage('changed')}catch(e){showError(e.message)}};
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>navigate(b.dataset.view);
$('open-invites').onclick=()=>navigate('lobby');
$('create-room').onclick=()=>act({type:'create'});$('join-form').onsubmit=e=>{e.preventDefault();act({type:'join',code:$('room-code').value.trim()})};
$('leave-room').onclick=()=>{const playing=state.room.phase==='playing';if(!confirm(playing?'离开将按投降处理，确认离开？':'确认离开当前房间？'))return;act({type:'leave',confirmed:playing})};
$('ready').onclick=()=>act({type:'ready',ready:!state.room.ready[state.room.myColor-1]});$('swap').onclick=()=>act(state.room.myColor===1?{type:'swap'}:{type:'request',kind:'swap'});
$('undo').onclick=()=>act(state.room.mode==='ai'?{type:'undo-ai'}:{type:'request',kind:'undo'});$('restart').onclick=()=>{if(state.room.mode==='ai'){if(confirm('确认重新开始？当前进行中的棋局将作为重开结束保存。'))act({type:'restart-ai',confirmed:true})}else act({type:'request',kind:'restart'})};
$('resign').onclick=()=>{if(confirm('确认投降？确认后本局立即结束，对方获胜。'))act({type:'resign',confirmed:true})};
$('accept').onclick=()=>act({type:'respond',requestId:state.room.pending.id,accept:true});$('reject').onclick=()=>act({type:'respond',requestId:state.room.pending.id,accept:false});$('cancel-request').onclick=()=>act({type:'cancel',requestId:state.room.pending.id});$('numbers').onchange=render;
$('view-result').onclick=()=>openReplay(state.room.game.id);$('history-mode').onchange=()=>{historyPage=1;loadHistory()};$('history-filter').onchange=()=>{historyPage=1;loadHistory()};$('history-prev').onclick=()=>{historyPage--;loadHistory()};$('history-next').onclick=()=>{historyPage++;loadHistory()};$('back-history').onclick=()=>navigate('history');
$('replay-first').onclick=()=>setReplayStep(0);$('replay-prev').onclick=()=>setReplayStep(replayIndex-1);$('replay-next').onclick=()=>setReplayStep(replayIndex+1);$('replay-last').onclick=()=>setReplayStep(replay.history.length);$('replay-range').oninput=e=>setReplayStep(Number(e.target.value));$('replay-play').onclick=startPlayback;$('replay-speed').onchange=()=>{if(playTimer){stopPlayback();startPlayback()}};
window.addEventListener('keydown',e=>{if(view==='replay'&&!['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();setReplayStep(replayIndex+(e.key==='ArrowRight'?1:-1))}});
$('nickname-button').onclick=()=>{$('new-nickname').value=state.me.nickname;$('nickname-dialog').showModal()};$('close-nickname').onclick=()=>$('nickname-dialog').close();$('nickname-form').onsubmit=async e=>{e.preventDefault();if(await act({type:'profile',nickname:$('new-nickname').value}))$('nickname-dialog').close()};
$('dismiss-error').onclick=()=>showError('');$('retry').onclick=()=>{if(retryPayload)act(retryPayload,true)};
api('/api/info').then(info=>{for(const address of info.addresses){const link=el('a',address);link.href=address;$('lan-addresses').append(link)}}).catch(()=>{});
setInterval(tick,500);setAuthMode(false);render();initialize();



$('open-ai').onclick=()=>navigate('ai');$('ai-back').onclick=()=>navigate('lobby');$('ai-form').onsubmit=async e=>{e.preventDefault();await act({type:'create-ai',difficulty:$('ai-difficulty').value,color:$('ai-color').value})};$('retry-ai').onclick=()=>act({type:'retry-ai'});

