'use strict';
// v1.2.88 一键验证登录状态：用已保存会话只读探测官方首页（不填密码/不点登录/不弹窗），
// 结果标注到账号列表；过期/待验证账号交给「一键登录所选」接力。本文件验证：
// ① 探测绝不携带凭据（不碰密码）② 状态映射与落盘 ③ 忙时拒绝 ④ 检查窗口用完即收
// ⑤ 登录态工作字段（loginNeedsAttention/loginConfirmedAt）不被检测改动。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PromotionFee}=require('../electron/promotion-fee.cjs');
const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('encrypted:'+s),decryptString:b=>b.toString().slice(10)};
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-login-check-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const service=new PromotionFee({root,safeStorage,desktop:root});
 service.putShop({name:'甲店',username:'甲店账号',password:'sample-secret'});
 service.putShop({name:'乙店',username:'乙店账号',password:'sample-secret'});
 service.loginCheckTimeoutMs=300; // 测试里把 15 秒探测上限缩短，避免拖慢用例
 return service;
}
function fakeWin({status='logged_in',destroyed=false}={}){
 const noop=()=>{};const wc={isDestroyed:()=>false,url:'https://myseller.taobao.com/home.htm/QnworkbenchHome/',once:noop,removeListener:noop,stop:noop,executeJavaScript:async()=>({})};
 wc.mainFrame={framesInSubtree:[wc]};
 const win={isDestroyed:()=>destroyed,isVisible:()=>false,show:noop,focus:noop,hide:noop,isMinimized:()=>false,once:noop,removeListener:noop,webContents:wc,destroyedFlag:false};
 win.destroy=()=>{win.destroyedFlag=true;};
 return win;
}
// 装探测桩：记录 authState 每次调用是否带凭据，按店返回指定状态
function stubAuth(service,byName){
 const calls=[];
 service.authState=async(win,credentials)=>{calls.push({credentials});return {status:byName.shift()||'logged_in'};};
 service.load=async()=>{};
 service.window=()=>fakeWin();
 return calls;
}
test('只读探测：不带凭据、不改登录态字段、结果落 loginChecks',async t=>{
 const s=setup(t);
 const shop=s.data.shops[0];
 s.markLoginRequired(shop); // 预置「需确认登录」，检测不应把它改掉
 const calls=stubAuth(s,['logged_in']);
 const r=await s.checkLogins();
 assert.equal(calls.every(c=>c.credentials===undefined||c.credentials===null),true,'探测绝不能带账号密码');
 assert.equal(r.results.length,2,'不带 shopIds 时检测全部账号');
 assert.equal(r.results.every(x=>x.status==='ok'),true);
 assert.equal(r.counts.ok,2);assert.equal(r.counts.expired,0);
 assert.equal(s.data.shops[0].loginNeedsAttention,true,'检测不得清除登录提醒');
 const st=await s.state();
 assert.equal(st.shops[0].checkStatus,'ok');
 assert.ok(st.shops[0].checkAt,'应有检测时间');
 assert.equal(st.checkBusy,false,'检测结束后必须复位');
});
test('状态映射：form→过期、verification→待验证，全部计入 counts',async t=>{
 const s=setup(t);
 const shop=s.data.shops[0];
 stubAuth(s,['form']);
 let r=await s.checkLogins({shopIds:[shop.id]});
 assert.equal(r.results[0].status,'expired');
 assert.equal(r.counts.expired,1);
 stubAuth(s,['agreement']);
 r=await s.checkLogins({shopIds:[shop.id]});
 assert.equal(r.results[0].status,'verification');
 assert.equal(r.counts.verification,1);
 const st=await s.state();
 assert.equal(st.shops[0].checkStatus,'verification');
});
test('查询或登录忙时拒绝检测，检测期间拒绝查询',async t=>{
 const s=setup(t);
 stubAuth(s,['logged_in']);
 s.busy=true;
 await assert.rejects(s.checkLogins(),/正在运行/);
 s.busy=false;s.checkBusy=true;
 await assert.rejects(s.start({shopIds:[s.data.shops[0].id],start:'2026-11-10',end:'2026-11-10'}),/正在运行/);
 await assert.rejects(s.login(s.data.shops[0].id),/正在运行/);
 s.checkBusy=false;
 await assert.doesNotReject(s.checkLogins());
});
test('自开的检查窗口用完即收；已有会话窗口不动',async t=>{
 const s=setup(t);
 const fresh=fakeWin(),existing=fakeWin();
 s.load=async()=>{};s.authState=async()=>({status:'logged_in'});
 const shopA=s.data.shops[0],shopB=s.data.shops[1];
 s.window=shop=>shop.id===shopA.id?fresh:existing; // 乙店模拟已有窗口（上次登录留下的）
 existing.promotionKeepAlive=true;
 await s.checkLogins({shopIds:[shopA.id,shopB.id]});
 assert.equal(fresh.destroyedFlag,true,'临时检查窗口应销毁');
 assert.equal(existing.destroyedFlag,false,'会话窗口不得销毁');
});
test('页面一直读不出确定状态 → 未确认（unknown），不瞎猜也不报错',async t=>{
 const s=setup(t);
 const calls=stubAuth(s,[]); // 桩返回 logged_in？不行——这里要求一直 unknown
 s.authState=async()=>({status:'manual'});
 const r=await s.checkLogins({shopIds:[s.data.shops[0].id]});
 assert.equal(r.results[0].status,'unknown');
 assert.equal(r.counts.unknown,1);
 assert.equal(r.seconds>=0,true);
});
test('京东账号走 jdAdapter.observe 探测，同样不触发登录',async t=>{
 const s=setup(t);
 s.data.shops[0].platform='jd';
 let observed=0,credentialSeen=null;
 s.load=async()=>{};
 s.window=()=>fakeWin();
 s.jdAdapter={observe:async(win,input)=>{observed++;credentialSeen=input||null;return {status:'logged_in',accountId:'acc-1'};}};
 const r=await s.checkLogins({shopIds:[s.data.shops[0].id]});
 assert.equal(observed,1,'应走京东探测桩');
 assert.equal(credentialSeen,null,'京东探测也不得携带凭据');
 assert.equal(r.results[0].status,'ok');
});
test('勾选语义由前端负责：接口只返回状态，前端把过期/待验证/异常自动勾选',async t=>{
 const s=setup(t);
 stubAuth(s,['logged_out']);
 const r=await s.checkLogins();
 assert.equal(r.results[0].status,'expired');
 assert.equal(['expired','verification','rejected'].includes(r.results[0].status),true,'前端将按此口径自动勾选');
});

test('检测登录时保留正在显示的人工认证窗口，不跳转',async t=>{
 const s=setup(t),shop=s.data.shops[0],win=fakeWin();win.isVisible=()=>true;s.windows.set(shop.id,win);let navigated=0;s.load=async()=>{navigated++;};
 const r=await s.checkLogins({shopIds:[shop.id]});assert.equal(navigated,0);assert.equal(r.results[0].status,'unknown');assert.equal(win.destroyedFlag,false);
});
