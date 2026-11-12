'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {JdPromotionFee}=require('../electron/promotion-fee-jd.cjs');

test('授权列表超时报错附带页面诊断，直接暴露表头变化或入口变化',async()=>{
 const jd=new JdPromotionFee({host:{pageReadyTimeoutMs:60,assertWindow:()=>{}}});
 jd.authorizationState=async()=>({ready:false,reason:'授权列表表头尚未就绪',rows:[],loading:false,empty:false});
 jd.authorizationDiagnostics=async()=>({url:'https://jzt.jd.com/msa/authorize',headers:['被授权账户|授权状态'],body:'账号授权 被授权账户 授权状态 操作'});
 await assert.rejects(jd.waitAuthorizations({}),/授权列表未就绪：授权列表表头尚未就绪.*诊断：页面位于 https:\/\/jzt\.jd\.com\/msa\/authorize，可见表头\[被授权账户\|授权状态\]，页面开头「账号授权/);
});
test('诊断读取失败时错误仍保持原语义，不吞掉真实原因',async()=>{
 const jd=new JdPromotionFee({host:{pageReadyTimeoutMs:60,assertWindow:()=>{}}});
 jd.authorizationState=async()=>({ready:false,reason:'授权列表表头尚未就绪',rows:[],loading:false,empty:false});
 jd.authorizationDiagnostics=async()=>null;
 const error=await jd.waitAuthorizations({}).then(()=>null,e=>e);
 assert.ok(error,'应当抛出超时错误');
 assert.match(error.message,/京东授权列表未就绪：授权列表表头尚未就绪，尚未判定授权是否过期$/);
 assert.ok(!error.message.includes('诊断'),'诊断读取失败时不得追加诊断片段');
});
test('诊断在真实页面上优先暴露表头改名场景',async()=>{
 // 模拟真实故障：页面表头已从「授权账户」改叫「被授权账户」，原判定永不就绪
 const jd=new JdPromotionFee({host:{pageReadyTimeoutMs:60,assertWindow:()=>{}}});
 jd.authorizationState=async()=>({ready:false,reason:'授权列表表头尚未就绪',rows:[],loading:false,empty:false});
 jd.authorizationDiagnostics=async()=>({url:'https://jzt.jd.com/msa/auth',headers:[],body:'暂无权限'});
 await assert.rejects(jd.waitAuthorizations({}),/无可见表格.*页面开头「暂无权限」/);
});
test('财务管理入口未就绪时报错附带多 frame 页面诊断，暴露入口改名或页面变化',async()=>{
 const wc={url:'https://xnjzt.jd.com/home#/index',mainFrame:null};
 const jd=new JdPromotionFee({host:{pageReadyTimeoutMs:60,assertWindow:()=>wc,execute:async(win,script,target)=>false}});
 jd.navigate=async()=>false;
 jd.financeDiagnostics=async()=>({frames:[{frame:'https://xnjzt.jd.com/home#/index',financeTexts:['财务中心','我的账户']}]});
 const error=await jd.navigateReady({},'财务管理').then(()=>null,e=>e);
 assert.ok(error,'应当抛出超时错误');
 assert.match(error.message,/京东财务管理可操作入口未就绪.*诊断：页面\[https:\/\/xnjzt\.jd\.com\/home#\/index\]含「财务」文本\[财务中心 \/ 我的账户\]/);
 assert.ok(!error.message.includes('导航后目标页面未就绪'),'入口从未点中时应报未就绪而非导航后问题');
});
test('jdFrames 覆盖主 frame 与子 frame 且只留京东可信域',()=>{
 const wc={url:'https://xnjzt.jd.com/home#/index',mainFrame:{framesInSubtree:[
  {url:'https://xnjzt.jd.com/home#/index'},{url:'https://jzt.jd.com/embed/finance'},
  {url:'https://evil.example.com/inner'},{url:'about:blank'}
 ]}};
 const jd=new JdPromotionFee({host:{assertWindow:()=>wc}});
 const urls=jd.jdFrames({}).map(f=>f.url);
 assert.deepEqual(urls,['https://xnjzt.jd.com/home#/index','https://jzt.jd.com/embed/finance']);
});
test('jdFrames 对空窗口与缺 url 的 frame 不抛错（waitBody 复用前提）',()=>{
 const jd=new JdPromotionFee({host:{assertWindow:()=>undefined}});
 assert.deepEqual(jd.jdFrames({}),[undefined]);
 const wc={mainFrame:{framesInSubtree:[{},{url:'https://jzt.jd.com/embed/finance'}]}};
 const jd2=new JdPromotionFee({host:{assertWindow:()=>wc}});
 assert.deepEqual(jd2.jdFrames({}).length,2);
});
test('新版账户中心：财务管理步骤在 frame URL 已到 #/financial 时直接就绪，不再点击',async()=>{
 const wc={url:'https://xnjzt.jd.com/account/#/financial',mainFrame:null};
 const jd=new JdPromotionFee({host:{pageReadyTimeoutMs:300,assertWindow:()=>wc,execute:async()=>false}});
 jd.navigate=async()=>{throw Error('URL 已达成进度时不应再点击');};
 await jd.navigateReady({},'财务管理');
});
test('进入财务记录后无收支汇总页签（财务号账户）返回 financeOnly，不报错不再兜底消费记录',async()=>{
 const wc={url:'https://xnjzt.jd.com/account/#/financialRecord',mainFrame:null};
 const scripts=[];
 const jd=new JdPromotionFee({host:{pageReadyTimeoutMs:250,assertWindow:()=>wc,execute:async(win,script)=>{scripts.push(script);return false;}}});
 jd.navigate=async()=>false;
 jd.financeDiagnostics=async()=>({frames:[{frame:'https://xnjzt.jd.com/account/#/financialRecord',financeTexts:['财务记录'],tabs:['充值记录','分配记录','冻结记录','消费记录'],moneyTexts:['充值合计'],placeholders:[]}]});
 assert.equal(await jd.navigateReady({},'收支汇总'),'financeOnly');
 assert.ok(!scripts.some(s=>s.includes('"消费记录"')),'财务号账户不应再点消费记录兜底');
});
test('收支汇总页签存在但始终点不中时仍报错附诊断，不误判为财务号',async()=>{
 const wc={url:'https://xnjzt.jd.com/account/#/financialRecord',mainFrame:null};
 const jd=new JdPromotionFee({host:{pageReadyTimeoutMs:250,assertWindow:()=>wc,execute:async()=>false}});
 jd.navigate=async()=>false;
 jd.financeDiagnostics=async()=>({frames:[{frame:'https://xnjzt.jd.com/account/#/financialRecord',financeTexts:['财务记录'],tabs:['充值记录','消费记录'],moneyTexts:[],placeholders:[],summaryHits:['DIV.fish-tabs-tab 收支汇总']}]});
 const error=await jd.navigateReady({},'收支汇总').then(()=>null,e=>e);
 assert.ok(error,'页签存在时应当抛错而非返回财务号');
 assert.match(error.message,/京东收支汇总可操作入口未就绪/);
 assert.match(error.message,/汇总入口\[DIV\.fish-tabs-tab 收支汇总\]/);
});
test('收支汇总页签非标准结构时用容错匹配点中，报错含汇总入口 DOM 诊断',async()=>{
 const wc={url:'https://xnjzt.jd.com/account/#/financialRecord',mainFrame:null};
 const jd=new JdPromotionFee({host:{pageReadyTimeoutMs:250,assertWindow:()=>wc,execute:async(win,script)=>script.includes('jdSummaryTab')}});
 jd.navigate=async()=>false;
 jd.financeDiagnostics=async()=>({frames:[{frame:'https://xnjzt.jd.com/account/#/financialRecord',financeTexts:['财务记录'],tabs:['充值记录','分配记录','冻结记录','消费记录'],moneyTexts:[],placeholders:['请选择日期'],summaryHits:['DIV.fish-tabs-tab 收支汇总']}]});
 const error=await jd.navigateReady({},'收支汇总').then(()=>null,e=>e);
 assert.ok(error,'应当抛出超时错误');
 assert.match(error.message,/京东已点中「收支汇总」入口，但金额字段未识别/);
 assert.match(error.message,/汇总入口\[DIV\.fish-tabs-tab 收支汇总\]/);
 assert.ok(!error.message.includes('已改点'),'容错点中收支汇总时不应报改点消费记录');
});
test('收支汇总步骤注入容错页签脚本且全部可编译，无消费记录兜底',async()=>{
 const wc={url:'https://xnjzt.jd.com/account/#/financialRecord',mainFrame:null};
 const scripts=[];
 const jd=new JdPromotionFee({host:{pageReadyTimeoutMs:120,assertWindow:()=>wc,execute:async(win,script)=>{scripts.push(script);return false;}}});
 jd.navigate=async()=>false;
 await jd.navigateReady({},'收支汇总').catch(()=>{});
 const summary=scripts.find(s=>s.includes('jdSummaryTab'));
 assert.ok(summary,'应注入收支汇总容错页签脚本');
 assert.ok(!scripts.some(s=>s.includes('"消费记录"')),'不应再注入消费记录兜底脚本');
 for(const script of scripts){
  assert.doesNotThrow(()=>new Function('return ('+script+')'),script.slice(0,60)+'… 应可编译');
 }
 assert.ok(summary.includes("includes('收支汇总')"),'容错匹配应按包含命中收支汇总');
});
test('waitBody 任一金额字段出现即就绪，均未出现则报双字段',async()=>{
 const jd=new JdPromotionFee({host:{assertWindow:()=>{}}});
 let batch=0,seq=0,pages=[['先出现推广费总额（可开票）','页面加载中'],['什么都不含','还是没有字段']];
 jd.host.execute=async()=>{const list=pages[batch];return list[seq++%list.length];};
 await jd.waitBody({},['推广费消费金额','推广费总额'],600);
 batch=1;seq=0;
 const error=await jd.waitBody({},['推广费消费金额','推广费总额'],600).then(()=>null,e=>e);
 assert.match(error.message,/京东页面未显示推广费消费金额 或 推广费总额/);
});
test('jdQuerySummary：财务号不计金额不拖垮店铺状态，全财务号也视为完成',()=>{
 const {jdQuerySummary}=require('../electron/promotion-fee-jd.cjs');
 assert.deepEqual(jdQuerySummary([{status:'finance-only'},{status:'finance-only'}]),{status:'completed',amountCents:null,error:''});
 assert.deepEqual(jdQuerySummary([{status:'completed',amountCents:1234},{status:'finance-only'}]),{status:'completed',amountCents:1234,error:''});
 assert.deepEqual(jdQuerySummary([{status:'completed',amountCents:1234},{status:'failed'}]),{status:'partial',amountCents:1234,error:'部分推广账户未获取，请补查'});
 assert.deepEqual(jdQuerySummary([{status:'none'},{status:'none'}]),{status:'completed',amountCents:null,error:''});
 assert.deepEqual(jdQuerySummary([{status:'completed',amountCents:1234},{status:'none'}]),{status:'completed',amountCents:1234,error:''});
});
test('授权页只有子账号信息卡无列表时标记无推广，不再报授权列表未就绪',async()=>{
 const jd=new JdPromotionFee({host:{pageReadyTimeoutMs:80,assertWindow:()=>{}}});
 jd.authorizationState=async()=>({ready:false,reason:'授权列表表头尚未就绪',rows:[],loading:false,empty:false});
 jd.authorizationDiagnostics=async()=>({url:'https://jzt.jd.com/msa/',headers:[],body:'MUJU-屿珍 子账号 授权PID: 99920166778 状态: 启用 子账号类型为账号 主账号：日本MUJJU佩佩 账号授权'});
 const error=await jd.waitAuthorizations({}).then(()=>null,e=>e);
 assert.ok(error&&error.promotionNone===true,'应带 promotionNone 标记');
 assert.match(error.message,/无推广授权/);
 assert.ok(!error.message.includes('授权列表未就绪'),'无推广授权时不应再报授权列表未就绪');
});
test('授权页慢加载但无子账号信息卡时保持原报错，不误判无推广',async()=>{
 const jd=new JdPromotionFee({host:{pageReadyTimeoutMs:80,assertWindow:()=>{}}});
 jd.authorizationState=async()=>({ready:false,reason:'授权列表表头尚未就绪',rows:[],loading:false,empty:false});
 jd.authorizationDiagnostics=async()=>({url:'https://jzt.jd.com/msa/',headers:[],body:'首页 授权账户 财务中心 加载中'});
 const error=await jd.waitAuthorizations({}).then(()=>null,e=>e);
 assert.ok(error&&!error.promotionNone,'普通慢加载不得误判为无推广');
 assert.match(error.message,/京东授权列表未就绪/);
});
test('财务管理步骤所有 frame 均无财务入口时标记无推广',async()=>{
 const wc={url:'https://jzt.jd.com/msa/#/ife',mainFrame:null};
 const jd=new JdPromotionFee({host:{pageReadyTimeoutMs:120,assertWindow:()=>wc,execute:async()=>false}});
 jd.navigate=async()=>false;
 jd.financeDiagnostics=async()=>({frames:[{frame:'https://jzt.jd.com/msa/#/ife',financeTexts:[],tabs:[],moneyTexts:[],placeholders:[]}]});
 const error=await jd.navigateReady({},'财务管理').then(()=>null,e=>e);
 assert.ok(error&&error.promotionNone===true,'应带 promotionNone 标记');
 assert.match(error.message,/无财务管理入口/);
});
test('readAccount 账户名带「财务」落在财务记录页时返回财务号标记，不进入日期与金额读取',async()=>{
 const {JdLedgerReceipt}=require('../electron/promotion-fee-jd.cjs');
 const open=JdLedgerReceipt.prototype.open,close=JdLedgerReceipt.prototype.close;
 JdLedgerReceipt.prototype.open=async()=>{};JdLedgerReceipt.prototype.close=()=>{};
 try{
  const jd=new JdPromotionFee({host:{assertWindow:()=>{}}});
  const fakeWin={webContents:{debugger:{isAttached:()=>false,attach:async()=>{},on:()=>{},removeListener:()=>{},detach:()=>{}}}};
  let setDatesCalled=false,waitBodyCalled=false;
  jd.financePage=async()=>'financeOnly';
  jd.setDates=async()=>{setDatesCalled=true;};
  jd.waitBody=async()=>{waitBodyCalled=true;};
  const value=await jd.readAccount({},fakeWin,{start:'2026-10-01',end:'2026-10-26'},'123','MUJU木久优选经营部-财务');
  assert.equal(value.financeOnly,true);
  assert.equal(typeof value.note,'string','财务号返回应携带判定依据字段');
  assert.ok(!setDatesCalled&&!waitBodyCalled,'财务号账户不应再走日期与金额环节');
 }finally{JdLedgerReceipt.prototype.open=open;JdLedgerReceipt.prototype.close=close;}
});
test('readAccount 账户名不含「财务」落在财务记录页时按无推广标记',async()=>{
 const {JdLedgerReceipt}=require('../electron/promotion-fee-jd.cjs');
 const open=JdLedgerReceipt.prototype.open,close=JdLedgerReceipt.prototype.close;
 JdLedgerReceipt.prototype.open=async()=>{};JdLedgerReceipt.prototype.close=()=>{};
 try{
  const jd=new JdPromotionFee({host:{assertWindow:()=>{}}});
  const fakeWin={webContents:{debugger:{isAttached:()=>false,attach:async()=>{},on:()=>{},removeListener:()=>{},detach:()=>{}}}};
  jd.financePage=async()=>'financeOnly';
  jd.setDates=async()=>{throw Error('不应设置日期');};
  const error=await jd.readAccount({},fakeWin,{start:'2026-10-01',end:'2026-10-26'},'123','MUJU木久优选经营部').then(()=>null,e=>e);
  assert.ok(error&&error.promotionNone===true,'无「财务」账号应按无推广处理');
  assert.match(error.message,/落在财务记录页且账户名不含「财务」/);
 }finally{JdLedgerReceipt.prototype.open=open;JdLedgerReceipt.prototype.close=close;}
});
test('jdRecordPageStatus 纯函数：账号名含财务为财务号，否则无推广，空值视为无推广',()=>{
 const {jdRecordPageStatus}=require('../electron/promotion-fee-jd.cjs');
 assert.equal(jdRecordPageStatus('MUJU木久优选经营部-财务'),'finance-only');
 assert.equal(jdRecordPageStatus('MUJJU-财务'),'finance-only');
 assert.equal(jdRecordPageStatus('MUJU木久优选经营部'),'none');
 assert.equal(jdRecordPageStatus(''),'none');
 assert.equal(jdRecordPageStatus(undefined),'none');
});
test('收支汇总与财务记录证据均缺失时报网络卡顿请重新抓取，不误判',async()=>{
 const wc={url:'https://xnjzt.jd.com/home#/financial',mainFrame:null};
 const jd=new JdPromotionFee({host:{pageReadyTimeoutMs:60,assertWindow:()=>wc,execute:async()=>false}});
 jd.navigate=async()=>false;
 jd.financeDiagnostics=async()=>({frames:[{frame:'https://xnjzt.jd.com/home#/financial',financeTexts:['财务中心'],tabs:[],moneyTexts:[],placeholders:[]}]});
 await assert.rejects(jd.navigateReady({},'收支汇总'),/网络卡顿.*请重新抓取/);
});
