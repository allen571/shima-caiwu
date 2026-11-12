'use strict';
// 每日计划（定时抓取）测试：假 service/fund 记录每次 start 调用，按脚本控制成败；
// 覆盖：T-1 计算、到点触发/晚开补跑、模块忙顺延、两轮重试只含失败店、结果全量展示（一轮成功+二轮成功+仍失败）、Excel 落盘
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Scheduler,bjDate,bjTime,shiftDate}=require('../electron/scheduler.cjs');

function tempRoot(){return fs.mkdtempSync(path.join(os.tmpdir(),'shima-sched-'));}
// 假模块：start() 后按 preset 把结果行写进 data.results，work 立即 resolve
function fakeService(shops){
 const data={shops,results:[]};let preset=()=>[];
 return {
  data,busy:false,loginBusy:false,exportBusy:false,accountTransferBusy:false,
  calls:[],work:Promise.resolve(),
  setPreset(fn){preset=fn;},
  async start(input){this.calls.push({kind:'promo',...input});preset(input);return {};},
  shop(id){return shops.find(s=>s.id===id);}
 };
}
function fakeFund(shops){
 const data={shops,results:[],exportFolder:''};let preset=()=>[];
 return {
  data,busy:false,downloadBusy:false,diagnosing:false,
  calls:[],work:Promise.resolve(),
  setPreset(fn){preset=fn;},
  async start(input){this.calls.push({kind:'fund',...input});preset(input);return {};}
 };
}
const SHOPS=[
 {id:'t1',name:'淘宝一号店',platform:'taobao'},
 {id:'t2',name:'天猫二号店',platform:'tmall'},
 {id:'j1',name:'京东一号店',platform:'jd'}
];

test('T-1 计算：跨月/跨年都正确；北京时间口径',()=>{
 assert.equal(shiftDate('2026-11-01',-1),'2026-10-31');
 assert.equal(shiftDate('2026-01-01',-1),'2025-12-31');
 assert.equal(shiftDate('2026-03-01',-1),'2026-02-28');
 const ts=Date.UTC(2026,10,9,17,0,0); // UTC 17:00 = 北京 11-10 01:00
 assert.equal(bjDate(ts),'2026-11-10');
 assert.equal(bjTime(ts),'01:00');
 const ts2=Date.UTC(2026,10,8,16,30,0); // 北京 11-09 00:30
 assert.equal(bjDate(ts2),'2026-11-09');
});

test('到点触发：enabled + 时刻已到 + 当天没跑 → 自动抓 T-1；先推广费后资金，资金只含淘宝/天猫',async()=>{
 const root=tempRoot();
 const service=fakeService(SHOPS),fund=fakeFund(SHOPS);
 // 2026-11-09 北京时间 08:31（UTC 00:31）
 const now=()=>Date.UTC(2026,10,9,0,31,0);
 const s=new Scheduler({service,fund,root,now,netProbe:async()=>true,netRetryMs:10});
 s.configure({enabled:true,time:'08:30'});
 service.setPreset(()=>{service.data.results.push({runId:'r1',shopId:'t1',start:'2026-11-08',end:'2026-11-08',status:'completed',amountCents:10000});});
 fund.setPreset(()=>{fund.data.results.push({runId:'f1',shopId:'t1',month:'2026-11',day:'2026-11-08',status:'completed',incomeCents:1,expenseCents:1,balanceCents:1,incomeCount:0,expenseCount:0});});
 await s.tick();
 assert.equal(service.calls.length,1,'第一轮推广费一次');
 assert.equal(service.calls[0].start,'2026-11-08','推广费抓 T-1');
 assert.equal(service.calls[0].end,'2026-11-08');
 assert.deepEqual(service.calls[0].shopIds.map(x=>x.length?x:'').length,3,'推广费含全部账号（含京东）');
 assert.equal(fund.calls.length,1,'第一轮资金一次');
 assert.equal(fund.calls[0].day,'2026-11-08','资金单日模式');
 assert.deepEqual([...fund.calls[0].shopIds].sort(),['t1','t2'],'资金只含淘宝/天猫');
 assert.equal(s.data.lastRun.planDate,'2026-11-08');
 // 当天已跑：再 tick 不重复触发
 await s.tick();
 assert.equal(service.calls.length,1,'当天只跑一次');
});

