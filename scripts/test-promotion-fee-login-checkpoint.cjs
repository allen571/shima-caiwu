'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');const {PromotionFee}=require('../electron/promotion-fee.cjs');const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s)};function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pf-checkpoint-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const p=new PromotionFee({root,safeStorage});p.putShop({username:'synthetic',password:'secret'});
 // v1.2.81：批量抓取遇验证已改为「跳过不等」，本文件用例覆盖「人工等待+预填」路径，需显式 interactive
 p.interactive=true;return p;}
test('未知登录尝试先持久保存无凭据检查点，重开保留，成功清除',t=>{const p=setup(t),shop=p.data.shops[0];assert.equal(p.beginLoginAttempt(shop),true);assert.equal(p.beginLoginAttempt(shop),false);assert.deepEqual(Object.keys(p.data.loginAttempts[shop.sessionKey]).sort(),['platform','startedAt']);const again=new PromotionFee({root:p.root,safeStorage});assert(again.hasLoginAttempt(shop));again.finishLoginAttempt(shop);assert(!again.hasLoginAttempt(shop));assert(!new PromotionFee({root:p.root,safeStorage}).hasLoginAttempt(shop));});
test('登录检查点写盘失败不写入内存尝试标记',t=>{const p=setup(t),shop=p.data.shops[0];fs.mkdirSync(p.file+'.tmp');assert.throws(()=>p.beginLoginAttempt(shop),/保存失败/);assert.equal(p.authAttempts.has(shop.sessionKey),false);assert.equal(p.hasLoginAttempt(shop),false);});
test('更换账号隔离新检查点，保留旧未知记录',t=>{const p=setup(t),old=p.data.shops[0];p.beginLoginAttempt(old);p.putShop({id:old.id,username:'changed',password:''});const next=p.shop(old.id);assert.notEqual(next.sessionKey,old.sessionKey);assert(!p.hasLoginAttempt(next));assert(p.hasLoginAttempt(old));p.beginLoginAttempt(next);p.finishLoginAttempt(next);assert(p.hasLoginAttempt(old));assert(!p.hasLoginAttempt(next));});
test('坏检查点容器拒绝读取，原文件不覆盖',t=>{const p=setup(t);for(const value of [null,[],12,'invalid']){const data={...p.data,loginAttempts:value},raw=JSON.stringify(data);fs.writeFileSync(p.file,raw);assert.throws(()=>new PromotionFee({root:p.root,safeStorage}),/检查点无法读取/);assert.equal(fs.readFileSync(p.file,'utf8'),raw);}});

const {JdPromotionFee}=require('../electron/promotion-fee-jd.cjs');
test('京东未知检查点只填不提交，保留原记录并进入带原因的人工等待',async()=>{
 const shop={sessionKey:'synthetic',username:'synthetic',secret:Buffer.from('test-secret').toString('base64')};
 let began=0,finished=0,waited=0,shown=0;const calls=[];
 const host={markLoginRequired:()=>{},hasLoginAttempt:()=>true,load:async()=>{},assertWindow:()=>{},showProblem:()=>shown++,safeStorage:{decryptString:b=>b.toString()},beginLoginAttempt:()=>began++,finishLoginAttempt:()=>finished++};
 const jd=new JdPromotionFee({host});jd.observe=async(w,input)=>{calls.push(input);return input?{status:'filled'}:{status:'form',loginHost:'passport.shop.jd.com'};};
 jd.waitForAuth=async(s,w,reason)=>{waited++;assert.match(reason,/手动.*点击/);return {status:'waiting'};};
 assert.equal((await jd.login(shop,{})).status,'waiting');assert.equal(began,0);assert.equal(finished,0);assert.equal(shown,1);assert.equal(waited,1);assert.equal(calls.length,2);assert.equal(calls[1].fillOnly,true);assert.equal(jd.attempted.size,0);
});

