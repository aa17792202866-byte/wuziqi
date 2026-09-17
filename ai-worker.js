const {parentPort,workerData}=require('node:worker_threads');
const {chooseMove}=require('./ai');
try{parentPort.postMessage({index:chooseMove([...workerData.board],workerData.color,workerData.difficulty)})}catch{parentPort.postMessage({index:-1})}