test('时刻未到不触发；晚开补跑：时刻已过但当天没跑照样触发',async()=>{
 const root=tempRoot();
 const service=fakeService(SHOPS),fund=fakeFund(SHOPS);
 const now=()=>Date.UTC(2026,10,8,23,0,0); // 北京 07:00，设定 08:30 未到
 const s=new Scheduler({service,fund,root,now,netProbe:async()=>true,netRetryMs:10});
 s.configure({enabled:true,time:'08:30'});
 await s.tick();
 assert.equal(service.calls.length,0,'时刻未到不应触发');
 // 换到 09:00（同一天，时刻已过）→ 补跑
 s.now=()=>Date.UTC(2026,10,9,1,0,0);
 await s.tick();
 assert.equal(service.calls.length,1,'晚开也要补跑当天计划');
 assert.equal(service.calls[0].start,'2026-11-08');
});

test('模块忙顺延：到点时正在手动抓取 → 不触发不记 lastRun，空闲后 tick 再跑',async()=>{
 const root=tempRoot();
 const service=fakeService(SHOPS),fund=fakeFund(SHOPS);
 const now=()=>Date.UTC(2026,10,9,0,31,0);
 const s=new Scheduler({service,fund,root,now,netProbe:async()=>true,netRetryMs:10});
 s.configure({enabled:true,time:'08:30'});
 service.busy=true;
 await s.tick();
 assert.equal(service.calls.length,0,'忙时不应触发');
 assert.ok(s.phaseText.includes('顺延')||s.phaseText.includes('正忙'),'应提示顺延：'+s.phaseText);
 assert.equal(s.data.lastRun,null,'忙顺延不记已跑');
 service.busy=false;
 await s.tick();
 assert.equal(service.calls.length,1,'空闲后应触发');
});

test('两轮重试：第一轮 t2 失败 → 第二轮只跑失败店铺；汇总三类齐全且轮次正确',async()=>{
 const root=tempRoot();
 const service=fakeService(SHOPS),fund=fakeFund(SHOPS);
 const now=()=>Date.UTC(2026,10,9,0,31,0);
 const s=new Scheduler({service,fund,root,now,netProbe:async()=>true,netRetryMs:10});
 s.configure({enabled:true,time:'08:30',autoExport:false});
 // 按轮次控制成败：第 1 轮 t1 成功、t2/j1 失败；第 2 轮 t2 成功、j1 仍失败
 let promoRound=0,fundRound=0;
 service.setPreset(input=>{
  promoRound++;
  for(const id of input.shopIds){
   const ok=id==='t1'||(id==='t2'&&promoRound>1);
   service.data.results.push({runId:'p'+promoRound+'-'+id,shopId:id,start:'2026-11-08',end:'2026-11-08',status:ok?'completed':'failed',amountCents:ok?700:0,error:ok?'':(id==='j1'?'账号密码失效':'登录超时')});
  }
 });
 fund.setPreset(input=>{
  fundRound++;
  for(const id of input.shopIds){
   const ok=id==='t1'||(id==='t2'&&fundRound>1);
   fund.data.results.push({runId:'f'+fundRound+'-'+id,shopId:id,month:'2026-11',day:'2026-11-08',status:ok?'completed':'failed',incomeCents:ok?30:null,expenseCents:ok?20:null,balanceCents:ok?300:null,incomeCount:1,expenseCount:1,error:ok?'':'页面没进对'});
  }
 });
 await s.tick();
 assert.equal(service.calls.length,2,'推广费应有两轮');
 assert.deepEqual([...service.calls[1].shopIds].sort(),['j1','t2'],'第二轮只跑失败的店铺');
 assert.equal(fund.calls.length,2,'资金应有两轮');
 assert.deepEqual([...fund.calls[1].shopIds],['t2'],'资金第二轮只跑失败店铺');
 const record=s.data.history[s.data.history.length-1];
 assert.equal(record.rows.length,3,'每家店一行，全部一起体现');
 const byId=Object.fromEntries(record.rows.map(r=>[r.shopId,r]));
 assert.equal(byId.t1.promo.round,1,'t1 一轮成功');
 assert.equal(byId.t2.promo.round,2,'t2 二轮成功');
 assert.equal(byId.t1.fund.round,1,'t1 资金一轮成功');
 assert.equal(byId.t2.fund.round,2,'t2 资金二轮成功');
 assert.equal(byId.j1.fund,null,'京东不参与资金');
 assert.ok(byId.j1.error.includes('账号密码失效'),'仍失败店铺要带出原因');
 assert.equal(record.summary.total,3);
 assert.equal(record.summary.okRound1,1,'t1 一轮成功');
 assert.equal(record.summary.okRound2,1,'t2 二轮成功');
 assert.equal(record.summary.failed,1,'j1 仍失败');
 assert.equal(record.status,'partial');
 assert.equal(s.data.lastRun.planDate,'2026-11-08');
 assert.equal(s.data.lastRun.summary.failed,1);
});

