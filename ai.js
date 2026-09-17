const directions=[[0,1],[1,0],[1,1],[1,-1]];
function wins(board,i,color){const row=Math.floor(i/15),col=i%15;return directions.some(([dr,dc])=>{let count=1;for(const sign of [-1,1])for(let n=1;n<15;n++){const r=row+dr*n*sign,c=col+dc*n*sign;if(r<0||r>14||c<0||c>14||board[r*15+c]!==color)break;count++}return count>=5})}
function pattern(board,i,color){const row=Math.floor(i/15),col=i%15;let score=0;for(const [dr,dc]of directions){let count=1,open=0;for(const sign of [-1,1]){let n=1;for(;n<6;n++){const r=row+dr*n*sign,c=col+dc*n*sign;if(r<0||r>14||c<0||c>14)break;const value=board[r*15+c];if(value!==color){if(!value)open++;break}count++}}score+=count>=5?1000000:count===4?(open===2?80000:open?18000:0):count===3?(open===2?5000:open?450:0):count===2?(open===2?300:open?40:0):open*5;
 // Score broken lines within five-cell windows as well as consecutive runs.
 for(let offset=-4;offset<=0;offset++){let own=0,valid=true;for(let n=0;n<5;n++){const r=row+(offset+n)*dr,c=col+(offset+n)*dc;if(r<0||r>14||c<0||c>14||board[r*15+c]===3-color){valid=false;break}if((offset+n)===0||board[r*15+c]===color)own++}if(valid)score+=[0,1,12,140,3000,1000000][own]}}
 return score;
}
function candidates(board){if(!board.some(Boolean))return [112];return board.map((v,i)=>v?-1:i).filter(i=>i>=0&&board.some((v,j)=>v&&Math.abs(Math.floor(j/15)-Math.floor(i/15))<=2&&Math.abs(j%15-i%15)<=2))}
function ranked(board,color){return candidates(board).map(i=>({i,score:pattern(board,i,color)+pattern(board,i,3-color)*1.15+14-Math.abs(Math.floor(i/15)-7)-Math.abs(i%15-7)})).sort((a,b)=>b.score-a.score||a.i-b.i)}
function tactical(board,color){const empty=board.map((v,i)=>v?-1:i).filter(i=>i>=0);return empty.find(i=>wins(board,i,color))??empty.find(i=>wins(board,i,3-color))}
function chooseMove(board,color,difficulty='normal',budget=850){
 const urgent=tactical(board,color);if(urgent!==undefined)return urgent;
 const moves=ranked(board,color);if(!moves.length)return -1;
 if(difficulty==='easy'){const pool=moves.slice(0,Math.min(5,moves.length));return pool[Math.floor(Math.random()*pool.length)].i}
 if(difficulty==='normal')return moves[0].i;
 const deadline=Date.now()+budget;let best=moves[0].i;
 function evaluate(side){const own=ranked(board,side)[0]?.score||0,opp=ranked(board,3-side)[0]?.score||0;return own-opp*1.1}
 function search(side,depth,alpha,beta){if(Date.now()>deadline)throw new Error('timeout');const urgentMove=candidates(board).find(i=>wins(board,i,side));if(urgentMove!==undefined)return 1e8+depth;if(!depth)return evaluate(side);let value=-Infinity;for(const {i}of ranked(board,side).slice(0,6)){board[i]=side;let score;try{score=-search(3-side,depth-1,-beta,-alpha)}finally{board[i]=0}value=Math.max(value,score);alpha=Math.max(alpha,value);if(alpha>=beta)break}return value===-Infinity?0:value}
 for(const depth of [1,2,3]){let local=best,score=-Infinity;try{for(const {i}of moves.slice(0,8)){board[i]=color;let value;try{value=-search(3-color,depth,-Infinity,Infinity)}finally{board[i]=0}if(value>score){score=value;local=i}}best=local}catch{break}}
 return best;
}
module.exports={chooseMove,wins,pattern,tactical};
