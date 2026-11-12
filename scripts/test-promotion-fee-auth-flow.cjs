'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PromotionFee}=require('../electron/promotion-fee.cjs'),{JdPromotionFee}=require('../electron/promotion-fee-jd.cjs');
function setup(t,platform='taobao'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-auth-flow-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const p=new PromotionFee({root,safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s)}});p.putShop({username:'synthetic',password:'test-secret',platform});
 const counts={flush:0,focus:0};const win={isDestroyed:()=>false,hide(){},webContents:{isDestroyed:()=>false,getURL:()=> 'https://one.alimama.com/index.html',session:{flushStorageData(){},cookies:{flushStore:async()=>counts.flush++}}}};
 p.window=()=>win;p.identity=async()=> 'synthetic';p.showProblem=()=>counts.focus++;p.load=async()=>{};
 const dates={start:'2026-10-01',end:'2026-10-20'};
 p.execute=async()=>({start:dates.start,end:dates.end,trade:'DEDUCT',dateType:'交易日期',controls:['扣款','交易日期',dates.start+' ~ '+dates.end],amount:'12.34',identityLabels:['synthetic'],content:'synthetic ledger'});
 return {p,win,counts,dates,shop:p.data.shops[0]};
}
test('提前登录→一键真实查询流程共用身份核验和会话保存，无需重复人工登录',async t=>{
 const {p,counts,dates,shop}=setup(t);let identities=0;p.identity=async()=>{identities++;return 'synthetic';};
 await p.login(shop.id);await p.loginWork;assert(p.shop(shop.id).loginConfirmedAt);assert.equal(p.data.results.length,0);
 p.lastError='上次错误';await p.start({...dates,shopIds:[shop.id]});await p.work;
 assert.equal(p.state().results[0].amountCents,1234);assert.equal(identities,2);assert.equal(counts.flush,2);assert.equal(counts.focus,0);assert.equal(p.state().error,'');
 assert.equal(p.state().shops[0].loginStatus,'已保存登录');
});
test('明确需认证更新状态并保留上次确认，重新核验后恢复；修改凭据隔离会话',async t=>{
 const {p,win,shop}=setup(t);await p.authenticate(shop,win);const time=p.shop(shop.id).loginConfirmedAt;
 p.markLoginRequired(shop);assert.equal(p.state().shops[0].loginStatus,'需确认登录');assert.equal(p.shop(shop.id).loginConfirmedAt,time);
 await p.authenticate(p.shop(shop.id),win);assert.equal(p.state().shops[0].loginStatus,'已保存登录');
 p.markLoginRequired(shop);p.putShop({id:shop.id,username:'changed',password:''});assert.equal(p.shop(shop.id).loginConfirmedAt,null);assert.equal(p.shop(shop.id).loginNeedsAttention,false);assert.notEqual(p.shop(shop.id).sessionKey,shop.sessionKey);
});
test('保存Cookie等待中取消，不写入新的登录确认',async t=>{
 const {p,win,shop}=setup(t);let release;win.webContents.session.cookies.flushStore=()=>new Promise(r=>release=r);
 const work=p.authenticate(shop,win);while(!release)await new Promise(r=>setImmediate(r));p.pause();release();await assert.rejects(work,/暂停/);assert.equal(p.shop(shop.id).loginConfirmedAt,null);
});
test('京东提前登录与查询共用验证入口并拒绝错账户',async t=>{
 const {p,win,shop,counts}=setup(t,'jd');p.jdAdapter={login:async()=>({status:'logged_in',accountId:'synthetic-id',name:'synthetic-name'})};
 await p.authenticate(shop,win);assert.equal(p.shop(shop.id).name,'synthetic-name');assert.equal(p.shop(shop.id).jdLoginAccountId,'synthetic-id');assert.equal(counts.flush,1);
 p.jdAdapter.login=async()=>({accountId:'different',name:'other'});await assert.rejects(p.authenticate(p.shop(shop.id),win),/身份已变化/);assert.equal(counts.flush,1);assert.equal(p.state().shops[0].loginStatus,'需确认登录');
});
for(const stage of ['observed','after-submit'])test('京东人工认证成功立即返回：'+stage,async()=>{
 let reads=0,waits=0;const host={hasLoginAttempt:()=>false,load:async()=>{},assertWindow(){},markLoginRequired(){},showProblem(){},beginLoginAttempt(){},safeStorage:{decryptString:()=> 'synthetic-secret'}};
 host.submitLogin=(w,observe,credentials)=>observe(credentials);const jd=new JdPromotionFee({host});jd.observe=async(w,input)=>{reads++;if(reads>2)throw Error('认证成功后不应重进观察循环');return stage==='observed'?{status:'verification'}:input?{status:'verification'}:{status:'form',loginHost:'passport.shop.jd.com'};};
 jd.waitForAuth=async()=>{waits++;return {status:'logged_in',accountId:'synthetic-id'};};
 assert.equal((await jd.login({sessionKey:'synthetic',secret:'',username:'synthetic'},{})).accountId,'synthetic-id');assert.equal(waits,1);assert.equal(reads,stage==='observed'?1:2);
});
test('补查清除旧全局错误，但保留成功查询项',async t=>{
 const {p,shop,dates}=setup(t);let fail=true;p.adapter=async s=>{if(fail)throw Error('synthetic failure');return {shopName:s.name,amountCents:123};};
 await p.start({...dates,shopIds:[shop.id]});await p.work;p.lastError='上次登录失败';fail=false;await p.retry();await p.work;assert.equal(p.state().error,'');assert.equal(p.state().results[0].status,'completed');
});

