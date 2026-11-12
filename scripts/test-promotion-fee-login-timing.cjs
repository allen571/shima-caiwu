'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{PromotionFee}=require('../electron/promotion-fee.cjs');
for(const phase of ['username','password'])for(const cause of ['pause','closed','writeFailure'])test('填写'+phase+'后'+cause+'阻止后续字段和提交',async()=>{
 const p=Object.create(PromotionFee.prototype);p.stopped=false;p.writeFailure=false;let closed=false;const stages=[];
 const win={isDestroyed:()=>closed,webContents:{isDestroyed:()=>closed}};
 const work=p.submitLogin(win,async input=>{stages.push(input.stage);if(input.stage===phase){if(cause==='pause')p.stopped=true;if(cause==='closed')closed=true;if(cause==='writeFailure')p.writeFailure=true;}return {status:'prepared'};},{username:'synthetic',password:'synthetic-secret'});
 await assert.rejects(work);assert.deepEqual(stages,phase==='username'?['username']:['username','password']);
});
test('页面拒绝或需要认证时停止分阶段提交',async()=>{
 const p=Object.create(PromotionFee.prototype);p.stopped=false;p.writeFailure=false;let calls=0;const win={isDestroyed:()=>false,webContents:{isDestroyed:()=>false}};
 const result=await p.submitLogin(win,async()=>{calls++;return {status:'verification'};},{username:'synthetic',password:'synthetic-secret'});
 assert.equal(result.status,'verification');assert.equal(calls,1);
});
for(const phase of ['username','password'])test('在'+phase+'后的间隔中取消，轮询及时阻止下一阶段',async t=>{
 const p=Object.create(PromotionFee.prototype);p.stopped=false;p.writeFailure=false;p.state=()=>({stopped:p.stopped});const stages=[];let timer,cancelledAt;
 t.after(()=>clearTimeout(timer));const win={isDestroyed:()=>false,webContents:{isDestroyed:()=>false}};
 const work=p.submitLogin(win,async input=>{stages.push(input.stage);if(input.stage===phase)timer=setTimeout(()=>{cancelledAt=Date.now();p.pause();},150);return {status:'prepared'};},{username:'synthetic',password:'synthetic-secret'});
 await assert.rejects(work,/暂停/);assert(Date.now()-cancelledAt<400);assert.deepEqual(stages,phase==='username'?['username']:['username','password']);
});
