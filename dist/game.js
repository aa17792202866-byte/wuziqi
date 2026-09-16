(function(root){
class Gomoku{
 constructor(){this.reset()}
 reset(){this.board=Array(225).fill(0);this.history=[];this.winner=0;this.line=[];this.draw=false}
 get turn(){return this.history.length%2+1}
 play(row,col){if(!Number.isInteger(row)||!Number.isInteger(col)||row<0||row>14||col<0||col>14)throw new Error('坐标必须为0至14的整数');const i=row*15+col;if(this.winner||this.draw||this.board[i])return false;const color=this.turn;this.board[i]=color;this.history.push({row,col,color});for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]){const line=[i];for(const sign of [-1,1]){let r=row+dr*sign,c=col+dc*sign;while(r>=0&&r<15&&c>=0&&c<15&&this.board[r*15+c]===color){line.push(r*15+c);r+=dr*sign;c+=dc*sign}}if(line.length>=5){this.winner=color;this.line=line;break}}this.draw=!this.winner&&this.history.length===225;return true}
 undo(){const last=this.history.pop();if(!last)return false;this.board[last.row*15+last.col]=0;this.winner=0;this.line=[];this.draw=false;return true}
}
root.Gomoku=Gomoku;if(typeof module!=='undefined')module.exports=Gomoku;
})(typeof window!=='undefined'?window:globalThis);