test('京东已提前登录时先复用京准通会话，不绕回京麦登录',async()=>{
 const loads=[];let finished=0;const host={hasLoginAttempt:()=>false,load:async(w,url)=>loads.push(url),assertWindow(){},finishLoginAttempt:()=>finished++};
 const jd=new JdPromotionFee({host});jd.observe=async()=>({status:'logged_in',accountId:'synthetic-id'});
 assert.equal((await jd.login({sessionKey:'synthetic',loginConfirmedAt:'2026-10-23T00:00:00Z'}, {hide(){}})).accountId,'synthetic-id');
 assert.equal(loads.length,1);assert.match(loads[0],/jzt.jd.com/);assert.equal(finished,0);
});

test('账单明确要求重新登录时状态降为待确认，费用失败保留原因',async t=>{
 const {p,shop,dates}=setup(t);p.execute=async()=>({code:'need_login',error:'请先登录该店铺'});p.attention=async()=>{throw Error('测试取消人工等待，保留失败原因');};
 await p.start({...dates,shopIds:[shop.id]});await p.work;assert.equal(p.state().results[0].status,'failed');assert.equal(p.state().results[0].amountCents,null);assert.equal(p.state().shops[0].loginStatus,'需确认登录');assert(p.shop(shop.id).loginConfirmedAt);
});

test('京东保留页面已匹配登录账户时直接复用，不重新打开登录入口',async()=>{
 let loads=0,reads=0;const host={load:async()=>loads++};const jd=new JdPromotionFee({host});jd.observe=async()=>{reads++;return {status:'logged_in',accountId:'synthetic-id'};};
 const win={promotionKeepAlive:true,hide(){}};assert.equal((await jd.login({jdLoginAccountId:'synthetic-id'},win)).accountId,'synthetic-id');assert.equal(loads,0);assert.equal(reads,1);
});

test('京东保留页面已发现错登录账户时原地拒绝，不重导航掩盖错号',async()=>{
 let loads=0,required=0;const jd=new JdPromotionFee({host:{load:async()=>loads++,markLoginRequired:()=>required++}});jd.observe=async()=>({status:'logged_in',accountId:'other-id'});
 await assert.rejects(jd.login({jdLoginAccountId:'synthetic-id'},{promotionKeepAlive:true}),/身份已变化/);assert.equal(loads,0);assert.equal(required,1);
});

for(const status of ['verification','agreement'])test('京东保留页面已有'+status+'时原地处理，不刷新覆盖',async()=>{
 let loads=0,waits=0;const host={load:async()=>loads++,markLoginRequired(){},assertWindow(){},showProblem(){}};
 const jd=new JdPromotionFee({host});jd.observe=async()=>({status});jd.waitForAuth=async(s,w)=>{waits++;assert.equal(w.promotionKeepAlive,true);return {status:'logged_in',accountId:'synthetic-id'};};
 assert.equal((await jd.login({jdLoginAccountId:'synthetic-id'},{promotionKeepAlive:true})).accountId,'synthetic-id');assert.equal(loads,0);assert.equal(waits,1);
});

for(const platform of ['taobao','tmall'])test(platform+'重新登录刷新官方页核验有效会话，不提交凭据',async t=>{
 const {p,win,shop,counts}=setup(t,platform);let loads=0,reads=0;
 p.identity=PromotionFee.prototype.identity.bind(p);
 p.authState=async(w,credentials)=>{assert.equal(credentials,undefined);reads++;return {status:'logged_in',shopName:'synthetic'};};
 p.load=async()=>loads++;p.submitLogin=async()=>{throw Error('有效会话不能提交登录');};
 await p.login(shop.id);await p.loginWork;
 assert.equal(loads,1);assert.equal(reads,2);assert.equal(counts.flush,1);assert.equal(counts.focus,0);
 assert.equal(p.state().error,'');assert.match(p.state().phase,/登录状态已确认/);
});
test('京东重新登录不信保留页面，刷新业务页核验有效会话，不提交凭据',async()=>{
 let loads=0,reads=0;const host={hasLoginAttempt:()=>false,load:async(w,url)=>{loads++;assert.match(url,/jzt.jd.com/);},assertWindow(){}};
 const jd=new JdPromotionFee({host});jd.observe=async(w,input)=>{assert.equal(input,undefined);reads++;return {status:'logged_in',accountId:'synthetic-id'};};
 assert.equal((await jd.login({jdLoginAccountId:'synthetic-id',loginConfirmedAt:'2026-10-23'}, {promotionKeepAlive:true,hide(){}},{revalidate:true})).accountId,'synthetic-id');
 assert.equal(loads,1);assert.equal(reads,2);
});
test('京东旧页面显示登录但刷新后已失效，进入原认证流程',async()=>{
 let reads=0,waits=0,required=0;const host={hasLoginAttempt:()=>false,load:async()=>{},assertWindow(){},markLoginRequired:()=>required++,showProblem(){}};
 const jd=new JdPromotionFee({host});jd.observe=async()=>++reads===1?{status:'logged_in',accountId:'synthetic-id'}:{status:'verification'};
 jd.waitForAuth=async()=>{waits++;return {status:'logged_in',accountId:'synthetic-id'};};
 await jd.login({jdLoginAccountId:'synthetic-id'}, {promotionKeepAlive:true},{revalidate:true});assert.equal(waits,1);assert.equal(required,1);
});