test('自动导出 Excel：跑完在导出目录生成 每日计划_日期.xlsx，三类店铺全部在内',async()=>{
 const root=tempRoot();
 const service=fakeService(SHOPS),fund=fakeFund(SHOPS);
 const now=()=>Date.UTC(2026,10,9,0,31,0);
 const s=new Scheduler({service,fund,root,now,netProbe:async()=>true,netRetryMs:10});
 s.configure({enabled:true,time:'08:30',autoExport:true});
 service.setPreset(input=>{for(const id of input.shopIds)service.data.results.push({runId:'r'+id,shopId:id,start:'2026-11-08',end:'2026-11-08',status:'completed',amountCents:12345});});
 fund.setPreset(input=>{for(const id of input.shopIds)fund.data.results.push({runId:'f'+id,shopId:id,month:'2026-11',day:'2026-11-08',status:'completed',incomeCents:10000,expenseCents:2000,balanceCents:99900,incomeCount:3,expenseCount:1});});
 await s.tick();
 const file=s.data.lastRun.exportFile||'';
 assert.ok(file,'应记录导出文件路径');
 assert.ok(fs.existsSync(file),'Excel 应真实落盘：'+file);
 assert.ok(path.basename(file).includes('2026-11-08'),'文件名含计划日期：'+file);
 // 京东虽不参与资金，推广费行必须在
 const XLSX=require('../vendor/xlsx.full.min.js');
 try{XLSX.set_fs(fs);}catch(e){}
 const wb=XLSX.readFile(file);
 const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1});
 assert.equal(rows.length,4,'表头 + 3 家店铺全量展示');
 const jRow=rows.find(r=>r[1]==='京东一号店');
 assert.ok(jRow,'京东行必须在表里');
 assert.equal(String(jRow[3]),'123.45','京东推广费金额（元）');
});

test('未启用计划：tick 不做任何事；runNow 手动触发不受 enabled 限制',async()=>{
 const root=tempRoot();
 const service=fakeService(SHOPS),fund=fakeFund(SHOPS);
 const now=()=>Date.UTC(2026,10,9,0,31,0);
 const s=new Scheduler({service,fund,root,now,netProbe:async()=>true,netRetryMs:10});
 await s.tick();
 assert.equal(service.calls.length,0,'未启用不应自动触发');
 service.setPreset(input=>{for(const id of input.shopIds)service.data.results.push({runId:'r'+id,shopId:id,start:'2026-11-08',end:'2026-11-08',status:'completed',amountCents:1});});
 fund.setPreset(input=>{for(const id of input.shopIds)fund.data.results.push({runId:'f'+id,shopId:id,month:'2026-11',day:'2026-11-08',status:'completed',incomeCents:1,expenseCents:1,balanceCents:1,incomeCount:0,expenseCount:0});});
 await s.runNow();
 assert.equal(service.calls.length,1,'手动立即运行可用');
 assert.equal(service.calls[0].start,'2026-11-08');
});