for(const platform of ['taobao','tmall'])test(platform+'未知提交时自动预填后等待手动确认，不清点不重复提交',async t=>{
 const p=setup(t);if(platform==='tmall')p.putShop({id:p.data.shops[0].id,platform,username:'synthetic',password:''});const shop=p.data.shops[0];p.beginLoginAttempt(shop);p.safeStorage.decryptString=b=>b.toString();p.hidden=true;
 const inputs=[];let observations=0;const win={isDestroyed:()=>false,hide(){},webContents:{isDestroyed:()=>false}};
 p.authState=async(w,input)=>{if(input){inputs.push(input);return {status:'filled'};}return ++observations===1?{status:'form'}:{status:'logged_in',shopName:'synthetic'};};
 assert.equal((await p.attention(shop,win,'unknown checkpoint')).shopName,'synthetic');
 assert.equal(inputs.length,1);assert.equal(inputs[0].fillOnly,true);assert.equal(inputs[0].username,'synthetic');assert(p.hasLoginAttempt(shop));assert.equal(p.shop(shop.id).loginConfirmedAt,null);
});
test('等待扫码切换后再预填，验证期间不填，整个等待不自动提交',async t=>{
 const p=setup(t),shop=p.data.shops[0];p.beginLoginAttempt(shop);p.safeStorage.decryptString=b=>b.toString();p.hidden=true;let observed=0,filled=0;
 p.authState=async(w,input)=>{if(input){assert.equal(input.fillOnly,true);return {status:++filled===1?'switched':'filled'};}return {status:['verification','logged_out','form','logged_in'][Math.min(observed++,3)],shopName:'synthetic'};};
 const win={isDestroyed:()=>false,hide(){},webContents:{isDestroyed:()=>false}};await p.attention(shop,win,'synthetic');assert.equal(filled,2);assert(p.hasLoginAttempt(shop));
});
test('预填注入时验证码出现，处理后仍重新预填空表单',async t=>{
 const p=setup(t),shop=p.data.shops[0];p.beginLoginAttempt(shop);p.safeStorage.decryptString=b=>b.toString();p.hidden=true;let observed=0,injections=0;
 p.authState=async(w,input)=>{if(input){assert.equal(input.fillOnly,true);return {status:++injections===1?'verification':'filled'};}return ++observed<=2?{status:'form'}:{status:'logged_in',shopName:'synthetic'};};
 await p.attention(shop,{isDestroyed:()=>false,hide(){},webContents:{isDestroyed:()=>false}},'synthetic');assert.equal(injections,2);assert(p.hasLoginAttempt(shop));
});
test('后台人工等待在解密或预填前退出，不抢焦点',async t=>{
 const p=setup(t),shop=p.data.shops[0];p.backgroundOnly=true;p.safeStorage.decryptString=()=>{throw Error('不应解密');};
 await assert.rejects(p.attention(shop,{},'synthetic'),/需要人工登录/);
});
test('本轮提交前遇验证，验证后仅尝试一次提交',async t=>{
 const p=setup(t),shop=p.data.shops[0];p.safeStorage.decryptString=b=>b.toString();p.hidden=true;
 const calls=[];let observed=0;
 p.authState=async(w,input)=>{if(input){calls.push(input);return {status:input.stage==='submit'?'submitted':'filled'};}return ++observed===1?{status:'verification'}:observed<4?{status:'form'}:{status:'logged_in',shopName:'synthetic'};};
 const win={isDestroyed:()=>false,hide(){},webContents:{isDestroyed:()=>false}};
 await p.attention(shop,win,'synthetic',false,true);
 assert.equal(calls.filter(c=>c.stage==='submit').length,1);
});
test('批量遇验证保留并展示窗口，继续返回人工状态',async t=>{
 const p=setup(t),shop=p.data.shops[0];p.interactive=false;
 let shown=0,hidden=0;p.captureLoginFailure=async()=>{};p.showProblem=()=>{shown++;};
 const win={isDestroyed:()=>false,hide(){hidden++;}};
 await assert.rejects(p.attention(shop,win,'synthetic'),e=>e.code==='NEEDS_MANUAL');
 assert.equal(shown,1);assert.equal(hidden,0);
});

test('批量遇未知登录检查点时预填空表单但不重复提交，保留检查点',async t=>{
 const p=setup(t),shop=p.data.shops[0];p.interactive=false;p.beginLoginAttempt(shop);p.safeStorage.decryptString=b=>b.toString();let shown=0,focused=0;const calls=[];
 p.showProblem=()=>{shown++;};p.focusForInput=async()=>{focused++;};p.authState=async(w,credentials)=>{calls.push(credentials);return {status:'filled'};};
 const win={isDestroyed:()=>false,webContents:{isDestroyed:()=>false}};
 await assert.rejects(p.attention(shop,win,'请确认后登录',false,false,true),e=>e.code==='NEEDS_MANUAL');
 assert.equal(shown,1);assert.equal(focused,1);assert.equal(calls.length,1);assert.equal(calls[0].fillOnly,true);assert.equal(calls[0].stage,undefined);assert(p.hasLoginAttempt(shop));
});
test('后台未知检查点不解密、不预填、不抢焦点',async t=>{
 const p=setup(t),shop=p.data.shops[0];p.interactive=false;p.hidden=true;p.beginLoginAttempt(shop);p.safeStorage.decryptString=()=>{throw Error('不应读取');};p.authState=()=>{throw Error('不应预填');};
 await assert.rejects(p.attention(shop,{},'请确认',false,false,true),e=>e.code==='NEEDS_MANUAL');assert(p.hasLoginAttempt(shop));
});
