const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');

class Store {
 constructor(filename){
  if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});
  this.db=new DatabaseSync(filename,{timeout:5000});
  this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  this.db.exec('CREATE TABLE IF NOT EXISTS migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for(const file of fs.readdirSync(path.join(__dirname,'migrations')).filter(f=>f.endsWith('.sql')).sort()){
   if(this.get('SELECT version FROM migrations WHERE version=?',file))continue;
   this.db.exec('BEGIN IMMEDIATE');
   try{this.db.exec(fs.readFileSync(path.join(__dirname,'migrations',file),'utf8'));this.run('INSERT INTO migrations VALUES (?,?)',file,Date.now());this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}
  }
 }
 get(sql,...args){return this.db.prepare(sql).get(...args)}
 all(sql,...args){return this.db.prepare(sql).all(...args)}
 run(sql,...args){return this.db.prepare(sql).run(...args)}
 transaction(fn){
  this.db.exec('BEGIN IMMEDIATE');
  try{const result=fn();this.run("UPDATE metadata SET value=value+1 WHERE key='revision'");this.db.exec('COMMIT');return result}
  catch(e){this.db.exec('ROLLBACK');throw e}
 }
 get revision(){return this.get("SELECT value FROM metadata WHERE key='revision'").value}
 user(id){return this.get('SELECT id,account,nickname FROM users WHERE id=?',id)}
 player(id){return this.get('SELECT id,nickname FROM users WHERE id=?',id)}
 rooms(){return this.all('SELECT payload FROM rooms').map(r=>JSON.parse(r.payload))}
 room(code){const r=this.get('SELECT payload FROM rooms WHERE code=?',code);return r?JSON.parse(r.payload):null}
 roomFor(id){const seat=this.get('SELECT room_code FROM seats WHERE user_id=?',id);return seat?this.room(seat.room_code):null}
 saveRoom(room){
  room.version++;
  this.run('INSERT INTO rooms VALUES (?,?) ON CONFLICT(code) DO UPDATE SET payload=excluded.payload',room.code,JSON.stringify(room));
  this.run('DELETE FROM seats WHERE room_code=?',room.code);
  for(const id of room.players)if(id&&id!=='computer')this.run('INSERT INTO seats VALUES (?,?)',id,room.code);
 }
 notify(ids,message){for(const id of new Set(ids.filter(Boolean)))this.run('INSERT INTO notifications(user_id,message,created_at) VALUES (?,?,?)',id,message,Date.now())}
 close(){this.db.close()}
}
module.exports={Store};
