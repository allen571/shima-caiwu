'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PromotionFee,manualError}=require('../electron/promotion-fee.cjs');
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-watch-login-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const p=new PromotionFee({root,safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()}});
 p.putShop({name:'合成店铺',username:'synthetic',password:'synthetic-secret'});
 const id=p.data.shops[0].id;
 p.save({...p.data,shops:p.data.shops.map(s=>({...s,boundShop:'合成店铺',loginNeedsAttention:true}))});
 const shop=p.shop(id);p.manualWatchIntervalMs=15;
 const calls={hidden:0,flush:0,reads:0};
 const win={isDestroyed:()=>false,destroy(){},hide(){calls.hidden++;},webContents:{isDestroyed:()=>false,session:{flushStorageData(){calls.flush++;},cookies:{flushStore:async()=>{}}}}};
 p.windows.set(id,win);
 t.after(()=>p.close());
 return {p,shop,win,calls};
}
async function until(test){for(let i=0;i<100;i++){if(test())return;await new Promise(r=>setTimeout(r,15));}throw Error('监听未结束');}
test('批量标记需人工后，只在同一已绑定店铺登录确认并落盘成功后隐藏',async t=>{
 const {p,shop,win,calls}=setup(t);p.beginLoginAttempt(shop);
 p.save({...p.data,loginChecks:{[shop.id]:{status:'expired',at:new Date().toISOString()}}});
 p.adapter=async()=>{throw manualError('合成验证','verification');};
 p.authState=async(w,credentials)=>{assert.equal(credentials,undefined);calls.reads++;return calls.reads===1?{status:'verification'}:{status:'logged_in',shopName:'合成店铺'};};
 await p.start({shopIds:[shop.id],start:'2026-11-13',end:'2026-11-13'});await p.work;
 assert.equal(p.data.results.at(-1).status,'manual');assert.equal(calls.hidden,0);
 await until(()=>calls.hidden===1);
 assert.equal(calls.flush,1);assert.equal(p.hasLoginAttempt(shop),false);assert.equal(p.shop(shop.id).loginNeedsAttention,false);assert.equal(p.state().shops[0].checkStatus,'');
 assert.equal(p.data.results.at(-1).status,'manual');assert.equal(p.data.results.at(-1).amountCents,null);
});
test('登录到其他店铺或未建立绑定时，不隐藏窗口、不清除未知检查点',async t=>{
 const {p,shop,win,calls}=setup(t);p.beginLoginAttempt(shop);
 p.authState=async()=>{calls.reads++;return {status:'logged_in',shopName:'其他店铺'};};
 p.watchManualLogin(shop,win);await until(()=>calls.reads>=2);p.stopManualLoginWatch(shop.id);
 assert.equal(calls.hidden,0);assert(p.hasLoginAttempt(shop));
 p.save({...p.data,shops:p.data.shops.map(s=>({...s,boundShop:null}))});
 p.watchManualLogin(p.shop(shop.id),win);await until(()=>!p.manualLoginWatchers.has(shop.id));
 assert.equal(calls.hidden,0);assert(p.hasLoginAttempt(shop));
});
test('会话落盘期间同账号开始其他操作时，不隐藏也不清检查点',async t=>{
 const {p,shop,win,calls}=setup(t);p.beginLoginAttempt(shop);let release,started=false;
 win.webContents.session.cookies.flushStore=()=>new Promise(resolve=>{started=true;release=resolve;});
 p.authState=async()=>({status:'logged_in',shopName:'合成店铺'});
 p.watchManualLogin(shop,win);await until(()=>started);
 p.stopManualLoginWatch(shop.id);release();await new Promise(r=>setTimeout(r,30));
 assert.equal(calls.hidden,0);assert(p.hasLoginAttempt(shop));assert.equal(p.shop(shop.id).loginNeedsAttention,true);
});
test('隐藏测试、后台执行和暂停不启动验证窗口观察',async t=>{
 const {p,shop,win}=setup(t);
 for(const key of ['hidden','backgroundOnly','stopped','writeFailure']){p[key]=true;p.watchManualLogin(shop,win);assert.equal(p.manualLoginWatchers.size,0);p[key]=false;}
});

test('会话保存失败停止后续派发，保留窗口、检查点和失败原因',async t=>{
 const {p,shop,win,calls}=setup(t);p.beginLoginAttempt(shop);
 win.webContents.session.cookies.flushStore=async()=>{throw Error('synthetic storage failure');};
 p.authState=async()=>({status:'logged_in',shopName:'合成店铺'});
 p.watchManualLogin(shop,win);assert.equal(p.state().manualWatchCount,1);
 await until(()=>p.writeFailure);
 assert.equal(calls.hidden,0);assert(p.hasLoginAttempt(shop));
 assert.match(p.state().error,/会话保存失败/);assert.throws(()=>p.check(),/保存失败/);
});
test('观察已取消后会话落盘报错不触发写盘熔断',async t=>{
 const {p,shop,win}=setup(t);p.beginLoginAttempt(shop);let reject,started=false;
 win.webContents.session.cookies.flushStore=()=>new Promise((resolve,fail)=>{started=true;reject=fail;});
 p.authState=async()=>({status:'logged_in',shopName:'合成店铺'});
 p.watchManualLogin(shop,win);await until(()=>started);p.stopManualLoginWatch(shop.id);
 reject(Error('synthetic late failure'));await new Promise(r=>setTimeout(r,30));
 assert.equal(p.writeFailure,false);assert(p.hasLoginAttempt(shop));
});

test('暂停立即取消观察，即使随后重置停止状态也不隐藏旧窗口',async t=>{
 const {p,shop,win,calls}=setup(t);p.authState=async()=>({status:'logged_in',shopName:'合成店铺'});
 p.watchManualLogin(shop,win);p.pause();assert.equal(p.manualLoginWatchers.size,0);
 p.stopped=false;await new Promise(r=>setTimeout(r,50));assert.equal(calls.hidden,0);
});
