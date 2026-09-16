const {DatabaseSync,backup}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

async function main(){
 const source=path.resolve(process.env.GOMOKU_DB||path.join(__dirname,'..','data','gomoku.sqlite'));
 if(!fs.existsSync(source))throw new Error('数据库尚不存在，请先启动网站。');
 const target=path.resolve(process.argv[2]||path.join(__dirname,'..','backups',`gomoku-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomBytes(3).toString('hex')}.sqlite`));
 if(source===target||fs.existsSync(target))throw new Error('备份目标已存在，请使用新的文件名。');
 fs.mkdirSync(path.dirname(target),{recursive:true});
 const db=new DatabaseSync(source,{readOnly:true,timeout:5000});
 try{await backup(db,target);const copied=new DatabaseSync(target,{readOnly:true});try{const result=copied.prepare('PRAGMA integrity_check').get();if(result.integrity_check!=='ok')throw new Error('备份完整性检查未通过。')}finally{copied.close()}console.log('备份完成：'+target)}finally{db.close()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
