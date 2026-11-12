'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{PromotionFee}=require('../electron/promotion-fee.cjs');
function fixture(states,prior=false){
 const p=Object.create(PromotionFee.prototype),loads=[],writes=[];let reads=0;
 Object.assign(p,{stopped:false,writeFailure:false,activeQueries:new Map(),queryContext:{getStore:()=>null},markLoginRequired:()=>{},hasLoginAttempt:()=>prior,load:async(w,url)=>loads.push(url),authState:async(w,credentials)=>{assert.equal(credentials,undefined,'未明确失效前不得解密填写');return states[Math.min(reads++,states.length-1)];},finishLoginAttempt:()=>writes.push('finish')});
 const win={isDestroyed:()=>false,hide(){},webContents:{isDestroyed:()=>false,isLoadingMainFrame:()=>false}};
 return {p,win,loads,writes};
}
test('已保存会话身份渲染超过1.2秒，直接复用登录，不强跳也不填写',async()=>{
 const f=fixture([...Array.from({length:6},()=>({status:'unknown'})),{status:'logged_in',shopName:'synthetic-shop'}],true);
 assert.equal(await f.p.identity({name:'synthetic'},f.win),'synthetic-shop');assert.equal(f.loads.length,1);assert.match(f.loads[0],/myseller/);assert.deepEqual(f.writes,[]);
});
test('短暂未登录提示后恢复unknown不强跳登录',async()=>{
 const f=fixture([{status:'logged_out'},{status:'unknown'},{status:'form'},{status:'unknown'},{status:'logged_in',shopName:'synthetic-shop'}]);
 assert.equal(await f.p.identity({name:'synthetic'},f.win),'synthetic-shop');assert.equal(f.loads.length,1);
});
test('连续明确未登录才转登录页，未知检查点仍人工等待不重复提交',async()=>{
 const f=fixture([{status:'logged_out'},{status:'form'},{status:'form'}],true);let attended=0;
 f.p.attention=async()=>{attended++;return {shopName:'synthetic-shop'};};
 assert.equal(await f.p.identity({name:'synthetic'},f.win),'synthetic-shop');assert.equal(f.loads.length,2);assert.match(f.loads[1],/loginmyseller/);assert.equal(attended,1);
});
test('明确失效且无检查点时仍可自动登录，提交前保存检查点',async()=>{
 const f=fixture([]);let submitted=false;const events=[];
 f.p.safeStorage={decryptString:()=>{events.push('decrypt');return 'synthetic-password';}};
 f.p.beginLoginAttempt=()=>events.push('checkpoint');
 f.p.authState=async(w,credentials)=>{if(credentials){events.push('submit');assert.deepEqual(events,['decrypt','checkpoint','submit']);submitted=true;return {status:'submitted'};}return submitted?{status:'logged_in',shopName:'synthetic-shop'}:{status:'form'};};
 assert.equal(await f.p.identity({name:'synthetic',username:'synthetic',secret:'c3ludGhldGlj'},f.win),'synthetic-shop');assert.equal(f.loads.length,2);assert.deepEqual(f.writes,[]);
});