test('v1.2.91 二轮含「无/财务号」：completed 但子账户含 none/finance-only 的店进第二轮；两轮后仍 suspect 按无数据处理（不计失败、不带红字）',async()=>{
 const root=tempRoot();
 const service=fakeService(SHOPS),fund=fakeFund(SHOPS);
 const now=()=>Date.UTC(2026,10,9,0,31,0);
 const s=new Scheduler({service,fund,root,now,netProbe:async()=>true,netRetryMs:10});
 s.configure({enabled:true,time:'08:30',autoExport:false});
 // 第一轮：t1 正常成功；t2 顶层 completed 但子账户含 finance-only+none（旧版会漏掉这家）；j1 失败
 service.setPreset(input=>{
  for(const id of input.shopIds){
   if(id==='t2')service.data.results.push({runId:'r1-'+id,shopId:id,start:'2026-11-08',end:'2026-11-08',status:'completed',amountCents:0,accounts:[{accountId:'a1',status:'completed'},{accountId:'a2',status:'finance-only'},{accountId:'a3',status:'none'}]});
   else service.data.results.push({runId:'r1-'+id,shopId:id,start:'2026-11-08',end:'2026-11-08',status:id==='t1'?'completed':'failed',amountCents:id==='t1'?500:0,error:id==='t1'?'':'登录超时'});
  }
 });
 fund.setPreset(input=>{for(const id of input.shopIds)fund.data.results.push({runId:'f1-'+id,shopId:id,month:'2026-11',day:'2026-11-08',status:'completed',incomeCents:100,expenseCents:50,balanceCents:800,incomeCount:1,expenseCount:1});});
 await s.tick();
 // 第二轮推广费必须包含 t2（suspect）和 j1（failed），不含 t1
 assert.equal(service.calls.length,2,'推广费应有两轮');
 assert.deepEqual([...service.calls[1].shopIds].sort(),['j1','t2'],'第二轮须含「无/财务号」店铺，不得漏');
 // 第二轮后 t2 仍 suspect → v1.2.91 口径按无数据处理：保留 suspect 标记、不写红字说明、不计失败；j1 仍 failed；t1 一轮成功
 const record=s.data.history[s.data.history.length-1];
 const byId=Object.fromEntries(record.rows.map(r=>[r.shopId,r]));
 assert.equal(byId.t1.promo.round,1,'t1 一轮成功');
 assert.ok(!byId.t1.promo.suspect,'t1 非 suspect');
 assert.equal(byId.t2.promo.round,1,'t2 记在第一轮（假服务二轮同 runId 被 runRound 过滤）');
 assert.equal(byId.t2.promo.suspect,true,'t2 仍 suspect 要标出（供灰色无数据徽标）');
 assert.equal(byId.t2.error,'','t2 不再写红字说明（按无数据处理）');
 assert.ok(byId.j1.error.includes('登录超时'),'j1 保留原失败原因');
 assert.equal(record.summary.failed,1,'仅 j1 计入失败（t2 按无数据处理）');
 assert.equal(record.summary.okRound1,2,'t1 一轮成功 + t2 按无数据处理计入成功');
 assert.equal(record.summary.okRound2,0,'无二轮成功');
 assert.equal(record.status,'partial');
});

test('v1.2.69 runRound 引用替换回归：save() 整体替换 this.data 后仍能取到本轮结果行（11-09 13:45 run 实锤：抓取全成功、汇总报 0）',async()=>{
 const root=tempRoot();
 // 模拟真实模块行为：start() 时以「引用替换」方式写入结果（this.data=新对象），行带新 runId
 function realLikeService(shops){
  const data={shops,results:[{runId:'old-1',shopId:'t0',start:'2026-11-07',end:'2026-11-07',status:'completed',amountCents:1}]};let n=0;
  return {
   data,busy:false,loginBusy:false,exportBusy:false,accountTransferBusy:false,
   calls:[],work:Promise.resolve(),
   async start(input){
    this.calls.push({kind:'promo',...input});
    const rows=input.shopIds.map(id=>({runId:'run-'+(++n)+'-'+id,shopId:id,start:input.start,end:input.end,status:'completed',amountCents:888}));
    // 关键：与 promotion-fee.cjs save() 相同的引用替换语义
    this.data={...this.data,results:[...this.data.results,...rows]};
    return {};
   },
   shop(id){return shops.find(s=>s.id===id);}
  };
 }
 function realLikeFund(shops){
  const data={shops,results:[],exportFolder:''};let n=0;
  return {
   data,busy:false,downloadBusy:false,diagnosing:false,
   calls:[],work:Promise.resolve(),
   async start(input){
    this.calls.push({kind:'fund',...input});
    const rows=input.shopIds.map(id=>({runId:'frun-'+(++n)+'-'+id,shopId:id,month:'2026-11',day:input.day,status:'completed',incomeCents:10,expenseCents:5,balanceCents:100,incomeCount:1,expenseCount:1}));
    this.data={...this.data,results:[...this.data.results,...rows]};
    return {};
   }
  };
 }
 const service=realLikeService(SHOPS),fund=realLikeFund(SHOPS);
 const now=()=>Date.UTC(2026,10,9,0,31,0);
 const s=new Scheduler({service,fund,root,now:()=>Date.UTC(2026,10,9,0,31,0),netProbe:async()=>true,netRetryMs:10});
 s.configure({enabled:true,time:'08:30',autoExport:false});
 await s.tick();
 const record=s.data.history[s.data.history.length-1];
 const byId=Object.fromEntries(record.rows.map(r=>[r.shopId,r]));
 assert.equal(byId.t1.promo&&byId.t1.promo.status,'completed','推广费行必须取到（旧实现恒为 null）');
 assert.equal(byId.t2.fund&&byId.t2.fund.status,'completed','资金行必须取到（旧实现恒为 missing）');
 assert.equal(record.summary.failed,0,'三家店应全部成功');
 assert.equal(record.status,'done');
});

