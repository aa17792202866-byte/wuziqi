const directions=[[0,1],[1,0],[1,1],[1,-1]];
const MATE=100000000;
function wins(board,i,color){if(i<0||i>=225)return false;const row=Math.floor(i/15),col=i%15;return directions.some(([dr,dc])=>{let count=1;for(const sign of [-1,1])for(let n=1;n<15;n++){const r=row+dr*n*sign,c=col+dc*n*sign;if(r<0||r>14||c<0||c>14||board[r*15+c]!==color)break;count++}return count>=5})}
function candidates(board){const set=new Set();for(let i=0;i<225;i++)if(board[i]){const row=Math.floor(i/15),col=i%15;for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){const r=row+dr,c=col+dc;if(r>=0&&r<15&&c>=0&&c<15&&!board[r*15+c])set.add(r*15+c)}}return set.size?[...set].sort((a,b)=>a-b):board.some(Boolean)?[]:[112]}
function winningPoints(board,color){return candidates(board).filter(i=>wins(board,i,color))}
function tactical(board,color){return winningPoints(board,color)[0]??winningPoints(board,3-color)[0]}
function profile(board,i,color){
 const row=Math.floor(i/15),col=i%15;let score=0,threes=0,fours=0;const completions=new Set();
 for(const [dr,dc]of directions){let text='',indices=[];for(let n=-5;n<=5;n++){const r=row+dr*n,c=col+dc*n;const index=r*15+c;indices.push(index);text+=r<0||r>14||c<0||c>14?'#':n===0||board[index]===color?'X':board[index]?'#':'.'}
  let three=false,four=false;
  for(let start=1;start<=5;start++){const segment=text.slice(start,start+5);if(segment.includes('#'))continue;const count=[...segment].filter(c=>c==='X').length;
   if(count===5)return {score:MATE,fork:true,threes:0,fours:0};
   if(count===4){completions.add(indices[start+segment.indexOf('.')]);four=true}
   score+=[0,2,30,220,1500][count];
  }
  for(const shape of ['.XXX.','.XX.X.','.X.XX.'])for(let start=0;start<=11-shape.length;start++)if(start<=5&&start+shape.length>5&&shape[5-start]==='X'&&text.slice(start,start+shape.length)===shape)three=true;
  if(four)fours++;if(three)threes++;
 }
 const fork=completions.size>=2;
 score+=fork?3000000:fours?100000:0;
 score+=threes*14000+(threes>=2?180000:0)+(fours&&threes?320000:0);
 return {score,fork,threes,fours};
}
function pattern(board,i,color){return profile(board,i,color).score}
function ranked(board,color){return candidates(board).map(i=>{const own=profile(board,i,color),opp=profile(board,i,3-color);return {i,own,opp,score:own.score+opp.score*1.08+14-Math.abs(Math.floor(i/15)-7)-Math.abs(i%15-7)}}).sort((a,b)=>b.score-a.score||a.i-b.i)}
function chooseMove(input,color,difficulty='normal',budget){
 // Search a copy so timeout or interrupted work can never modify the caller's board.
 const board=[...input];if(!board.some(Boolean))return 112;
 const urgent=tactical(board,color);if(urgent!==undefined)return urgent;
 const initial=ranked(board,color);if(!initial.length)return -1;
 const forced=initial.find(m=>m.own.fork);if(forced)return forced.i;
 if(difficulty==='easy'){const pool=initial.slice(0,3);return pool[Math.floor(Math.random()*pool.length)].i}
 const allotted=budget??(difficulty==='hard'?1200:220),deadline=Date.now()+allotted;
 let best=initial[0].i;const table=new Map(),timeout=Symbol('search deadline');let nodes=0;
 function check(){if(Date.now()>=deadline)throw timeout}
 function options(side,width){const ownWins=winningPoints(board,side);if(ownWins.length)return ownWins.map(i=>({i,win:true}));const blocks=winningPoints(board,3-side);if(blocks.length)return blocks.map(i=>({i,block:true}));const rankedMoves=ranked(board,side);const fork=rankedMoves.find(m=>m.own.fork);if(fork)return [fork];return rankedMoves.slice(0,width)}
 function evaluate(side){const moves=ranked(board,side);if(!moves.length)return 0;const own=moves.map(m=>m.own.score).sort((a,b)=>b-a),opp=moves.map(m=>m.opp.score).sort((a,b)=>b-a);return (own[0]||0)+(own[1]||0)*.12-(opp[0]||0)*1.12-(opp[1]||0)*.14}
 function search(side,depth,alpha,beta,ply,extensions){
  check();nodes++;
  const attack=winningPoints(board,side);if(attack.length)return MATE-ply;
  const defence=winningPoints(board,3-side);if(defence.length>1)return -MATE+ply+1;
  if(depth<=0){if(defence.length&&extensions>0)depth=1;else return evaluate(side)}
  const key=side+':'+extensions+':'+board.join(''),originalAlpha=alpha,originalBeta=beta;
  const cached=table.get(key);if(cached&&cached.depth>=depth){if(cached.flag==='exact')return cached.value;if(cached.flag==='lower')alpha=Math.max(alpha,cached.value);else beta=Math.min(beta,cached.value);if(alpha>=beta)return cached.value}
  const moves=defence.length?defence.map(i=>({i})):options(side,difficulty==='hard'?8:6);if(!moves.length)return 0;
  if(cached){const position=moves.findIndex(m=>m.i===cached.move);if(position>0)moves.unshift(...moves.splice(position,1))}
  let value=-Infinity,move=moves[0].i;
  for(const candidate of moves){board[candidate.i]=side;let score;try{score=-search(3-side,depth-1,-beta,-alpha,ply+1,defence.length?extensions-1:extensions)}finally{board[candidate.i]=0}
   if(score>value){value=score;move=candidate.i}alpha=Math.max(alpha,value);if(alpha>=beta)break;
  }
  if(table.size<25000)table.set(key,{depth,value,move,flag:value<=originalAlpha?'upper':value>=originalBeta?'lower':'exact'});return value;
 }
 const root=initial.slice(0,difficulty==='hard'?16:10);
 // Keep immediate fork defences even when ordinary positional scores rank them lower.
 for(const threat of initial.filter(m=>m.opp.fork))if(!root.some(m=>m.i===threat.i))root.push(threat);
 for(let depth=2;depth<=(difficulty==='hard'?8:4);depth++){
  let local=best,value=-Infinity,alpha=-Infinity;root.sort((a,b)=>(a.i===best?-1:b.i===best?1:b.score-a.score));
  try{for(const candidate of root){check();board[candidate.i]=color;let score;try{score=-search(3-color,depth-1,-Infinity,-alpha,1,4)}finally{board[candidate.i]=0}if(score>value){value=score;local=candidate.i}alpha=Math.max(alpha,value)}best=local;if(value>MATE-100)break}catch(error){if(error!==timeout)throw error;break}
 }
 return best;
}
module.exports={chooseMove,wins,pattern,tactical,profile,winningPoints};
