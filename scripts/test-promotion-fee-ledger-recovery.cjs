'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PromotionFee}=require('../electron/promotion-fee.cjs');
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-ledger-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const p=new PromotionFee({root,safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s)}});p.putShop({username:'synthetic',password:'synthetic-secret'});const shop=p.data.shops[0],dates={start:'2026-10-01',end:'2026-10-20'},state={url:'https://one.alimama.com/index.html#!/account/detail',loads:[],focus:0,reads:0};const win={isDestroyed:()=>false,hide(){},webContents:{isDestroyed:()=>false,isLoadingMainFrame:()=>false,getURL:()=>state.url,session:{flushStorageData(){},cookies:{flushStore:async()=>{}}}}};p.pageReadyTimeoutMs=1800;p.window=()=>win;p.identity=async()=>shop.name;p.authState=async()=>({status:'unknown'});p.load=async(w,url)=>{state.loads.push(url);state.url=url;};p.showProblem=()=>{state.focus++;};
// v1.2.81：批量抓取遇验证已改为「跳过不等」，这批用例覆盖的是「交互式登录/恢复」路径，显式打开 interactive
p.interactive=true;const ready={start:dates.start,end:dates.end,trade:'DEDUCT',dateType:'交易日期',controls:['扣款','交易日期',dates.start+' ~ '+dates.end],amount:'12.34',identityLabels:[shop.name],content:'synthetic ledger'};const attention=p.attention.bind(p);p.attention=async(...args)=>{p.beginLoginAttempt(shop);return attention(...args);};return {p,shop,dates,state,ready,win};}
for(const code of ['need_login','verification'])test('账单'+code+'批量抓取不阻塞其他账号，保留人工验证窗口',async t=>{
 const f=setup(t);f.p.interactive=false;f.p.execute=async()=>++f.state.reads<=2?{code,error:'synthetic authentication'}:f.ready;
 await f.p.start({...f.dates,shopIds:[f.shop.id]});await f.p.work;
 assert.equal(f.p.state().results[0].status,'manual');assert.equal(f.p.state().manual.count,1);assert.equal(f.state.focus,1);assert.equal(f.state.loads.length,1);assert.equal(f.p.state().shops[0].loginStatus,'需确认登录');
});
for(const code of ['need_login','verification'])test('账单'+code+'交互式登录仍可原地认证后继续原日期，无需再点查询',async t=>{
 const f=setup(t);f.p.interactive=true;f.p.execute=async()=>++f.state.reads<=2?{code,error:'synthetic authentication'}:f.ready;
 const result=await f.p.query(f.shop,f.dates);
 assert.equal(result.amountCents,1234);assert.equal(f.state.focus,1);assert.equal(f.state.loads.length,2);assert.equal(f.state.loads[0],f.state.loads[1]);assert(!f.p.hasLoginAttempt(f.shop));assert.equal(f.p.state().shops[0].loginStatus,'已保存登录');
});
test('认证返回推广业务首页，仅一次恢复原账单，unknown不直接确认',async t=>{
 const f=setup(t);let restored=false;const load=f.p.load;f.p.load=async(w,url)=>{if(f.state.loads.length)restored=true;await load(w,url);};f.p.execute=async()=>{if(++f.state.reads===1)return {code:'need_login',error:'synthetic auth'};if(!restored){f.state.url='https://one.alimama.com/index.html#!/home';assert(f.p.hasLoginAttempt(f.shop));return {loading:true};}return f.ready;};
 const result=await f.p.query(f.shop,f.dates);assert.equal(result.amountCents,1234);assert.equal(f.state.loads.length,2);assert(!f.p.hasLoginAttempt(f.shop));
});
test('恢复后再次要求登录，终止本项不循环、不清未知提交',async t=>{
 const f=setup(t);f.p.execute=async()=>++f.state.reads===2?f.ready:{code:'need_login',error:'synthetic auth'};
 await assert.rejects(f.p.query(f.shop,f.dates),/未重复认证/);assert.equal(f.state.focus,1);assert.equal(f.state.loads.length,2);assert(f.p.hasLoginAttempt(f.shop));assert.equal(f.p.state().shops[0].loginStatus,'需确认登录');
});
for(const kind of ['identity','dates'])test('恢复后'+kind+'不匹配仍失败，保留检查点',async t=>{
 const f=setup(t);f.p.execute=async()=>{const n=++f.state.reads;if(n===1)return {code:'need_login',error:'synthetic auth'};if(n===2)return f.ready;return {...f.ready,...(kind==='identity'?{identityLabels:['different'],accountLabels:[]}:{controls:['扣款','交易日期','2026-10-02 ~ 2026-10-20']})};};
 await assert.rejects(f.p.query(f.shop,f.dates),kind==='identity'?/身份未确认/:/日期范围未确认/);assert(f.p.hasLoginAttempt(f.shop));assert.equal(f.state.loads.length,2);
});
test('当前账单仅unknown时原地等待，暂停后退出，不导航不清点',async t=>{
 const f=setup(t);f.p.execute=async()=>++f.state.reads===1?{code:'need_login',error:'synthetic auth'}:{loading:true};
 const work=f.p.query(f.shop,f.dates),timer=setTimeout(()=>f.p.pause(),100);t.after(()=>clearTimeout(timer));await assert.rejects(work,/暂停/);assert.equal(f.state.loads.length,1);assert(f.p.hasLoginAttempt(f.shop));
});

