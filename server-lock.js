const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

function acquireServerLock(filename){
 if(filename===':memory:')return ()=>{};
 const lockPath=path.resolve(filename)+'.server.lock';
 fs.mkdirSync(path.dirname(lockPath),{recursive:true});
 const value=JSON.stringify({pid:process.pid,nonce:crypto.randomUUID()});
 for(let attempt=0;attempt<2;attempt++){
  try{const fd=fs.openSync(lockPath,'wx');try{fs.writeFileSync(fd,value)}finally{fs.closeSync(fd)}return ()=>{try{if(fs.readFileSync(lockPath,'utf8')===value)fs.unlinkSync(lockPath)}catch{}}}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   let owner;try{owner=JSON.parse(fs.readFileSync(lockPath,'utf8'))}catch{throw new Error('数据库存在未完成的服务锁，请确认旧服务已停止后检查锁文件。')}
   let running=true;try{process.kill(owner.pid,0)}catch(e){if(e.code==='ESRCH')running=false}
   if(running)throw new Error('此数据库已有五子棋服务运行，请打开已有网站，不要重复启动。');
   fs.unlinkSync(lockPath);
  }
 }
 throw new Error('无法取得数据库服务锁，请稍后重试。');
}
module.exports={acquireServerLock};
