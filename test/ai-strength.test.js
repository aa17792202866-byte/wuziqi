const test=require('node:test'),assert=require('node:assert/strict');
const {chooseMove,profile,winningPoints}=require('../ai');
function position(points,color){const b=Array(225).fill(0);for(const [r,c]of points)b[r*15+c]=color;return b}
for(const color of [1,2])test('create crossed fours with multiple winning continuations: '+color,()=>{const b=position([[7,5],[7,6],[7,8],[5,7],[6,7],[8,7]],color);const move=chooseMove(b,color,'hard');assert.ok(profile(b,move,color).fork);b[move]=color;assert.ok(winningPoints(b,color).length>=2)});
test('prevent opponent crossed-four fork before an immediate five exists',()=>{const b=position([[7,5],[7,6],[7,8],[5,7],[6,7],[8,7]],2);assert.equal(winningPoints(b,2).length,0);assert.equal(chooseMove(b,1,'hard'),112)});
test('double open-three is valued above an isolated open-three',()=>{const b=position([[7,6],[7,8],[6,7],[8,7]],1);assert.equal(profile(b,112,1).threes,2);const lone=position([[7,6],[7,8]],1);assert.ok(profile(b,112,1).score>profile(lone,112,1).score*2)});
test('broken four is blocked, edge boundary is not an open end',()=>{const b=position([[7,4],[7,5],[7,7],[7,8]],2);assert.equal(chooseMove(b,1,'hard'),111);const edge=position([[0,0],[0,1],[0,2]],1);assert.equal(profile(edge,3,1).fork,false)});
test('search deadline returns legal move without changing input',()=>{const b=position([[7,7],[7,8],[8,8],[6,6]],1),copy=[...b];for(const budget of [0,40,180]){const start=Date.now(),move=chooseMove(b,2,'hard',budget);assert.equal(b[move],0);assert.deepEqual(b,copy);assert.ok(Date.now()-start<budget+400)}});