test('v1.2.69 waitNetworkReady：探测通过立即开跑；持续失败最多等 10 次后照常执行（抓取模块自身有超时兜底）',async()=>{
 const root=tempRoot();
 const service=fakeService(SHOPS),fund=fakeFund(SHOPS);
 let probes=0;
 const s=new Scheduler({service,fund,root,now:()=>Date.UTC(2026,10,9,0,31,0),
  netProbe:async()=>{probes++;return probes>=3;},netRetryMs:10});
 s.configure({enabled:true,time:'08:30',autoExport:false});
 service.setPreset(input=>{for(const id of input.shopIds)service.data.results.push({runId:'r'+probes+'-'+id,shopId:id,start:'2026-11-08',end:'2026-11-08',status:'completed',amountCents:1});});
 fund.setPreset(input=>{for(const id of input.shopIds)fund.data.results.push({runId:'f'+probes+'-'+id,shopId:id,month:'2026-11',day:'2026-11-08',status:'completed',incomeCents:1,expenseCents:1,balanceCents:1,incomeCount:0,expenseCount:0});});
 await s.tick();
 assert.equal(probes,3,'前 2 次失败应重试，第 3 次通过');
 assert.equal(service.calls.length,1,'网络就绪后正常开跑');
 // 始终失败：10 次探测后照常执行（不阻塞当天计划）
 let always=0;
 const s2=new Scheduler({service,fund,root,now:()=>Date.UTC(2026,10,9,0,31,0),
  netProbe:async()=>{always++;return false;},netRetryMs:10});
 s2.data.lastRun=null;
 await s2.tick();
 assert.equal(always,10,'最多探测 10 次');
 assert.equal(service.calls.length,2,'网络一直不通也照常执行（抓取模块有自己的超时与二轮）');
});

test('v1.2.63 UI 脚本兜底：schedule.js/boot.js/index.html 引用一致且能编译（v1.2.61 曾因 IIFE 未闭合整页空白）',()=>{
 const fs=require('node:fs');
 // ① schedule.js 必须能编译（new Function 只编译不执行，浏览器 API 不会触发）
 for(const f of ['ui/schedule.js','ui/boot.js','ui/promotion-fee.js','ui/fund-summary.js'])
  assert.doesNotThrow(()=>new Function(fs.readFileSync(f,'utf8')),f+' 语法必须正确');
 // ② index.html 不再保留独立每日计划页签，但必须有两个嵌入槽
 const html=fs.readFileSync('ui/index.html','utf8');
 assert.ok(!html.includes('data-tab="schedule"'),'不应再有独立每日计划页签');
 assert.ok(html.includes('schedule-slot-promo')&&html.includes('schedule-slot-fund'),'两页都要有嵌入槽');
 // ③ boot.js 必须挂载两个槽
 const boot=fs.readFileSync('ui/boot.js','utf8');
 assert.ok(boot.includes("schedule-slot-promo")&&boot.includes("schedule-slot-fund"),'boot.js 应挂载两个嵌入槽');
});

