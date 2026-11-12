'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {PromotionFee}=require('../electron/promotion-fee.cjs'),{JdPromotionFee}=require('../electron/promotion-fee-jd.cjs');
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-auth-commit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const p=new PromotionFee({root,safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s)}});p.putShop({username:'synthetic',password:'synthetic-secret'});const shop=p.data.shops[0];p.save({...p.data,shops:p.data.shops.map(s=>({...s,boundShop:s.name}))});p.beginLoginAttempt(shop);const win={isDestroyed:()=>false,hide(){},webContents:{isDestroyed:()=>false,session:{flushStorageData(){},cookies:{flushStore:async()=>{}}}}};p.authState=async()=>({status:'logged_in',shopName:shop.name});return {p,shop,win};}
for(const kind of ['wrong-identity','flush-failure','final-save-failure','cancel'])test('认证确认提交前'+kind+'保留原提交检查点',async t=>{
 const {p,shop,win}=setup(t);
 if(kind==='wrong-identity')p.authState=async()=>({status:'logged_in',shopName:'other-synthetic'});
 if(kind==='flush-failure')win.webContents.session.cookies.flushStore=async()=>{throw Error('synthetic flush failure');};
 if(kind==='final-save-failure')fs.mkdirSync(p.file+'.tmp');
 if(kind==='cancel')win.webContents.session.cookies.flushStore=async()=>{p.pause();};
 await assert.rejects(p.authenticate(shop,win));
 assert.equal(p.hasLoginAttempt(shop),true);assert.equal(p.authAttempts.has(shop.sessionKey),true);assert.equal(p.shop(shop.id).loginConfirmedAt,null);
 const persisted=JSON.parse(fs.readFileSync(p.file));assert(Object.hasOwn(persisted.loginAttempts,shop.sessionKey));assert.equal(persisted.shops[0].loginConfirmedAt,null);
});
test('两个账号认证并行完成，确认与清点一次提交且互不覆盖',async t=>{
 const {p,shop,win}=setup(t);p.putShop({username:'synthetic-two',password:'synthetic-secret'});const second=p.data.shops[1];p.save({...p.data,shops:p.data.shops.map(s=>({...s,boundShop:s.name}))});p.beginLoginAttempt(second);
 const releases=[];const makeWin=()=>({...win,webContents:{...win.webContents,session:{flushStorageData(){},cookies:{flushStore:()=>new Promise(r=>releases.push(r))}}}});
 p.identity=async s=>s.name;p.jdAdapter={attempted:new Set([shop.sessionKey,second.sessionKey])};
 const a=p.authenticate(shop,makeWin()),b=p.authenticate(second,makeWin());while(releases.length<2)await new Promise(r=>setImmediate(r));
 releases[1]();await b;assert(p.hasLoginAttempt(shop));assert(!p.hasLoginAttempt(second));assert(p.jdAdapter.attempted.has(shop.sessionKey));
 releases[0]();await a;assert(!p.hasLoginAttempt(shop));assert.equal(p.jdAdapter.attempted.size,0);
 const data=JSON.parse(fs.readFileSync(p.file));assert.equal(data.shops.length,2);assert(data.shops.every(s=>s.loginConfirmedAt));assert.deepEqual(data.loginAttempts,{});
});
test('京东授权子窗认证后错目标，保留父检查点并立即销毁失败子窗',async t=>{
 const {p,shop}=setup(t);const parent=new EventEmitter(),child=new EventEmitter(),wc=new EventEmitter(),childWC=new EventEmitter();
 Object.assign(wc,{session:{webRequest:{onBeforeRequest(){}}},setWindowOpenHandler(){},isDestroyed:()=>false});Object.assign(childWC,{setWindowOpenHandler(){},isDestroyed:()=>false});
 let destroyed=false;Object.assign(parent,{webContents:wc,isDestroyed:()=>false});Object.assign(child,{webContents:childWC,isDestroyed:()=>false,hide(){},destroy(){destroyed=true;}});
 p.execute=async()=>{wc.emit('did-create-window',child);return true;};p.showProblem=()=>true;const jd=new JdPromotionFee({host:p});let reads=0;jd.observe=async()=>++reads===1?{status:'verification'}:{status:'logged_in',accountId:'wrong-target'};
 await assert.rejects(jd.authorizedAccount(shop,parent,{accountId:'expected-target'}),/不匹配/);assert(p.hasLoginAttempt(shop));assert.equal(p.shop(shop.id).loginConfirmedAt,null);assert(destroyed,'失败子窗应立即销毁，不积压');assert(!p.problemWindows||!p.problemWindows.has(child));
});