test('底层账单金额可见但认证仍阻挡时，不恢复导航不写成功',async t=>{
 const f=setup(t);f.p.execute=async()=>++f.state.reads===1?{code:'verification',error:'synthetic challenge'}:f.ready;let authReads=0;
 f.p.authState=async()=>{authReads++;return {status:'verification'};};
 const work=f.p.query(f.shop,f.dates),timer=setTimeout(()=>f.p.pause(),100);t.after(()=>clearTimeout(timer));await assert.rejects(work,/暂停/);
 assert(authReads>0);assert.equal(f.state.loads.length,1);assert(f.p.hasLoginAttempt(f.shop));
});
test('恢复后金额仍可见但验证码重现，不返回金额且不重复进入恢复',async t=>{
 const f=setup(t);f.p.execute=async()=>++f.state.reads===1?{code:'verification',error:'synthetic challenge'}:f.ready;
 f.p.authState=async()=>({status:f.state.loads.length>=2?'verification':'unknown'});
 await assert.rejects(f.p.query(f.shop,f.dates),/未重复认证/);assert.equal(f.state.loads.length,2);assert(f.p.hasLoginAttempt(f.shop));
});

test('千牛控件短暂显示旧日期后完成渲染，等待核验而非立即失败',async t=>{
 const f=setup(t);f.p.execute=async()=>++f.state.reads<=2?{...f.ready,controls:['扣款','交易日期','2026-10-02 ~ 2026-10-20']}:f.ready;
 assert.equal((await f.p.query(f.shop,f.dates)).amountCents,1234);assert.equal(f.state.loads.length,1);
});
test('千牛无关文案持续变化不阻塞，加载中断后重新连续核对金额',async t=>{
 const f=setup(t);f.p.execute=async()=>{const n=++f.state.reads;return n===3?{loading:true}:{...f.ready,content:'时钟 '+n};};
 assert.equal((await f.p.query(f.shop,f.dates)).amountCents,1234);assert.equal(f.state.reads,6);
});
test('千牛页面切换销毁读取上下文，仅重试无副作用的读取',async t=>{
 const f=setup(t);let calls=0;f.p.execute=async()=>{if(++calls===1)throw Error('Execution context was destroyed');return f.ready;};
 assert.equal((await f.p.query(f.shop,f.dates)).amountCents,1234);assert.equal(f.state.loads.length,1);assert.equal(calls,4);
});

test('千牛旧日期持续1.5秒才完成刷新，使用就绪期限等待并重新稳定核验',async t=>{
 const f=setup(t);f.p.pageReadyTimeoutMs=5000;f.p.execute=async()=>++f.state.reads<=5?{...f.ready,controls:['扣款','交易日期','2026-10-02 ~ 2026-10-20']}:f.ready;
 assert.equal((await f.p.query(f.shop,f.dates)).amountCents,1234);assert.equal(f.state.reads,8);assert.equal(f.state.loads.length,1);
});
