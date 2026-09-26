const {Worker}=require('node:worker_threads');
const path=require('node:path');
const {tactical}=require('./ai');
class AIManager{
 constructor(service){this.service=service;this.jobs=new Map();this.errors=new Map();this.closed=false}
 signature(room){return room.game.id+':'+room.version+':'+room.game.history.length}
 sync(){if(this.closed)return;const rooms=this.service.store.rooms().filter(r=>r.mode==='ai'&&r.phase==='playing'&&r.game.history.length%2+1!==r.humanColor);
  for(const [code,job]of this.jobs){const r=rooms.find(r=>r.code===code);if(!r||this.signature(r)!==job.key){clearTimeout(job.timer);job.worker.terminate();this.jobs.delete(code);this.errors.delete(code)}}
  for(const room of rooms){const id=room.players[room.humanColor-1];if(!this.service.online(id)||this.errors.has(room.code))continue;const existing=this.jobs.get(room.code);if(existing){if(existing.result!==undefined)this.commit(room,existing);continue}if([...this.jobs.values()].filter(job=>job.result===undefined).length>=2)continue;
   const job={key:this.signature(room),worker:new Worker(path.join(__dirname,'ai-worker.js'),{workerData:{board:room.game.board,color:3-room.humanColor,difficulty:room.difficulty}})};this.jobs.set(room.code,job);
   const complete=index=>{if(this.jobs.get(room.code)!==job||job.result!==undefined)return;clearTimeout(job.timer);job.worker.terminate();const fresh=this.service.store.room(room.code);if(!fresh||this.signature(fresh)!==job.key)return;
    if(!Number.isInteger(index)||index<0||index>224||fresh.game.board[index])index=tactical(fresh.game.board,3-fresh.humanColor)??fresh.game.board.findIndex(v=>!v);
    job.result=index;if(this.service.online(id))this.commit(fresh,job);
   };
   job.worker.once('message',result=>complete(result.index));job.worker.once('error',()=>complete(-1));job.worker.once('exit',()=>complete(-1));job.timer=setTimeout(()=>complete(-1),2400);
  }
 }
 commit(room,job){try{this.service.changed(()=>{const fresh=this.service.store.room(room.code);if(!fresh||this.signature(fresh)!==job.key||!this.service.online(fresh.players[fresh.humanColor-1]))return;this.service.place(fresh,Math.floor(job.result/15),job.result%15,3-fresh.humanColor,'computer');this.service.store.saveRoom(fresh)});this.jobs.delete(room.code);this.errors.delete(room.code)}catch{this.jobs.delete(room.code);this.errors.set(room.code,'电脑落子保存失败，棋局已保留，请重试。');this.service.broadcast()}}
 retry(code){this.errors.delete(code)}
 close(){this.closed=true;for(const j of this.jobs.values()){clearTimeout(j.timer);j.worker.terminate()}this.jobs.clear()}
}
module.exports={AIManager};