// —— v1.2.84 跑完自动下载当日明细 ——

// 组装一个「计划全绿」环境：推广费+资金全部一轮完成，资金模块带 downloadDay 记录器
function greenEnv(){
 const root=tempRoot();
 const service=fakeService(SHOPS),fund=fakeFund(SHOPS);
 const now=()=>Date.UTC(2026,10,9,0,31,0); // 北京 2026-11-09 08:31 → T-1 = 11-08
 const s=new Scheduler({service,fund,root,now,netProbe:async()=>true,netRetryMs:10});
 s.configure({enabled:true,time:'08:30',autoExport:false});
 service.setPreset(input=>{for(const id of input.shopIds)service.data.results.push({runId:'r'+id,shopId:id,start:'2026-11-08',end:'2026-11-08',status:'completed',amountCents:100});});
 fund.setPreset(input=>{for(const id of input.shopIds)fund.data.results.push({runId:'f'+id,shopId:id,month:'2026-11',day:'2026-11-08',status:'completed',incomeCents:100,expenseCents:0,balanceCents:100,incomeCount:1,expenseCount:0});});
 return {s,service,fund};
}

test('自动下载当日明细：默认开，只对资金完成的淘宝/天猫店逐家调用单日下载，京东跳过',async()=>{
 const {s,service,fund}=greenEnv();
 fund.detailCalls=[];
 fund.downloadDay=async input=>{fund.detailCalls.push({...input});return {files:['a.xlsx','b.xlsx'],note:''};};
 await s.tick();
 assert.deepEqual(fund.detailCalls.map(c=>c.shopId),['t1','t2'],'只有淘宝/天猫资金完成店参与');
 assert.ok(fund.detailCalls.every(c=>c.date==='2026-11-08'),'单日下载日期必须是 T-1');
 assert.equal(s.data.lastRun.summary.detail.files,4,'明细文件数汇总');
 assert.equal(s.data.lastRun.summary.detail.failed,0);
 assert.equal(s.data.lastRun.summary.detail.shops,2);
});

test('自动下载当日明细：开关关闭时不调用；单店失败不影响计划状态',async()=>{
 // 关开关：不调用
 const a=greenEnv();
 a.fund.detailCalls=[];
 a.fund.downloadDay=async input=>{a.fund.detailCalls.push({...input});return {files:[],note:''};};
 a.s.configure({autoDetailDownload:false});
 await a.s.tick();
 assert.equal(a.fund.detailCalls.length,0,'关闭后不应下载');
 // 开开关但下载全部抛错：计划状态仍由推广费/资金决定，错误记在各行
 const b=greenEnv();
 b.fund.detailCalls=[];
 b.fund.downloadDay=async input=>{throw Error('官方页面加载超时');};
 await b.s.tick();
 assert.equal(b.s.data.lastRun.status,'done','明细下载失败不改变计划成败');
 assert.equal(b.s.data.lastRun.summary.detail.failed,2,'失败家数如实计数');
 assert.ok(b.s.data.lastRun.summary.detail.files===0);
 const rec=b.s.data.history.at(-1);
 assert.equal(rec.rows.find(r=>r.shopId==='t1').detailError,'官方页面加载超时','失败原因落到行上');
});

test('Excel 明细文件列：下载成功的店显示份数，京东店留空',async()=>{
 const {s,service,fund}=greenEnv();
 s.configure({autoExport:true});
 fund.detailCalls=[];
 fund.downloadDay=async input=>({files:['a.xlsx'],note:''});
 await s.tick();
 const XLSX=require('../vendor/xlsx.full.min.js');
 try{XLSX.set_fs(fs);}catch(e){}
 const wb=XLSX.readFile(s.data.lastRun.exportFile);
 const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1});
 assert.equal(rows[0][13],'明细文件','新增「明细文件」列');
 const t1=rows.find(r=>r[1]==='淘宝一号店');
 assert.equal(String(t1[13]),'1 个','资金完成店显示份数');
 const j=rows.find(r=>r[1]==='京东一号店');
 assert.equal(String(j[13]||''),'','京东店该列留空');
});
