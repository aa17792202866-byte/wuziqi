const crypto=require('node:crypto');
const path=require('node:path');
const {promisify}=require('node:util');
const readline=require('node:readline/promises');
const {Store}=require('../store');

const scrypt=promisify(crypto.scrypt);
const passwordOptions={N:32768,r:8,p:1,maxmem:64*1024*1024};

function normalizeAccount(value){
 const account=String(value||'').trim().toLowerCase();
 if(!/^[a-z0-9_]{4,20}$/.test(account))throw new Error('账号应为 4～20 位字母、数字或下划线。');
 return account;
}
function validateNickname(value){
 const nickname=String(value||'').trim();
 if([...nickname].length<2||[...nickname].length>20)throw new Error('昵称应为 2～20 个字符。');
 return nickname;
}
function validatePassword(value){
 if(typeof value!=='string'||[...value].length<8||[...value].length>64)throw new Error('密码应为 8～64 个字符。');
 return value;
}
async function passwordFields(password){
 validatePassword(password);
 const salt=crypto.randomBytes(16).toString('hex');
 return {salt,passwordHash:(await scrypt(password,salt,64,passwordOptions)).toString('hex')};
}
async function createUser(store,{account,nickname,password}){
 account=normalizeAccount(account);nickname=validateNickname(nickname);
 if(store.get('SELECT id FROM users WHERE account=?',account))throw new Error('该账号已存在。');
 const {salt,passwordHash}=await passwordFields(password);const id=crypto.randomUUID();
 store.transaction(()=>store.run('INSERT INTO users VALUES (?,?,?,?,?,?)',id,account,nickname,passwordHash,salt,Date.now()));
 return {id,account,nickname};
}
async function resetPassword(store,{account,password}){
 account=normalizeAccount(account);
 const user=store.get('SELECT id,account,nickname FROM users WHERE account=?',account);
 if(!user)throw new Error('没有找到该账号。');
 const {salt,passwordHash}=await passwordFields(password);
 store.transaction(()=>{
  store.run('UPDATE users SET password_hash=?,salt=? WHERE id=?',passwordHash,salt,user.id);
  store.run('DELETE FROM sessions WHERE user_id=?',user.id);
 });
 return user;
}
async function ask(text){
 const rl=readline.createInterface({input:process.stdin,output:process.stdout});
 try{return await rl.question(text)}finally{rl.close()}
}
function askSecret(text){
 if(!process.stdin.isTTY||typeof process.stdin.setRawMode!=='function')throw new Error('请在 PowerShell 或命令提示符窗口中运行，以便安全输入密码。');
 return new Promise((resolve,reject)=>{
  let value='';const input=process.stdin,output=process.stdout;
  const finish=error=>{input.off('data',onData);input.setRawMode(false);input.pause();output.write('\n');error?reject(error):resolve(value)};
  const onData=chunk=>{for(const char of chunk.toString('utf8')){
   if(char==='\u0003')return finish(new Error('操作已取消。'));
   if(char==='\r'||char==='\n')return finish();
   if(char==='\u007f'||char==='\b'){if(value){value=value.slice(0,-1);output.write('\b \b')}continue}
   if(char>=' '){value+=char;output.write('•')}
  }};
  output.write(text);input.setRawMode(true);input.resume();input.on('data',onData);
 });
}
async function newPassword(){
 const password=await askSecret('新密码（8～64 个字符）：');
 const confirmation=await askSecret('再次输入新密码：');
 if(password!==confirmation)throw new Error('两次输入的密码不一致。');
 return validatePassword(password);
}
async function main(){
 const command=process.argv[2];
 if(!['create','reset'].includes(command)){console.log('用法：\n  npm run user:create\n  npm run user:reset -- <账号>');return}
 const filename=process.env.GOMOKU_DB||path.join(__dirname,'..','data','gomoku.sqlite');
 const store=new Store(filename);
 try{
  if(command==='create'){
   const account=await ask('账号：'),nickname=await ask('昵称：'),password=await newPassword();
   const user=await createUser(store,{account,nickname,password});
   console.log(`账号 ${user.account}（${user.nickname}）已创建。`);
  }else{
   const account=process.argv[3]||await ask('需要重置的账号：'),password=await newPassword();
   const user=await resetPassword(store,{account,password});
   console.log(`账号 ${user.account}（${user.nickname}）的密码已重置；历史对局已保留，旧登录已注销。`);
  }
 }finally{store.close()}
}

if(require.main===module)main().catch(error=>{console.error(`操作失败：${error.message}`);process.exitCode=1});
module.exports={createUser,resetPassword};
