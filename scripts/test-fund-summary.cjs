'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{AsyncLocalStorage}=require('node:async_hooks');
const {FundSummary,monthRange,monthEnd,parseAmount,parseSummaryRow,menuRectScript,clickTextScript,detailRowsScript,clickDetailScript,depositEntryScript,batchJobs}=require('../electron/fund-summary.cjs');

test('月份区间校验与展开',()=>{
 const months=monthRange({start:'2026-09',end:'2026-11'});
 assert.deepEqual(months,['2026-09','2026-10','2026-11']);
 assert.deepEqual(monthRange({start:'2026-11',end:'2026-11'}),['2026-11']);
 // 跨年
 assert.deepEqual(monthRange({start:'2024-12',end:'2025-02'}),['2024-12','2025-01','2025-02']);
 assert.throws(()=>monthRange({start:'2026-11',end:'2026-10'}),/开始月份不能晚于结束月份/);
 assert.throws(()=>monthRange({start:'2026-13',end:'2026-12'}),/有效的开始、结束月份/);
 assert.throws(()=>monthRange({start:'2024-07',end:'2026-10'}),/2024年8月/);
 assert.throws(()=>monthRange({start:'2030-01',end:'2030-02'}),/当前月/);
 // 全量范围 2024-08 至 2026-11 共 28 个月，跨度上限是兜底保护
 assert.equal(monthRange({start:'2024-08',end:'2026-11'}).length,28);
});
test('月末日期计算（含闰年与年末）',()=>{
 assert.equal(monthEnd('2026-02'),'2026-02-28');
 assert.equal(monthEnd('2024-02'),'2024-02-29');
 assert.equal(monthEnd('2026-12'),'2026-12-31');
 assert.equal(monthEnd('2026-09'),'2026-09-30');
});
test('金额与笔数解析',()=>{
 assert.equal(parseAmount('20,430.62'),2043062);
 assert.equal(parseAmount('¥1,008.5'),100850);
 assert.equal(parseAmount('81,696.65'),8169665);
 assert.equal(parseAmount('0'),0);
 assert.equal(parseAmount(''),null);assert.equal(parseAmount('abc'),null);assert.equal(parseAmount('1.234'),null);
});
test('月汇总行按表头解析，表头缺失退回固定列序',()=>{
 const head=['日期','收入笔数','收入金额（元）','支出笔数','支出金额（元）','期末余额（元）'];
 const cells=['202610','376','20,430.62','282','81,696.65','20,080.9'];
 const row=parseSummaryRow(head,cells);
 assert.deepEqual(row,{month:'202610',incomeCount:376,incomeCents:2043062,expenseCount:282,expenseCents:8169665,balanceCents:2008090,detailCount:null,readable:true});
 // 列序变化时按表头定位
 const shuffled=parseSummaryRow(['支出金额（元）','日期','收入金额（元）','收入笔数','期末余额（元）','支出笔数'],['5.00','202501','3.00','2','1.00','1']);
 assert.equal(shuffled.month,'202501');assert.equal(shuffled.incomeCents,300);assert.equal(shuffled.expenseCents,500);assert.equal(shuffled.incomeCount,2);assert.equal(shuffled.expenseCount,1);assert.equal(shuffled.balanceCents,100);
 // 表头认不出 → 固定列序兜底
 const fallback=parseSummaryRow([],['202611','2','12.34','3','5.00','1.00']);
 assert.equal(fallback.month,'202611');assert.equal(fallback.incomeCents,1234);assert.equal(fallback.expenseCents,500);assert.equal(fallback.incomeCount,2);assert.equal(fallback.expenseCount,3);assert.equal(fallback.balanceCents,100);assert.equal(fallback.readable,true);
 // 金额不可读 → readable=false，不落数值
 const bad=parseSummaryRow(head,['202610','1','—','1','2','3']);
 assert.equal(bad.readable,false);assert.equal(bad.incomeCents,null);
});

test('官方「聚合结算账户」7列列序（金额在笔数前）按表头与兜底都能解析',()=>{
 const head=['日期明细','明细笔数','收入金额（元）','收入笔数','支出金额（元）','支出笔数','期末余额（元）'];
 const cells=['202610','376','20,430.62','94','81,696.65','282','20,080.9'];
 const row=parseSummaryRow(head,cells);
 assert.deepEqual(row,{month:'202610',incomeCount:94,incomeCents:2043062,expenseCount:282,expenseCents:8169665,balanceCents:2008090,detailCount:376,readable:true});
 // 表头认不出时按 7 列真实列序兜底
 const fb=parseSummaryRow([],cells);
 assert.equal(fb.month,'202610');assert.equal(fb.incomeCents,2043062);assert.equal(fb.incomeCount,94);
 assert.equal(fb.expenseCents,8169665);assert.equal(fb.expenseCount,282);assert.equal(fb.balanceCents,2008090);assert.equal(fb.readable,true);
 // 6 列旧列序兜底保持不变
 const old=parseSummaryRow([],['202611','2','12.34','3','5.00','1.00']);
 assert.equal(old.incomeCents,1234);assert.equal(old.incomeCount,2);assert.equal(old.expenseCents,500);assert.equal(old.expenseCount,3);assert.equal(old.balanceCents,100);
});

function stubHost(pages){
 const shops=[{id:'s1',name:'测试旗舰店',platform:'taobao',username:'shop1'}];
 const host={busy:false,loginBusy:false,accountTransferBusy:false,writeFailure:false,concurrency:2,shops,data:{shops},dropped:[],
  dropWindow(id){this.dropped.push(id);},
  queryContext:new AsyncLocalStorage(),
  shop(id){const s=shops.find(s=>s.id===id);if(!s)throw Error('店铺不存在');return s;},
  assertWindow(){return this.__wc||(this.__wc={mainFrame:{framesInSubtree:[]},on(){},capturePage:async()=>({isEmpty:()=>true})});},check(){},
  window(){return {id:'w1'};},
  async authenticate(){return '测试旗舰店';},
  async load(){},
  async execute(win,script,target){if(/clickTextScript/.test(script))return 1;if(/fillMonthScript/.test(script))return {ok:true,how:'typed'};return pages.execute(pages,target);},
  async readPage(win,script,target){return pages.read(pages,target,script);},
 };
 return host;
}
function tempFund(pages){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-fund-test-'));
 const host=stubHost(pages);
 const fund=new FundSummary({autoDownload:false,host,root,downloads:root});
 fund.openTimeoutMs=1500;fund.rowTimeoutMs=1500;
 return {fund,root,host};
}
test('备选抓取：强制重置卡死的抓取锁并重跑；旧任务的落定不得清掉新任务状态（runSeq 守卫）',async()=>{
 const row={row:['202610','1','1.00','1','1.00','1.00'],head:['日期','收入笔数','收入金额（元）','支出笔数','支出金额（元）','期末余额（元）']};
 const pages={read(){return {record:true,tabs:{month:true},monthInputs:[{value:'2026-10-01'}],row:row.row,head:row.head,empty:false,loading:false,body:'',url:''};},execute(){}};
 const {fund}=tempFund(pages);
 // 模拟上一轮卡死：busy 永远 true，work 是迟迟不落的旧 Promise（带旧 seq 的 catch/finally 链，与 start 一致）
 fund.busy=true;let releaseOld;const oldSeq=fund.runSeq||0;
 fund.work=Promise.resolve().then(()=>new Promise(r=>{releaseOld=r;}))
  .catch(e=>{if(oldSeq===fund.runSeq)fund.lastError='旧任务错误';})
  .finally(()=>{if(oldSeq===fund.runSeq){fund.busy=false;fund.phaseText='';}});
 const st=await fund.restart({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 assert.equal(st.busy,true,'restart 应强制清锁并立即启动新一轮');
 releaseOld();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 assert.equal(fund.busy,true,'旧任务的 finally 不得清掉新 run 的 busy（runSeq 守卫）');
 await fund.work;
 assert.equal(fund.busy,false,'新 run 结束后 busy 复位');
 assert.equal(fund.state().results.at(-1).status,'completed');
 // 锁释放后再 restart 一次也应可行（模拟连续两轮备选抓取）
 await fund.restart({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 assert.equal(fund.state().busy,false);
});
test('串行抓取：即使推广费并行数为 4，资金抓取也只同时开一个店铺窗口',async()=>{
 const shops=[
  {id:'s1',name:'A旗舰店',platform:'taobao',username:'a'},
  {id:'s2',name:'B旗舰店',platform:'taobao',username:'b'},
  {id:'s3',name:'C旗舰店',platform:'taobao',username:'c'},
 ];
 let active=0,maxActive=0,logins=0;
 const row={row:['202610','1','1.00','1','1.00','1.00'],head:['日期','收入笔数','收入金额','支出笔数','支出金额','期末余额']};
 const host={busy:false,loginBusy:false,accountTransferBusy:false,writeFailure:false,concurrency:4,shops,data:{shops},queryContext:new AsyncLocalStorage(),
  shop(id){return shops.find(s=>s.id===id);},
  assertWindow(){return this.__wc||(this.__wc={mainFrame:{framesInSubtree:[]},on(){},capturePage:async()=>({isEmpty:()=>true})});},
  check(){},
  window(){return {id:'w1',isDestroyed:()=>false,isVisible:()=>true,hide(){}};},
  // 登录这一步模拟「弹窗需要人工处理」：并行时会同时进来多个店铺
  async authenticate(){logins++;active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,40));active--;return 'x';},
  async load(){},
  async execute(win,script){if(/clickTextScript/.test(script))return 1;if(/fillMonthScript/.test(script))return {ok:true,how:'typed'};return null;},
  async readPage(){return {record:true,tabs:{month:true},monthInputs:[{value:'2026-10-01'}],row:row.row,head:row.head,empty:false,loading:false,body:'',url:''};},
 };
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-fund-serial-'));
 const fund=new FundSummary({autoDownload:false,host,root,downloads:root});
 fund.openTimeoutMs=1500;fund.rowTimeoutMs=1500;
 await fund.start({shopIds:shops.map(s=>s.id),months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 assert.equal(maxActive,1,'同一时刻只允许一个店铺在登录/抓取（实际最大并发 '+maxActive+'）');
 assert.equal(logins,3,'三家店铺都应被抓到');
 assert.deepEqual(fund.state().results.map(r=>r.status),['completed','completed','completed']);
});
test('抓取流程：按月读取并落库收入/支出/余额',async()=>{ const row={row:['202610','376','20,430.62','282','81,696.65','20,080.9'],head:['日期','收入笔数','收入金额（元）','支出笔数','支出金额（元）','期末余额（元）']};
 let reads=0;const pages={read(){reads++;return {fundHome:false,record:true,tabs:{month:true,daily:true,detail:true},monthInputs:[{value:'2026-10-01',readOnly:false}],row:row.row,head:row.head,empty:false,loading:false,body:'',url:''};},execute(){}};
 const {fund}=tempFund(pages);
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 const result=fund.state().results;
 assert.equal(result.length,1);assert.equal(result[0].status,'completed');
 assert.equal(result[0].incomeCents,2043062);assert.equal(result[0].expenseCents,8169665);assert.equal(result[0].balanceCents,2008090);
 assert.equal(result[0].incomeCount,376);assert.equal(result[0].expenseCount,282);
 // 稳定性：金额须连续两次一致才落库
 assert.ok(reads>=2);
});
test('多月份区间逐月出多行，月份对不上判失败',async()=>{
 let month='2026-09';
 const pages={read(){return {record:true,tabs:{month:true},monthInputs:[{value:month+'-01'}],row:[month.replace('-',''),'1','1.00','1','1.00','1.00'],head:['日期','收入笔数','收入金额','支出笔数','支出金额','期末余额'],empty:false,loading:false,body:'',url:''};},execute(){}};
 const {fund}=tempFund(pages);
 // 2026-09 行会正常返回；2026-10 时 readRow 校验 month 不一致 → 失败
 await fund.start({shopIds:['s1'],months:{start:'2026-09',end:'2026-10'}});
 await fund.work;
 const result=fund.state().results;
 assert.equal(result.length,2);
 assert.equal(result[0].status,'completed');assert.equal(result[0].month,'2026-09');
 // 2026-10：表里只有 202609 行、无目标行 → 明确报「没有该行」并列出见到的月份（2026-11-04 12:32 诊断包口径）
 assert.equal(result[1].status,'failed');assert.match(result[1].error,/没有 202610 行/);assert.match(result[1].error,/查询到 202609/);
});
test('无数据月份按「该月无数据」完成而不是失败',async()=>{
 const pages={read(){return {record:true,tabs:{month:true},monthInputs:[{value:'2026-10-01'}],row:null,head:null,empty:true,loading:false,body:'暂无数据',url:''};},execute(){}};
 const {fund}=tempFund(pages);
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 const result=fund.state().results;
 assert.equal(result[0].status,'completed');assert.equal(result[0].incomeCents,0);assert.equal(result[0].error,'该月无数据');
});
test('京东账号被拒之门外；导航打不开报错落失败行',async()=>{
 const pages={read(){return {record:false,fundHome:false,tabs:{},monthInputs:[],row:null,empty:false,loading:false,body:'工作台首页',url:''};},execute(){}};
 const {fund,host}=tempFund(pages);
 host.shops.push({id:'s2',name:'京东店',platform:'jd'});
 await assert.rejects(fund.start({shopIds:['s2'],months:{start:'2026-10',end:'2026-10'}}),/淘宝\/天猫/);
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 assert.equal(fund.state().results[0].status,'failed');
 assert.match(fund.state().results[0].error,/未能打开/);
});
test('上次中断的抓取重新载入为 paused',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-fund-test-'));
 fs.writeFileSync(path.join(root,'fund-summary.json'),JSON.stringify({version:1,exportFolder:'',results:[{runId:'r1',shopId:'s1',shopName:'店',month:'2026-10',status:'running'}]}));
 const fund=new FundSummary({autoDownload:false,host:stubHost({read(){},execute(){}}),root,downloads:root});
 assert.equal(fund.state().results[0].status,'paused');
});
test('暂停后未开始的月份不继续抓，标记为 paused',async()=>{
 const pages={read(){return {record:true,tabs:{month:true},monthInputs:[{value:'2026-10-01'}],row:['202610','1','1.00','1','1.00','1.00'],head:['日期','收入笔数','收入金额','支出笔数','支出金额','期末余额'],empty:false,loading:false,body:'',url:''};},execute(){}};
 const {fund,host}=tempFund(pages);
 // 第二个月份开始填日期时暂停：第一个月完整落库，第二个月停为 paused
 let fills=0;const originalExecute=host.execute.bind(host);
 host.execute=async(win,script)=>{if(/fillMonthScript/.test(script)&&++fills>=2)fund.stopped=true;return originalExecute(win,script);};
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-11'}});
 await fund.work;
 const result=fund.state().results;
 assert.equal(result[0].status,'completed');
 assert.equal(result[1].status,'paused');
});
test('导航失败报错带页面地址与菜单关键词，便于下一轮修复',async()=>{
 const pages={read(){return {fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,body:'千牛工作台主页',url:'https://myseller.taobao.com/home.htm'};},execute(){return {clicked:0,candidates:['财务','收款账户']};}};
 const {fund}=tempFund(pages);
 fund.openTimeoutMs=300;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work.catch(()=>{});
 const row=fund.state().results[0];
 assert.equal(row.status,'failed');
 assert.ok(row.error.includes('地址：https://myseller.taobao.com/home.htm'),'报错应含页面地址：'+row.error);
 assert.ok(row.error.includes('菜单关键词：财务/收款账户'),'报错应含菜单关键词：'+row.error);
});
test('财务应用嵌在 iframe 里也能识别、填日期与读数（跨 frame 探测）',async()=>{
 let fills=0;
 const iframeSt={record:true,tabs:{month:true,daily:true,detail:true},monthInputs:[{value:'2026-10'}],row:['202610','1','2.00','1','1.00','1.00'],head:['日期','收入笔数','收入金额','支出笔数','支出金额','期末余额'],empty:false,loading:false,body:'',url:'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_month'};
 const shellSt={fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,body:'千牛壳页面',url:'https://qn.taobao.com/home.html'};
 const pages={
  read(_p,target){return target==='iframe1'?iframeSt:shellSt;}};
 const {fund,host}=tempFund(pages);
 host.assertWindow=()=>({mainFrame:{framesInSubtree:[undefined,'iframe1']}});
 // stubHost.execute 会拦截 fillMonthScript，这里覆写以便统计各 frame 的填写尝试
 host.execute=async(win,script,gesture,target)=>{
  if(/fillMonthScript/.test(script)){fills++;return target==='iframe1'?{ok:true,how:'typed'}:{ok:false,reason:'未找到日期控件'};}
  if(/clickTextScript/.test(script))return target==='iframe1'?1:0;
  return {};
 };
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'completed');
 assert.equal(r.incomeCents,200);assert.equal(r.expenseCents,100);
 assert.equal(fills,2,'填日期跨 2 个 frame 各尝试一次（shell 失败 + iframe 成功）');
});
test('menuRectScript 返回可见菜单项中心坐标，找不到为 null',()=>{
 // 直接构造最小 DOM 环境运行页面脚本逻辑（无真实 DOM 时不得抛错，返回 null 坐标）
 const fn=eval('('+menuRectScript.toString()+')');
 const fakeEl=t=>({childNodes:[{nodeType:3,textContent:t}],getClientRects:()=>[{}],style:'',querySelectorAll:()=>[],closest:()=>null,checkVisibility:()=>true,getBoundingClientRect:()=>({left:40,top:60,width:80,height:24}),scrollIntoView(){}});
 // 模拟两个候选元素：可见的「财务」与隐藏的「资金管理」
 global.document={querySelectorAll(){return [fakeEl('财务'),{...fakeEl('资金管理'),checkVisibility:()=>false,getClientRects:()=>[]}];},body:{innerText:''}};
 const r=fn('财务','资金管理');
 assert.deepEqual(r.hover,{x:80,y:72});
 assert.equal(r.hit,null,'隐藏菜单项不应返回坐标');
 delete global.document;
});
test('菜单脚本能穿透 shadow DOM 命中 Web Components 里的菜单项',()=>{
 // 千牛侧边栏若是 Web Components，document.querySelectorAll 穿不透 shadow root，
 // 常规查询会一直落空——这正是「三版都点不到资金管理」的怀疑根因，这里锁住递归兜底能力
 let clicked=0;
 const menuItem={tagName:'SPAN',className:'menu-item',childNodes:[{nodeType:3,textContent:'资金管理'}],getClientRects:()=>[{}],style:'',querySelectorAll:()=>[],closest:()=>null,checkVisibility:()=>true,getBoundingClientRect:()=>({left:100,top:200,width:80,height:24}),scrollIntoView(){},click(){clicked++;}};
 const shadowRoot={querySelectorAll(sel){return sel.includes('span')?[menuItem]:[];}};
 const hostEl={tagName:'QN-SIDEBAR',className:'sidebar',shadowRoot,childNodes:[],getClientRects:()=>[{}],style:'',querySelectorAll(sel){return [];},closest:()=>null,checkVisibility:()=>true,getBoundingClientRect:()=>({left:0,top:0,width:200,height:800}),scrollIntoView(){}};
 global.document={querySelectorAll(sel){return sel==='*'?[hostEl]:[];},body:{innerText:''}};
 const rect=eval('('+menuRectScript.toString()+')');
 assert.deepEqual(rect('财务','资金管理').hit,{x:140,y:212},'shadow root 里的菜单项应返回坐标');
 assert.equal(eval('('+clickTextScript.toString()+')')('资金管理'),1,'clickTextScript 也应穿透 shadow DOM');
 assert.equal(clicked,1,'应真的点到 shadow root 内的元素');
 delete global.document;
});
test('menuRectScript hover 目标优先侧边栏区域：顶部「财务」角色标签不得劫持（12:41 截图实锤 hover 顶部标签打开账号菜单）',()=>{
 const fn=eval('('+menuRectScript.toString()+')');
 const mkEl=(text,{left,top,descendants=0}={})=>({
  childNodes:[{nodeType:3,textContent:text}],getClientRects:()=>[{}],style:'',
  querySelectorAll:()=>new Array(descendants).fill({}),closest:()=>null,checkVisibility:()=>true,
  getBoundingClientRect:()=>({left,top,width:80,height:24}),scrollIntoView(){}});
 // 顶部角色标签：元素更小（0 个后代，旧排序规则必选它），位置在顶部右侧
 const topBadge=mkEl('财务',{left:950,top:20});
 // 侧边栏真菜单项：带子结构（3 个后代），位置在左侧栏
 const sideMenu=mkEl('财务',{left:90,top:300,descendants:3});
 // 账号下拉容器（含「退出当前账号」项）——应返回收起坐标
 const container={getBoundingClientRect:()=>({left:880,top:60,width:220,height:240})};
 const dismissEl={childNodes:[{nodeType:3,textContent:'退出当前账号'}],getClientRects:()=>[{}],style:'',querySelectorAll:()=>[],closest:sel=>sel&&/popup|overlay|menu|dropdown|panel/.test(sel)?container:null,checkVisibility:()=>true,getBoundingClientRect:()=>({left:900,top:80,width:120,height:30}),scrollIntoView(){}};
 global.document={querySelectorAll(){return [topBadge,sideMenu,dismissEl];},body:{innerText:''}};
 const r=fn('财务','收支记录');
 assert.deepEqual(r.hover,{x:130,y:312},'hover 应命中侧边栏「财务」而非顶部角色标签：'+JSON.stringify(r.hover));
 assert.deepEqual(r.dismiss,{x:820,y:30},'检测到账号下拉展开应返回收起坐标：'+JSON.stringify(r.dismiss));
 delete global.document;
});
test('menuRectScript：同名菜单项离悬浮项太远不算命中（16:50 日志：财务 y=507 却命中 y=188 的「资金管理」，点了假目标）',()=>{
 const fn=eval('('+menuRectScript.toString()+')');
 const mk=(text,left,top)=>({childNodes:[{nodeType:3,textContent:text}],getClientRects:()=>[{}],style:'',querySelectorAll:()=>[],closest:()=>null,checkVisibility:()=>true,getBoundingClientRect:()=>({left,top,width:80,height:24}),scrollIntoView(){}});
 // 财务在侧栏下方 y≈507；页面里另有一个「资金管理」在 y≈188（相距 319px，不是展开出来的子项）
 global.document={querySelectorAll(){return [mk('财务',25,495),mk('资金管理',112,176)];},body:{innerText:''}};
 let r=fn('财务','资金管理');
 assert.equal(r.hit,null,'远处同名项不应算命中：'+JSON.stringify(r.hit));
 assert.ok(r.diag&&r.diag.rejected,'应把被拒候选记进诊断：'+JSON.stringify(r.diag));
 // 真子项紧贴「财务」下方（y≈540）：应正常命中
 global.document={querySelectorAll(){return [mk('财务',25,495),mk('资金管理',60,528)];},body:{innerText:''}};
 r=fn('财务','资金管理');
 assert.deepEqual(r.hit,{x:100,y:540},'紧邻悬浮项的子项应命中：'+JSON.stringify(r.hit));
 delete global.document;
});
test('armDownload 窗口重建后仍放行：session handler 用当前任务窗口比对，不再吞掉新窗口下载（12:55 vldoliya 逐行点击零文件实锤）',async()=>{
 const {EventEmitter}=require('events');
 const ses=new EventEmitter();
 const mkWin=()=>({webContents:{session:ses},isDestroyed:()=>false,isVisible:()=>true,hide(){}});
 const win1=mkWin(),win2=mkWin();
 const {fund}=tempFund({});
 fund.armDownload(win1);
 fund.armDownload(win2); // 二轮重试 dropWindow 后重建窗口：必须更新当前任务窗口
 let saved=null,prevented=false;
 const ctx={win:win2,dir:'/tmp',prefix:'x',files:[],started:false,idle:null,timer:null,settle(){}};
 fund.downloadCtx=ctx;
 const item={getFilename:()=>'2218742008899_20261101_0.xlsx',setSavePath(p){saved=p;},once(evt,fn){if(evt==='done')setImmediate(()=>fn({},'completed'));}};
 ses.emit('will-download',{preventDefault(){prevented=true;}},item);
 assert.equal(prevented,false,'新窗口的下载不应被旧闭包的 win 比对吞掉');
 assert.ok(saved,'应设置保存路径');
 assert.equal(ctx.started,true,'应标记下载已开始');
 await new Promise(r=>setImmediate(r));
 assert.equal(ctx.files.length,1,'done 后文件应进上下文');
 fund.downloadCtx=null;
});
test('armOssRedirect 拦截 OSS 直链：will-navigate 立即 preventDefault 保页，did-start-navigation 只延后 stop（v1.2.55 去重入）',async()=>{
 const {EventEmitter}=require('events');
 const wc=new EventEmitter();let stopped=0;wc.stop=()=>{stopped++;};
 const win={webContents:wc,isDestroyed:()=>false};
 const {fund}=tempFund({});
 const track=fund.armOssRedirect(win);
 const OSS='https://taobao-finance.oss-cn-zhangjiakou.aliyuncs.com/fund/bill/detail/batch/2218742008899/ba_2218742008899/2218742008899_20261101_0.xlsx?Expires=1&Signature=x';
 // ① will-navigate：导航尚未开始时同步拦下——保页且零重入（旧版在这里 stop 是崩溃高危点）
 let prevented=0;
 wc.emit('will-navigate',{url:OSS,preventDefault(){prevented++;}},OSS);
 assert.equal(prevented,1,'will-navigate 应同步 preventDefault 保住原页');
 assert.equal(stopped,0,'will-navigate 阶段不需要 stop');
 assert.equal(track.urls.length,1,'OSS 直链应被记录');
 // ② did-start-navigation 兜底（如服务端重定向直接跳到 OSS）：stop 推到下一轮事件循环再执行
 wc.emit('did-start-navigation',{url:OSS},OSS);
 assert.equal(stopped,0,'不得在导航回调内同步 stop（重入曾导致主进程原生崩溃）');
 await new Promise(r=>setImmediate(r));
 assert.equal(stopped,1,'下一轮事件循环应 stop 保住原页');
 assert.equal(track.urls.length,1,'同一直链去重');
 wc.emit('did-start-navigation',{url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'},'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home');
 await new Promise(r=>setImmediate(r));
 assert.equal(stopped,1,'普通页面导航不应被 stop');
 // ③ window.open(OSS 直链)：由 armWindowOpen 记在 wc 上，drain 取走后同样产出候选
 wc.__shimaOssHits=['https://x.aliyuncs.com/fund/bill/3.xlsx'];
 track.drain();
 assert.equal(track.urls.length,2,'drain 应把 window.open 命中的直链并入候选');
 track.off();
 wc.emit('did-start-navigation',{url:'https://x.aliyuncs.com/fund/bill/2.xlsx'},'https://x.aliyuncs.com/fund/bill/2.xlsx');
 await new Promise(r=>setImmediate(r));
 assert.equal(track.urls.length,2,'off 后不再记录');
});
test('realMenuClick：hover 后子菜单出现则真实点击坐标，没出现则真点悬浮项再找一次',async()=>{
 const rects=[
  {hover:{x:10,y:20},hit:null},   // 首次量：只有悬浮项
  {hover:{x:10,y:20},hit:null},   // 合成指针/hover 后：子菜单仍未出现
  {hover:{x:10,y:20},hit:null},   // hover 复量：仍未出现（走真实点击悬浮项）
  {hover:{x:10,y:20},hit:{x:30,y:40}}, // 真点悬浮项后：子菜单出现
 ];
 const events=[];let reads=0;
 const shops=[{id:'s1',name:'测试旗舰店',platform:'taobao',username:'shop1'}];
 const host={busy:false,loginBusy:false,accountTransferBusy:false,writeFailure:false,concurrency:2,shops,data:{shops},queryContext:new AsyncLocalStorage(),
  shop(id){return shops[0];},assertWindow(){},check(){},window(){return {id:'w1'};},async authenticate(){return 'x';},async load(){},
  async readPage(){return rects[Math.min(reads++,rects.length-1)];},
  async sendMouse(win,type,x,y){events.push(type+'@'+x+','+y);return true;}};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-fund-rc-'));
 const fund=new FundSummary({autoDownload:false,host,root,downloads:root});
 fund.inspectAll=async()=>({url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'}); // v1.2.70：点击后视为已导航
 const ok=await fund.realMenuClick({id:'w1'},'财务','资金管理');
 assert.equal(ok,true);
 assert.ok(events.filter(e=>e==='mouseDown@10,20').length>=1,'悬浮项真实点击（展开子菜单）');
 assert.equal(events.includes('mouseDown@30,40'),true,'菜单项坐标真实点击');
 assert.equal(events[0],'mouseMove@10,20','先移动到悬浮项');
});
test('realMenuClick：主 frame 量不到菜单时逐子 frame 继续量（16:14 截图：侧栏「财务」在 frame 里，旧版只查主 frame 永远点不中）',async()=>{
 const rects={mainframe:null,childframe:{hover:{x:100,y:494},hit:{x:150,y:520}}};
 const events=[];const calls=[];
 const shops=[{id:'s1',name:'测试旗舰店',platform:'taobao',username:'shop1'}];
 const host={busy:false,loginBusy:false,accountTransferBusy:false,writeFailure:false,concurrency:2,shops,data:{shops},queryContext:new AsyncLocalStorage(),
  shop(id){return shops[0];},check(){},window(){return {id:'w1'};},async authenticate(){return 'x';},async load(){},
  assertWindow(){return {mainFrame:{framesInSubtree:['mainframe','childframe']}};},
  async readPage(win,script,frame){calls.push(frame);return rects[frame]||null;},
  async sendMouse(win,type,x,y){events.push(type+'@'+x+','+y);return true;}};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-fund-rc2-'));
 const fund=new FundSummary({autoDownload:false,host,root,downloads:root});
 fund.inspectAll=async()=>({url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'}); // v1.2.70：点击后视为已导航
 const ok=await fund.realMenuClick({id:'w1'},'财务','资金管理');
 assert.equal(ok,true,'子 frame 量到坐标应点击成功');
 assert.ok(calls.includes('childframe'),'应到子 frame 量坐标：'+calls.join(','));
 assert.ok(events.includes('mouseDown@150,520'),'按子 frame 坐标真实点击菜单项');
});
test('realMenuClick 点击前重新量坐标：浮层弹出导致漂移时按新坐标落点并记 menu-drift（v1.2.60）',async()=>{
 // 用户录屏实锤：hover 展开浮层后页面位置会变，点击前必须复量，不能拿首测坐标硬点
 const rects=[
  {hover:{x:10,y:20},hit:{x:30,y:40}}, // 首次量（子项已就位）
  {hover:{x:10,y:20},hit:{x:30,y:44}}, // 点击前复量：已漂移 4px
 ];
 const events=[];let reads=0;
 const shops=[{id:'s1',name:'测试旗舰店',platform:'taobao',username:'shop1'}];
 const host={busy:false,loginBusy:false,accountTransferBusy:false,writeFailure:false,concurrency:2,shops,data:{shops},queryContext:new AsyncLocalStorage(),
  shop(id){return shops[0];},assertWindow(){},check(){},window(){return {id:'w1'};},async authenticate(){return 'x';},async load(){},
  async readPage(){return rects[Math.min(reads++,rects.length-1)];},
  async sendMouse(win,type,x,y){events.push(type+'@'+x+','+y);return true;}};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-fund-drift-'));
 const fund=new FundSummary({autoDownload:false,host,root,downloads:root});
 fund.inspectAll=async()=>({url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'}); // v1.2.70：点击后视为已导航
 const ok=await fund.realMenuClick({id:'w1'},'财务','资金管理');
 assert.equal(ok,true);
 assert.ok(events.includes('mouseDown@30,44'),'应按复量后的新坐标点击：'+events.join('|'));
 assert.equal(events.includes('mouseDown@30,40'),false,'不得按漂移前的旧坐标点击');
 const logText=fs.readFileSync(path.join(root,'fund.log'),'utf8');
 assert.ok(logText.includes('menu-drift'),'坐标漂移应落日志：'+logText);
});
test('menuRectScript 不再滚动页面：元素在视口内时零 scrollIntoView（v1.2.60 录屏实锤「点击之后页面位置会变」）',()=>{
 // 旧版每次 center() 都 scrollIntoView({block:'center'})，程序自己把侧栏滚走 → 刚量的坐标立刻作废。
 // 录屏里侧栏整体上滚、「首页」滚出视口，就是这个动作造成的。
 const fn=eval('('+menuRectScript.toString()+')');
 let scrolls=0;
 const mk=(text,left,top)=>({textContent:text,childNodes:[{nodeType:3,textContent:text}],getClientRects:()=>[{}],style:'',querySelectorAll:()=>[],closest:()=>null,checkVisibility:()=>true,getBoundingClientRect:()=>({left,top,width:80,height:24}),scrollIntoView(){scrolls++;}});
 global.window={innerWidth:1280,innerHeight:800,devicePixelRatio:1};
 global.document={querySelectorAll(){return [mk('财务',25,495),mk('资金管理',60,528)];},body:{innerText:''}};
 const r=fn('财务','资金管理');
 assert.deepEqual(r.hit,{x:100,y:540},'可见元素应直接给坐标：'+JSON.stringify(r.hit));
 assert.equal(scrolls,0,'可见元素不得触发任何滚动');
 delete global.window;delete global.document;
});
test('menuRectScript 命中自检：中心点命中相邻项时改用矩形内真正命中目标项的点（v1.2.60：浮层项间距 40px 误点「总览」）',()=>{
 const fn=eval('('+menuRectScript.toString()+')');
 const mk=(text,left,top)=>({textContent:text,childNodes:[{nodeType:3,textContent:text}],getClientRects:()=>[{}],style:'',querySelectorAll:()=>[],closest:()=>null,checkVisibility:()=>true,getBoundingClientRect:()=>({left,top,width:80,height:24}),scrollIntoView(){}});
 const fin=mk('资金管理',60,528);   // rect 528~552，中心 540
 const zong=mk('总览',60,504);      // 浮层上一项
 global.window={innerWidth:1280,innerHeight:800,devicePixelRatio:1};
 global.document={
  querySelectorAll(){return [mk('财务',25,495),fin,zong];},body:{innerText:''},
  // 中心点 540 被上层「总览」的阴影/热区挡住，只有 544 才真正命中「资金管理」
  elementFromPoint(x,y){if(y===540)return zong;if(y>=528&&y<=552)return fin;if(y>=504&&y<528)return zong;return null;}
 };
 const r=fn('财务','资金管理');
 assert.equal(r.hitText,'资金管理','hitText 应为自检后真正命中的目标项：'+JSON.stringify(r));
 assert.deepEqual(r.hit,{x:100,y:544},'应改用矩形内真正命中目标项的点：'+JSON.stringify(r.hit));
 delete global.window;delete global.document;
});
test('手动接管：等待用户点到资金页，确认后继续抓取',async()=>{
 const shell={fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,body:'工作台首页',url:'https://myseller.taobao.com/home.htm'};
 const ok={record:true,tabs:{month:true,daily:true,detail:true},monthInputs:[{value:'2026-10'}],row:['202610','2','3.00','1','1.00','2.00'],head:['日期','收入笔数','收入金额','支出笔数','支出金额','期末余额'],empty:false,loading:false,body:'',url:'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_month'};
 let confirmed=false;
 const pages={read(){return confirmed?ok:shell;},execute(){}};
 const {fund}=tempFund(pages);
 fund.openTimeoutMs=1500;fund.rowTimeoutMs=1500;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'},manual:true});
 await new Promise(r=>setTimeout(r,400));
 assert.equal(fund.state().manualPending&&fund.state().manualPending.shopId,'s1','等待中应暴露等待店铺');
 confirmed=true;fund.confirmManual('s1');
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'completed');assert.equal(r.incomeCents,300);
 assert.equal(fund.state().manualPending,null,'结束后不再显示等待条');
});
test('手动接管：已落在资金页会自动放行，不必点确认；跳过则记失败',async()=>{
 const ok={record:true,tabs:{month:true},monthInputs:[{value:'2026-10'}],row:['202610','1','5.00','1','1.00','4.00'],head:['日期','收入笔数','收入金额','支出笔数','支出金额','期末余额'],empty:false,loading:false,body:'',url:'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_month'};
 const {fund}=tempFund({read(){return ok;},execute(){}});
 fund.openTimeoutMs=1500;fund.rowTimeoutMs=1500;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'},manual:true});
 await fund.work;
 assert.equal(fund.state().results[0].status,'completed','已在资金页应自动继续');

 const shell={fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,body:'工作台首页',url:''};
 const second=tempFund({read(){return shell;},execute(){}});
 second.fund.openTimeoutMs=1500;second.fund.rowTimeoutMs=1500;
 await second.fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'},manual:true});
 await new Promise(r=>setTimeout(r,300));
 second.fund.skipManual('s1');
 await second.fund.work;
 const r=second.fund.state().results[0];
 assert.equal(r.status,'failed');assert.match(r.error,/已手动跳过/);
});
test('诊断导出：写出 JSON 与截图，含各 frame 地址与菜单候选',async()=>{
 const diag={url:'https://myseller.taobao.com/home.htm/QnworkbenchHome/',xdUrl:'https://qn.taobao.com/app/x',title:'千牛工作台',body:'管家 协议 财务 资金',menu:[{t:'财务',tag:'span',cls:'menu-item',href:'',r:{x:10,y:200,w:60,h:24}}],keywords:[{t:'资金管理',tag:'span',cls:'sub',href:'',r:{x:80,y:230,w:80,h:24}}],iframes:[{src:'https://g.alicdn.com/platform/xdomain-iframe/frame.html',visible:true}],inputs:0};
 const {fund,host,root}=tempFund({read(){return diag;},execute(){}});
 fund.desktop=root;fund.downloads=root;fund.diagnoseWaitMs=0;
 host.assertWindow=()=>({mainFrame:{framesInSubtree:[]},setWindowOpenHandler(){},capturePage:async()=>({isEmpty:()=>false,toPNG:()=>Buffer.from('fake-png')})});
 const out=await fund.diagnose('s1');
 assert.ok(out.dir&&fs.existsSync(out.dir),'诊断目录应存在');
 const file=path.join(out.dir,'诊断.json');
 assert.ok(fs.existsSync(file),'诊断.json 应存在');
 const report=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(report.shop.name,'测试旗舰店');
 assert.equal(report.stages.length,4,'初始/直达链接/真实点击/结束四组快照');
 assert.equal(report.stages[0].frames[0].xdUrl,'https://qn.taobao.com/app/x','桥内地址应被解码保留');
 assert.equal(report.stages[0].frames[0].menu[0].t,'财务');
 assert.ok(Array.isArray(report.events),'导航事件流应落盘');
 assert.ok(Array.isArray(report.cdpTargets),'CDP target 列表应落盘');
 assert.equal(typeof report.manual.reached,'object','手动到达结果应记录');
 assert.ok(fs.existsSync(path.join(out.dir,'页面截图.png')),'截图应存在');
 assert.ok(fs.existsSync(path.join(out.dir,'说明.txt')),'说明文件应存在');
 assert.equal(fund.state().diagnosing,false);
});
test('抓取失败自动生成诊断包：JSON+DOM+截图落盘，错误信息带路径，无需用户多点一步',async()=>{
 const diag={url:'https://myseller.taobao.com/home.htm/QnworkbenchHome/',xdUrl:'https://qn.taobao.com/app/x',title:'千牛工作台',body:'财务 资金管理',menu:[{t:'财务',tag:'span',cls:'',href:'',r:{x:10,y:200,w:60,h:24}}],keywords:[],iframes:[],inputs:0};
 const pages={read(_p,target,script){
  if(/dumpHtmlScript/.test(script))return {url:'https://shell',html:'<div>壳页DOM</div>'};
  return diag;
 },execute(){}};
 const {fund,host}=tempFund(pages);
 fund.openTimeoutMs=300;
 const wcStub={mainFrame:{framesInSubtree:['f1']},listeners:[],on(evt,fn){this.listeners.push([evt,fn]);},capturePage:async()=>({isEmpty:()=>false,toPNG:()=>Buffer.from('png-bytes')})};
 host.assertWindow=()=>wcStub;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work.catch(()=>{});
 const row=fund.state().results[0];
 assert.equal(row.status,'failed');
 assert.ok(row.error.includes('已自动生成诊断包'),'错误信息应带诊断包路径：'+row.error);
 const dir=row.error.match(/已自动生成诊断包：(.+?)（/)[1];
 const report=JSON.parse(fs.readFileSync(path.join(dir,'诊断.json'),'utf8'));
 assert.equal(report.trigger,'抓取失败自动采集');
 assert.equal(report.shop.name,'测试旗舰店');
 assert.ok(Array.isArray(report.events),'导航事件流应落盘');
 assert.equal(report.frames[0].xdUrl,'https://qn.taobao.com/app/x','桥内地址应保留');
 assert.ok(fs.existsSync(path.join(dir,'frame-1.html')),'每 frame DOM 应落盘');
 assert.ok(fs.readFileSync(path.join(dir,'frame-1.html'),'utf8').includes('壳页DOM'));
 assert.ok(fs.existsSync(path.join(dir,'页面截图.png')),'截图应落盘');
 assert.ok(wcStub.listeners.some(l=>l[0]==='did-start-navigation'),'抓取期间应挂导航事件监听');
 // 同店铺第二个月份再失败不应重复采集
 assert.equal(fund.failCapturedShops.has('s1'),true);
});
test('直达链接被弹回后：优先走「收支记录」入口（用户确认的财务总览路径），再退菜单导航',async()=>{
 const shell={fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:true},body:'卖家中心财务总览',url:'https://myseller.taobao.com/home.htm'};
 const loads=[];
 const {fund,host}=tempFund({read(){return shell;},execute(){}});
 // 页面始终停在总览（模拟直达被弹回）；「收支记录」入口返回一个与直达链接不同的 href
 host.execute=async(win,script)=>{
  if(/menuProbeScript/.test(script))return {clicked:0,candidates:[],hrefs:['https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?entry=record']};
  if(/clickTextScript/.test(script))return 0;
  return {};
 };
 host.load=async(win,url)=>{loads.push(url);};
 // 超时要覆盖：直达 load + 1.5s 等待 + 弹回识别 + 入口 load + 1.5s 等待
 fund.openTimeoutMs=4200;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work.catch(()=>{});
 const r=fund.state().results[0];
 assert.equal(r.status,'failed');
 assert.ok(loads.some(u=>/home\.htm\/whale-accountant\/pay\/capital\/home\?active=fund_month/.test(u)),'直达链接应先试新域（v1.2.42 起资金管理优先，收支账单是错页）：'+loads.join(' | '));
 assert.ok(loads.includes('https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?entry=record'),'弹回后应 load 收支记录入口：'+loads.join(' | '));
 // 入口与直达是同一地址时同轮内不应重复 load（triedHrefs 去重）；
 // v1.2.50 起导航失败会自动跑第二轮（每轮=直达+入口），跨轮重复是预期行为
 assert.equal(loads.length%2,0,'应完整跑两轮（每轮 直达+入口）：'+loads.join(' | '));
 for(let i=0;i<loads.length;i+=2)assert.notEqual(loads[i],loads[i+1],'同轮内不应重复 load 同一地址：'+loads.join(' | '));
});
test('弹回后重试直达：入口/菜单都找不到时，应周期性重新 load 直达链接（16:03 诊断包场景：子应用会话冷掉，重新走鉴权）',async()=>{
 const shell={fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:true},body:'工作台首页 公告 消息 预警通知',url:'https://myseller.taobao.com/home.htm/QnworkbenchHome/'};
 const loads=[];
 const {fund,host}=tempFund({read(){return shell;},execute(){}});
 // 页面始终停在千牛工作台首页且找不到任何「收支记录/聚合结算账户/资金管理」入口（16:03 现场实况）
 host.execute=async(win,script)=>{
  if(/menuProbeScript/.test(script))return {clicked:0,candidates:[],hrefs:[]};
  if(/clickTextScript/.test(script))return 0;
  return {};
 };
 host.load=async(win,url)=>{loads.push(url);};
 fund.openTimeoutMs=9000;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work.catch(()=>{});
 const r=fund.state().results[0];
 assert.equal(r.status,'failed');
 // v1.2.42 候选轮换：直达不再重复同一 URL；v1.2.70 旧域 qn 直达提到第二位，弹回后必须真能轮到
 const n=loads.filter(u=>/whale-accountant\/(bill\/summary|pay\/capital\/home)/.test(u)).length;
 assert.ok(n>=2,'直达链接被弹回后应周期性重新 load 候选（实际 '+n+' 次）：'+loads.join(' | '));
 assert.ok(loads.some(u=>/qn\.taobao\.com\/home\.html\/whale-accountant/.test(u)),'候选轮换应包含旧域 qn 直达（v1.2.70 提到第二位，此前永远轮不到）：'+loads.join(' | '));
});
test('弹回新版首页后：真实鼠标点「财务 → 收支记录」（用户手动验证的入口）后继续抓取（2026-11-06 批量下载场景）',async()=>{
 const shell={fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:true},body:'天猫首页 公告 消息 预警通知',url:'https://myseller.taobao.com/home.htm/QnworkbenchHome/'};
 const record={fundHome:true,record:true,tabs:{daily:true},monthInputs:[{value:'2026-10-01',readOnly:false}],row:['202610','5','100.00','3','50.00','50.00'],head:['日期','收入笔数','收入金额（元）','支出笔数','支出金额（元）','期末余额（元）'],empty:false,loading:false,micro:{present:true,loaded:true},body:'日汇总 月汇总',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home?active=fund_day'};
 let clicked=false;
 const pages={read(p,target,script){
  // menuRectScript：点击「财务」前子菜单未渲染（hit 为空），真实点击后「收支记录」出现
  if(/menuRectScript/.test(script))return clicked?{hover:{x:40,y:300},hit:{x:90,y:330}}:{hover:{x:40,y:300},hit:null};
  return clicked?record:shell;
 },execute(){}};
 const {fund,host}=tempFund(pages);
 host.sendMouse=async(win,type,x,y)=>{if(type==='mouseUp')clicked=true;return true;};
 fund.openTimeoutMs=20000;fund.rowTimeoutMs=8000;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'completed','弹回后应通过真实点击「财务 → 收支记录」进入并抓完：'+r.error);
 assert.equal(r.incomeCents,10000);
});
test('资金页微应用挂载超时：回首页重启外壳后再直跳（13:39 诊断包场景，同址重载无效）',async()=>{
 const stuck=()=>({fundHome:true,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:false},body:'资金管理 财务',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home?active=fund_month'});
 const home=()=>({fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:true},body:'工作台首页 公告',url:'https://myseller.taobao.com/home.htm/QnworkbenchHome/'});
 const ready=()=>({fundHome:true,record:true,tabs:{month:true},monthInputs:[{value:'2026-10-01',readOnly:false}],row:['202610','5','100.00','3','50.00','50.00'],head:['日期','收入笔数','收入金额（元）','支出笔数','支出金额（元）','期末余额（元）'],empty:false,loading:false,micro:{present:true,loaded:true},body:'月汇总',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home?active=fund_month'});
 let page='stuck';const loads=[];
 const pages={read(){return page==='stuck'?stuck():page==='home'?home():ready();},execute(){}};
 const {fund,host}=tempFund(pages);
 host.load=async(win,url)=>{loads.push(url);page=/QnworkbenchHome/.test(url)?'home':'fund';};
 fund.openTimeoutMs=20000;fund.rowTimeoutMs=15000;fund.microWaitMs=800;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'completed','挂载超时回首页重启外壳后应抓完：'+r.error);
 assert.ok(loads.length>=2,'应先回首页重启外壳再直跳：'+loads.join(' | '));
 assert.ok(/QnworkbenchHome/.test(loads[0]),'第一跳应是外壳首页：'+loads.join(' | '));
 assert.ok(/pay\/capital\/home/.test(loads[loads.length-1]),'重启后应直跳回资金路由：'+loads.join(' | '));
});
test('资金页微应用挂载超时：优先真实点击侧边栏「财务→资金管理」重触发挂载，全程不 load URL（15:25 诊断包截图场景）',async()=>{
 const stuck=()=>({fundHome:true,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:false},body:'资金管理 财务 总览',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'});
 const ready=()=>({fundHome:true,record:true,tabs:{month:true},monthInputs:[{value:'2026-10-01',readOnly:false}],row:['202610','5','100.00','3','50.00','50.00'],head:['日期','收入笔数','收入金额（元）','支出笔数','支出金额（元）','期末余额（元）'],empty:false,loading:false,micro:{present:true,loaded:true},body:'月汇总',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'});
 let page='stuck';const loads=[];let clicks=0;
 const pages={read(p,t,script){if(/menuRectScript/.test(String(script)))return{hover:{x:120,y:200},hovers:[{x:120,y:200}],hit:{x:120,y:200}};return page==='stuck'?stuck():ready();},execute(){}};
 const {fund,host}=tempFund(pages);
 host.sendMouse=async(win,type,x,y)=>{if(type==='mouseUp'){clicks++;page='ready';}};
 host.load=async(win,url)=>{loads.push(url);};
 fund.openTimeoutMs=20000;fund.rowTimeoutMs=15000;fund.microWaitMs=600;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'completed','真实点击侧边栏挂载成功后应抓完：'+r.error);
 assert.ok(clicks>=1,'应发生真实鼠标点击侧边栏菜单');
 assert.equal(loads.length,0,'菜单点击挂载成功后不应再 load 任何 URL（SPA 内部导航即可）：'+loads.join(' | '));
});
test('外壳已启动在首页：按人工路径菜单点「资金管理」→页面点「收支记录」进页，不再 load 直达链接（v1.2.56 用户截图路径）',async()=>{
 const home=()=>({fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:true},body:'工作台首页 公告',url:'https://myseller.taobao.com/home.htm/QnworkbenchHome/'});
 const ready=()=>({fundHome:true,record:true,tabs:{month:true},monthInputs:[{value:'2026-10-01',readOnly:false}],row:['202610','5','100.00','3','50.00','50.00'],head:['日期','收入笔数','收入金额（元）','支出笔数','支出金额（元）','期末余额（元）'],empty:false,loading:false,micro:{present:true,loaded:true},body:'月汇总',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'});
 let page='home';const loads=[];let clicks=0;
 const pages={read(p,t,script){if(/menuRectScript/.test(String(script)))return{hover:{x:100,y:300},hovers:[{x:100,y:300}],hit:{x:100,y:300}};return page==='home'?home():ready();},execute(){}};
 const {fund,host}=tempFund(pages);
 host.sendMouse=async(win,type)=>{if(type==='mouseUp'){clicks++;page='ready';}};
 host.load=async(win,url)=>{loads.push(url);};
 fund.openTimeoutMs=20000;fund.rowTimeoutMs=15000;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'completed','按人工路径进页后应抓完：'+r.error);
 assert.ok(clicks>=1,'应真实点击侧边栏菜单');
 assert.equal(loads.length,0,'点进记录页后不应再 load 任何直达链接：'+loads.join(' | '));
});
test('v1.2.56 人工路径：菜单「资金管理」点中后应继续点页面「收支记录」链接（用户 11-08 截图：菜单里没有收支记录项）',async()=>{
 const home=()=>({fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:true},body:'工作台首页 公告',url:'https://myseller.taobao.com/home.htm/QnworkbenchHome/'});
 const overview=()=>({fundHome:true,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:true},body:'资金账户 收支记录',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'});
 const ready=()=>({fundHome:true,record:true,tabs:{month:true},monthInputs:[{value:'2026-10-01',readOnly:false}],row:['202610','5','100.00','3','50.00','50.00'],head:['日期','收入笔数','收入金额（元）','支出笔数','支出金额（元）','期末余额（元）'],empty:false,loading:false,micro:{present:true,loaded:true},body:'月汇总',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'});
 let page='home';const loads=[];let recordLinkClicks=0;
 const pages={read(p,t,script){
  if(/menuRectScript/.test(String(script)))return{hover:{x:100,y:300},hovers:[{x:100,y:300}],hit:{x:100,y:300}};
  return page==='home'?home():page==='overview'?overview():ready();
 }};
 const {fund,host}=tempFund(pages);
 host.sendMouse=async(win,type)=>{if(type==='mouseUp')page='overview';};
 host.load=async(win,url)=>{loads.push(url);};
 host.execute=async(win,script)=>{
  const s=String(script);
  if(/clickTextScript/.test(s)&&s.includes('收支记录')){recordLinkClicks++;page='ready';return 1;}
  if(/fillMonthScript/.test(s))return {ok:true,how:'typed'};
  return 0;
 };
 fund.openTimeoutMs=20000;fund.rowTimeoutMs=15000;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'completed','菜单进资金管理后点页面「收支记录」应抓完：'+r.error);
 assert.ok(recordLinkClicks>=1,'进入资金管理总览后应点击页面「收支记录」链接');
 assert.equal(loads.length,0,'全程应走点击而非直达链接：'+loads.join(' | '));
});
test('登录后 15 秒页面无反应：自动重新触发一次登录再继续导航（用户 11-08 点名要求）',async()=>{
 let authCalls=0;const loads=[];
 const stuck=()=>({fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:false},body:'千牛工作台',url:'https://myseller.taobao.com/home.htm'});
 const ready=()=>({fundHome:true,record:true,tabs:{month:true},monthInputs:[{value:'2026-10'}],row:['202610','5','100.00','3','50.00','50.00'],head:['日期','收入笔数','收入金额（元）','支出笔数','支出金额（元）','期末余额（元）'],empty:false,loading:false,micro:{present:true,loaded:true},body:'月汇总',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home?active=fund_month'});
 const {fund,host}=tempFund({read(){return authCalls<2?stuck():ready();},execute(){}});
 host.authenticate=async()=>{authCalls++;return '测试旗舰店';};
 host.load=async(win,u)=>{loads.push(u);};
 fund.authKickMs=1200;fund.openTimeoutMs=30000;fund.rowTimeoutMs=15000;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work.catch(()=>{});
 const r=fund.state().results[0];
 assert.equal(r.status,'completed','kick 登录后应能进页抓完：'+r.error);
 assert.equal(authCalls,2,'登录放行后静止应恰好再触发一次登录：'+authCalls);
});
test('15 秒停滞看门狗：页面无任何变化时回首页重新进入，再按手动路径点菜单跳目标页（用户 11-08 要求）',async()=>{
 const stuck=()=>({fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:true},body:'工作台首页 公告 消息',url:'https://myseller.taobao.com/home.htm/QnworkbenchHome/'});
 const ready=()=>({fundHome:true,record:true,tabs:{month:true},monthInputs:[{value:'2026-10'}],row:['202610','5','100.00','3','50.00','50.00'],head:['日期','收入笔数','收入金额（元）','支出笔数','支出金额（元）','期末余额（元）'],empty:false,loading:false,micro:{present:true,loaded:true},body:'月汇总',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home?active=fund_month'});
 let page='stuck';const loads=[];let clicks=0;
 const pages={read(p,t,script){if(/menuRectScript/.test(String(script)))return{hover:{x:100,y:300},hovers:[{x:100,y:300}],hit:{x:100,y:300}};return page==='stuck'?stuck():ready();},execute(){}};
 const {fund,host}=tempFund(pages);
 // 重新进入（看门狗触发 load）之后菜单点击才生效——模拟「卡住→自动重进→手动路径点进去」
 host.sendMouse=async(win,type)=>{if(type==='mouseUp'&&loads.length){clicks++;page='ready';}};
 host.load=async(win,url)=>{loads.push(url);};
 fund.stallMs=800;fund.openTimeoutMs=20000;fund.rowTimeoutMs=15000;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'completed','看门狗重进+菜单点击后应抓完：'+r.error);
 assert.ok(loads.some(u=>/QnworkbenchHome/.test(u)),'停滞应触发回首页重新进入：'+loads.join(' | '));
 assert.ok(clicks>=1,'重进后应按手动路径真实点击菜单');
});
test('停在首页不动：一/二级轮换直达候选、三级回首页重启（菜单判死复位）、五级抛错走二轮（用户 11-08：弹窗后停滞在首页）',async()=>{
 // 旧逻辑只有一级恢复（回首页），而页面本来就在首页 → sig 不变、一直耗到 150 秒超时，
 // 用户看到的就是「窗口开着停在首页不动」。v1.2.70：直达候选轮满 3 个（含旧域 qn）→ 回首页 → 再直达 → 抛错
 const stuck={fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:true},body:'工作台首页 公告',url:'https://myseller.taobao.com/home.htm/QnworkbenchHome/'};
 const loads=[];
 const {fund,host}=tempFund({read(){return stuck;},execute(){}});
 host.load=async(win,url)=>{loads.push(url);};
 fund.shellBootMs=200;fund.stallMs=300;fund.openTimeoutMs=15000;fund.rowTimeoutMs=3000;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'failed','持续停在首页应判失败，而不是空转到导航超时');
 assert.match(String(r.error),/连续停滞/,'错误里应说明是页面连续停滞：'+r.error);
 assert.ok(loads.some(u=>/whale-accountant/.test(u)),'直达候选应被轮换尝试：'+loads.join(' | '));
 assert.ok(loads.some(u=>/qn\.taobao\.com/.test(u)),'旧域 qn 候选必须真能轮到（v1.2.70 核心）：'+loads.join(' | '));
 assert.ok(loads.some(u=>/QnworkbenchHome/.test(u)),'三级应回首页重启外壳：'+loads.join(' | '));
});
test('抓取二轮重试：首轮导航失败销毁窗口重开再跑一轮，仅导航类错误触发（18:42 三诊断包场景）',async()=>{
 const {fund,host}=tempFund({});
 let calls=0;
 fund.queryOnce=async()=>{calls++;
  if(calls===1)throw Error('未能打开「日汇总」页（已尝试直达链接多次重载、真实点击与菜单导航），页面停留在：公告');
  return {incomeCents:1,incomeCount:1,expenseCents:0,expenseCount:0,balanceCents:1,source:'日汇总累计',days:1};
 };
 const row=await fund.query({id:'s1',name:'测试旗舰店'},'2026-10');
 assert.equal(row.incomeCents,1,'第二轮应正常拿到数据');
 assert.deepEqual(host.dropped,['s1'],'首轮导航失败应销毁窗口重开新窗');
 // 非导航类错误（如行缺失回落日汇总的内部错误）不应触发重试
 host.dropped.length=0;calls=0;
 fund.queryOnce=async()=>{calls++;throw Error('没有 202610 行');};
 await assert.rejects(()=>fund.query({id:'s1',name:'测试旗舰店'},'2026-10'),/没有 202610 行/);
 assert.deepEqual(host.dropped,[],'非导航类错误不应销毁窗口重试');
 assert.equal(calls,1);
 // v1.2.51：官方页面自行崩溃（窗口已关闭）同样属于可恢复导航失败——销毁重开再跑一轮
 host.dropped.length=0;calls=0;
 fund.queryOnce=async()=>{calls++;
  if(calls===1)throw Error('该店铺的千牛窗口已关闭，请补查该店铺');
  return {incomeCents:2,incomeCount:1,expenseCents:0,expenseCount:0,balanceCents:2,source:'日汇总累计',days:1};
 };
 const row2=await fund.query({id:'s1',name:'测试旗舰店'},'2026-10');
 assert.equal(row2.incomeCents,2,'窗口关闭后第二轮应恢复成功');
 assert.deepEqual(host.dropped,['s1'],'窗口已关闭也应销毁窗口重开');
});
test('导出二轮重试：首轮导航失败销毁窗口重开再跑，结束后锁释放（批量下载同路径）',async()=>{
 const {fund,host}=tempFund({});
 let calls=0;
 fund.downloadRun=async(shop,label,month)=>{calls++;
  if(calls===1)throw Error('未能打开「月汇总」页（已尝试直达链接多次重载、真实点击与菜单导航）');
  assert.equal(label,'日汇总');assert.equal(month,'2026-10');
  return {files:['a.xlsx'],note:''};
 };
 const r=await fund.download({shopId:'s1',kind:'daily',month:'2026-10'});
 assert.deepEqual(r.files,['a.xlsx'],'第二轮应正常导出');
 assert.deepEqual(host.dropped,['s1'],'首轮导航失败应销毁窗口重开新窗');
 assert.equal(fund.downloadBusy,false,'导出结束后锁应释放');
});
test('冷壳直跳被弹回：先回首页完成外壳启动，再直跳资金路由（13:44 弹回链实锤）',async()=>{
 const blank=()=>({fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:false,loaded:false},body:'',url:'about:blank'});
 const home=()=>({fundHome:false,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:true},body:'工作台首页 公告',url:'https://myseller.taobao.com/home.htm/QnworkbenchHome/'});
 const ready=()=>({fundHome:true,record:true,tabs:{month:true},monthInputs:[{value:'2026-10-01',readOnly:false}],row:['202610','5','100.00','3','50.00','50.00'],head:['日期','收入笔数','收入金额（元）','支出笔数','支出金额（元）','期末余额（元）'],empty:false,loading:false,micro:{present:true,loaded:true},body:'月汇总',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home?active=fund_month'});
 let page='blank';const loads=[];
 const pages={read(){return page==='blank'?blank():page==='home'?home():ready();},execute(){}};
 const {fund,host}=tempFund(pages);
 host.load=async(win,url)=>{loads.push(url);page=/QnworkbenchHome/.test(url)?'home':'fund';};
 fund.openTimeoutMs=20000;fund.rowTimeoutMs=15000;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'completed','冷壳引导后应抓完：'+r.error);
 assert.ok(/QnworkbenchHome/.test(loads[0]),'第一跳应是外壳首页（不冷壳直跳资金路由）：'+loads.join(' | '));
 assert.ok(loads.some(u=>/pay\/capital\/home\?active=fund_month/.test(u)),'外壳启动后应直跳资金路由：'+loads.join(' | '));
});
test('新版工作台微前端未挂载：耐心等待不 reload，挂载后正常抓完（12:28 诊断包场景）',async()=>{
 const t0=Date.now();
 const waiting=()=>({fundHome:true,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:false},body:'资金管理 财务 总览',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'});
 const ready=()=>({fundHome:true,record:true,tabs:{month:true,daily:true},monthInputs:[{value:'2026-10-01',readOnly:false}],row:['202610','5','100.00','3','50.00','50.00'],head:['日期','收入笔数','收入金额（元）','支出笔数','支出金额（元）','期末余额（元）'],empty:false,loading:false,micro:{present:true,loaded:true},body:'月汇总',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'});
 const pages={read(){return Date.now()-t0<3500?waiting():ready();},execute(){}};
 const loads=[];
 const {fund,host}=tempFund(pages);
 host.load=async(win,url)=>{loads.push(url);};
 fund.openTimeoutMs=30000;fund.rowTimeoutMs=15000;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'completed');
 assert.equal(r.incomeCents,10000);
 assert.equal(loads.filter(u=>/whale-accountant/.test(u)).length,0,'微应用挂载等待期间不应 reload 打断（越打越慢）：'+loads.join(' | '));
},60000);
test('新版工作台停在「资金账户」总览（该页只有资金账户一个页签）：应先点「聚合结算账户」，点不进才换候选入口',async()=>{
 // 2026-11-05 15:30 三店诊断包实况 + 16:51 用户截图指正：正确路径是 资金管理 > 聚合结算账户 > 三页签
 const onlyCapital={fundHome:true,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:true},body:'资金账户 微信支付签约信息 聚合结算账户',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'};
 const loads=[],clicks=[];
 const {fund,host}=tempFund({read(){return onlyCapital;},execute(){}});
 host.load=async(win,url)=>{loads.push(url);};
 host.execute=async(win,script)=>{if(/menuProbeScript/.test(script))return {clicked:0,candidates:[],hrefs:[]};if(/clickTextScript/.test(script)){if(/聚合结算账户/.test(script))clicks.push(1);return 0;}return {};};
 fund.openTimeoutMs=16000;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work.catch(()=>{});
 const r=fund.state().results[0];
 assert.equal(r.status,'failed');
 assert.ok(clicks.length>=1,'总览没有目标页签时应点击「聚合结算账户」进入结算账户视图：'+JSON.stringify(clicks));
 assert.ok(loads.some(u=>/pay\/capital\/home/.test(u)),'仍应先走「资金管理」直达入口：'+loads.join(' | '));
 assert.match(r.error,/聚合结算账户/,'失败原因应给出「聚合结算账户」人工核对指引');
},40000);
test('fillDates 校验：当月结束日期与官方默认区间重合时不得误判成功（腾乐健 11-06 实锤），起始日期精确命中才算通过',async()=>{
 // 官方把写值重置回默认区间 10-06~11-06：end=2026-11-06（今天）恰好相等，旧判定 some(start||end) 假通过
 const vals={list:['2026-10-06','2026-11-06']};
 const {fund,host}=tempFund({read(){return {fundHome:true,record:true,tabs:{daily:true},monthInputs:[{value:'2026-10-06'}],row:null,rowsDay:[],head:null,empty:false,loading:false,body:'日汇总',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home?active=fund_day'};}});
 host.execute=async(win,script)=>{
  if(/fillMonthScript/.test(script))return {ok:true,how:'typed'};
  if(/querySelectorAll\("input"\)/.test(script))return vals.list.slice();
  if(/clickTextScript/.test(script))return 1;
  return null;
 };
 fund.fillTimeoutMs=2500;
 await assert.rejects(fund.fillDates({id:'w1'},'2026-11-01','2026-11-06'),/无法自动填写|没有生效/,'默认区间重合不得假通过');
 // 起始日期真正写进去（回读到 2026-11-01）才放行，且返回 searched 标记
 vals.list=['2026-11-01','2026-11-06'];
 const ok=await fund.fillDates({id:'w1'},'2026-11-01','2026-11-06');
 assert.equal(ok.searched,true,'成功路径应返回 searched=true');
},20000);
test('日汇总空表：点过搜索且页面持续「没有数据」→ 返回该月无数据而非报错（腾乐健 11-06 实锤）',async()=>{
 const page={fundHome:true,record:true,tabs:{month:true,daily:true},monthInputs:[{value:'2026-11-01'}],row:null,rows:[],rowsDay:[],head:null,empty:true,loading:false,body:'日汇总 没有数据',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home?active=fund_day'};
 const {fund,host}=tempFund({read(){return page;}});
 fund.rowTimeoutMs=8000;
 host.execute=async(win,script)=>{
  if(/fillMonthScript/.test(script))return {ok:true,how:'typed'};
  if(/querySelectorAll\("input"\)/.test(script))return [];
  if(/clickTextScript/.test(script))return 1;
  return null;
 };
 const row=await fund.queryDaily({id:'w1'},{name:'腾乐健医疗器械旗舰店'},'2026-11');
 assert.equal(row.empty,true,'官方明确空态应产出「无数据」结果');
 assert.equal(row.incomeCents,0);assert.equal(row.days,0);
 assert.match(row.note,/没有数据/,'备注应说明官方显示没有数据并提示人工核对');
 assert.ok(fund.state);
},30000);
test('新版工作台微应用始终不挂载：等待超时后换候选入口（含「总览」），而不是死磕同一链接',async()=>{
 const shell={fundHome:true,record:false,tabs:{},monthInputs:[],row:null,head:null,empty:false,loading:false,micro:{present:true,loaded:false},body:'资金管理 财务 总览',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'};
 const loads=[];
 const {fund,host}=tempFund({read(){return shell;},execute(){}});
 host.load=async(win,url)=>{loads.push(url);};
 fund.microWaitMs=1000;fund.openTimeoutMs=25000;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work.catch(()=>{});
 const r=fund.state().results[0];
 assert.equal(r.status,'failed');
 assert.ok(loads.includes('https://myseller.taobao.com/home.htm/whale-accountant/index'),'等待超时应换「总览」入口让财务微应用挂载：'+loads.join(' | '));
},90000);
test('页签守卫：查询后应用自行跳到日汇总页签时，自动点回月汇总继续等数（12:17 诊断包场景）',async()=>{
 let mode='day';
 const day={fundHome:true,record:true,tabs:{month:true,daily:true},monthInputs:[{value:'2026-09-01'}],row:null,head:null,empty:false,loading:false,body:'日汇总',url:'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_day'};
 const month={fundHome:true,record:true,tabs:{month:true,daily:true},monthInputs:[{value:'2026-09-01'}],row:['202609','1','2.00','1','1.00','1.00'],head:['日期','收入笔数','收入金额','支出笔数','支出金额','期末余额'],empty:false,loading:false,body:'月汇总',url:'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_month'};
 const {fund}=tempFund({read(){return mode==='day'?day:month;},execute(){}});
 fund.openTimeoutMs=1500;fund.rowTimeoutMs=6000;
 await fund.start({shopIds:['s1'],months:{start:'2026-09',end:'2026-09'}});
 // readRow 首轮发现停在日汇总 → 守卫点「月汇总」拉回 → 页面状态翻转为月汇总后正常出数
 setTimeout(()=>{mode='month';},600);
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'completed');
 assert.equal(r.incomeCents,200);assert.equal(r.month,'2026-09');
});
test('next-table 表头/表体分离：全页收表头+数据行（12:32 诊断包场景）',()=>{
 const {fundInspect}=require('../electron/fund-summary.cjs');
 const cell=t=>({innerText:t,childNodes:[{nodeType:3,textContent:t}],getClientRects:()=>[{}],closest:()=>null,checkVisibility:()=>true,querySelectorAll:()=>[]});
 const headText='日期 明细笔数 收入金额（元） 收入笔数 支出金额（元） 支出笔数 期末余额（元） 操作';
 const headTable={tagName:'TABLE',getClientRects:()=>[{}],closest:()=>null,checkVisibility:()=>true,querySelector(sel){return sel==='thead'?{innerText:headText,querySelectorAll(s){return s.includes('th')?['日期','明细笔数','收入金额（元）','收入笔数','支出金额（元）','支出笔数','期末余额（元）','操作'].map(cell):[];}}:null;},querySelectorAll(){return [];}};
 const tr={querySelectorAll(s){return s.includes('td')?['202610','151','12,053.67','62','7,793.70','89','4,259.97','下载明细'].map(cell):[];}};
 const bodyTable={tagName:'TABLE',getClientRects:()=>[{}],closest:()=>null,checkVisibility:()=>true,querySelector(){return null;},querySelectorAll(s){return s==='tr'?[tr]:[];}};
 global.document={body:{innerText:'资金管理聚合结算账户月汇总'},querySelectorAll(sel){if(sel==='table,[role=table]')return [headTable,bodyTable];if(sel==='input')return [];return [];}};
 global.location={hostname:'qn.taobao.com',href:'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_month'};
 const st=eval('('+fundInspect.toString()+')()');
 assert.equal(st.row[0],'202610','应从分离的表体表里取到数据行');
 assert.equal(st.rows.length,1);
 assert.equal(st.head.length,8,'应从分离的表头表里取到表头');
 assert.equal(st.head[2],'收入金额（元）');
 // 明细笔数列（用户 2026-11-04 要求）：202610 行对应 151
 const {parseSummaryRow}=require('../electron/fund-summary.cjs');
 const parsed=parseSummaryRow(st.head,st.row);
 assert.equal(parsed.detailCount,151,'明细笔数应从第 2 列解析');
 assert.equal(parsed.incomeCents,1205367);assert.equal(parsed.incomeCount,62);
});
test('区间多行时按目标月挑行：区间 202609~202610 查 2026-10 出 202610 行',async()=>{
 const rows=[['202609','1','1.00','1','1.00','1.00'],['202610','2','2.00','1','1.00','1.00']];
 const pages={read(){return {record:true,tabs:{month:true},monthInputs:[{value:'2026-09'},{value:'2026-10'}],row:rows[0],rows,head:['日期','收入笔数','收入金额','支出笔数','支出金额','期末余额'],empty:false,loading:false,body:'',url:'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_month'};},execute(){}};
 const {fund}=tempFund(pages);
 fund.rowTimeoutMs=6000;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'completed','应从多行里挑出目标月 202610：'+r.error);
 assert.equal(r.month,'2026-10');assert.equal(r.incomeCents,200);
});
test('当月没有月汇总账单：直接进日汇总页按天累加（用户 2026-11 口径）',async()=>{
 const cm=new Date(Date.now()+28800000).toISOString().slice(0,7);
 const head=['日期','明细笔数','收入金额（元）','收入笔数','支出金额（元）','支出笔数','期末余额（元）','操作'];
 const rowsDay=[[cm+'-01','10','100.00','10','50.00','5','1,000.00','下载明细'],[cm+'-02','20','200.00','20','60.00','6','1,140.00','下载明细']];
 const pages={read(){return {fundHome:true,record:true,tabs:{month:true,daily:true,detail:true},monthInputs:[{value:'2025-10'},{value:'2025-11'}],row:null,rows:[],rowsDay,head,empty:false,loading:false,body:'日汇总',url:'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_day'};},execute(){}};
 const {fund,host}=tempFund(pages);
 const loads=[];host.load=async(w,u)=>loads.push(u);
 fund.rowTimeoutMs=4000;
 await fund.start({shopIds:['s1'],months:{start:cm,end:cm}});
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'completed','当月应走日汇总累加：'+r.error);
 assert.ok(!loads.some(u=>/active=fund_month/.test(u)),'当月不应先去月汇总空等：'+loads.join(' | '));
 assert.equal(r.incomeCents,30000);assert.equal(r.expenseCents,11000);
 assert.equal(r.incomeCount,30);assert.equal(r.expenseCount,11);
 assert.equal(r.detailCount,30,'明细笔数按天累加（10+20）');
 assert.equal(r.balanceCents,114000,'期末余额取当月最后一天');
 assert.equal(r.source,'日汇总累计');assert.equal(r.days,2);
});
test('历史月月汇总尚无行时回落日汇总累加，不判整家店失败',async()=>{
 let mode='month';
 const head=['日期','明细笔数','收入金额（元）','收入笔数','支出金额（元）','支出笔数','期末余额（元）','操作'];
 const rowsDay=[['2026-10-01','10','100.00','10','50.00','5','1,000.00','下载明细'],['2026-10-02','20','200.00','20','60.00','6','1,140.00','下载明细']];
 const pages={read(){
   if(mode==='day')return {fundHome:true,record:true,tabs:{month:true,daily:true},monthInputs:[{value:'2026-10'}],row:null,rows:[],rowsDay,head,empty:false,loading:false,body:'日汇总',url:'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_day'};
   return {fundHome:true,record:true,tabs:{month:true,daily:true},monthInputs:[{value:'2026-10'}],row:null,rows:[],rowsDay:[],head,empty:false,loading:false,body:'月汇总',url:'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_month'};
  },execute(){}};
 const {fund,host}=tempFund(pages);
 host.load=async(w,u)=>{if(/active=fund_day/.test(u))mode='day';};
 fund.rowTimeoutMs=1200;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work;
 const r=fund.state().results[0];
 assert.equal(r.status,'completed','月汇总无行应回落日汇总：'+r.error);
 assert.equal(r.incomeCents,30000);assert.equal(r.balanceCents,114000);assert.equal(r.source,'日汇总累计');
});
test('下载明细走行级流程：先按所选月份填日期区间，再收集目标月行逐行点击（2026-11-05 用户指正）',async()=>{
 const calls=[];
 const host=stubHost({read(){return {fundHome:true,record:true,tabs:{month:true,daily:true},monthInputs:[{value:'2026-10'}],row:null,rows:[],rowsDay:[],head:null,empty:false,loading:false,body:'日汇总',url:'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_day'};}});
 host.execute=async(win,script)=>{if(/fillMonthScript/.test(script)){calls.push({t:'fill',dates:(script.match(/\d{4}-\d{2}-\d{2}/g)||[])});return {ok:true,how:'typed'};}if(/clickTextScript/.test(script)){calls.push({t:'click'});return 1;}if(/detailRowsScript/.test(script)){calls.push({t:'rows'});return [];}return null;};
 const fund=new FundSummary({autoDownload:false,host,root:fs.mkdtempSync(path.join(os.tmpdir(),'shima-fund-dl-')),downloads:os.tmpdir()});
 fund.detailPageWaitMs=300;
 const win={id:'w1',webContents:{session:{on(){}}},isDestroyed:()=>false};
 host.window=()=>win;host.assertWindow=()=>({mainFrame:{framesInSubtree:[]},on(){},capturePage:async()=>({isEmpty:()=>true})});
 await assert.rejects(fund.download({shopId:'s1',kind:'daily',month:'2026-10'}),/可下载明细/);
 // 顺序：先填 2026-10-01 ~ 2026-10-31，之后才收集行
 const fill=calls.findIndex(c=>c.t==='fill');
 assert.ok(fill>=0,'应调用日期区间填写');
 assert.deepEqual(calls[fill].dates,['2026-10-01','2026-10-31']);
 assert.ok(calls.slice(fill+1).some(c=>c.t==='rows'),'填完日期后才收集目标月行');
});
test('行级下载明细：两行各点一次「下载明细」，每行出一个当日文件（2026-11-05 用户截图场景）',async()=>{
 let willDownload=null;
 const ses={on:(evt,fn)=>{if(evt==='will-download')willDownload=fn;}};
 const mkItem=name=>{
  const cbs={};
  const item={getFilename:()=>name,setSavePath(){},once:(evt,fn)=>{cbs[evt]=fn;}};
  item.finish=state=>cbs.done({},state);
  return item;
 };
 const page={fundHome:true,record:true,tabs:{month:true,daily:true},monthInputs:[{value:'2026-11'}],row:null,rows:[],rowsDay:[],head:null,empty:false,loading:false,body:'日汇总',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'};
 const rows=[{date:'20261101',x:900,y:200},{date:'20261102',x:900,y:230}];
 const host={busy:false,loginBusy:false,accountTransferBusy:false,
  shop:id=>({id,name:'vldoliya旗舰店',platform:'taobao'}),
  window:()=>win,
  assertWindow:()=>({mainFrame:{framesInSubtree:[]},on(){},capturePage:async()=>({isEmpty:()=>true})}),
  authenticate:async()=>{},readPage:async()=>page,
  execute:async(win,script)=>{
   if(/fillMonthScript/.test(script))return {ok:true,how:'typed'};
   if(/detailRowsScript/.test(script))return rows;
   if(/clickDetailScript/.test(script)){
    const m=script.match(/,"(\d{8})"\)/),d=m&&m[1];
    const item=mkItem('2218742008899_'+d+'_0.xlsx');willDownload({preventDefault(){}},item);setImmediate(()=>item.finish('completed'));
    return {ok:true,x:1,y:1};
   }
   if(/nextPageScript/.test(script))return 0;
   if(/clickTextScript/.test(script))return 0;
   return null;
  },
  load:async()=>{}};
 const win={id:'w1',webContents:{session:ses},isDestroyed:()=>false,isVisible:()=>true,hide(){}};
 const fund=new FundSummary({autoDownload:false,host,root:fs.mkdtempSync(path.join(os.tmpdir(),'shima-fund-rows-')),downloads:os.tmpdir()});
 const result=await fund.download({shopId:'s1',kind:'daily',month:'2026-11'});
 assert.equal(result.files.length,2,'两行各出一个文件：'+JSON.stringify(result.files));
 assert.ok(result.files[0].endsWith('vldoliya旗舰店_日汇总_2026-11_2218742008899_20261101_0.xlsx'));
 assert.ok(result.files[1].endsWith('2218742008899_20261102_0.xlsx'));
 assert.equal(result.note,'','没有跳过的行');
 assert.equal(fund.downloadCtx,null);
});
test('detailRowsScript 只收目标月可见行；clickDetailScript 点指定日期行的「下载明细」',()=>{
 const rowsFn=eval('('+detailRowsScript.toString()+')'),clickFn=eval('('+clickDetailScript.toString()+')');
 const mkTr=(date,label,visible)=>{
  const link={childNodes:[{nodeType:3,textContent:label}],getClientRects:visible?()=>[{}]:()=>[],checkVisibility:()=>visible,closest:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({left:880,top:200,width:60,height:22}),click(){this.clicked=1;}};
  const tds=[{textContent:date,childNodes:[]},{textContent:'',childNodes:[]},{textContent:label,childNodes:[]}].map(t=>({...t,getClientRects:()=>[{}],checkVisibility:()=>true,closest:()=>null,querySelectorAll:()=>[link]}));
  return {children:tds,getClientRects:visible?()=>[{}]:()=>[],checkVisibility:()=>visible,closest:()=>null,querySelectorAll:sel=>sel.includes('a,span')||sel==='a,span,div,button'?[]:[]};
 };
 // tr.querySelectorAll('a,span,div,button') 要返回链接：让 tr 直接代答
 const tr1=mkTr('20261104','下载明细',true),tr2=mkTr('20261103','下载明细',true),tr3=mkTr('20261031','下载明细',true);
 for(const tr of [tr1,tr2,tr3])tr.querySelectorAll=sel=>sel==='a,span,div,button'?[tr.children[2].querySelectorAll()[0]]:[];
 global.document={querySelectorAll(){return [tr1,tr2,tr3];}};
 const got=rowsFn('202611');
 assert.deepEqual(got.map(r=>r.date),['20261104','20261103'],'只收目标月（202611）的行，10-31 行排除');
 const hit=clickFn('202611','20261103');
 assert.equal(hit.ok,true);
 assert.deepEqual({x:hit.x,y:hit.y},{x:910,y:211});
 assert.equal(tr2.children[2].querySelectorAll()[0].clicked,1,'应点到 11-03 行内的链接');
 assert.equal(clickFn('202611','20261199'),null,'不存在的日期返回 null');
 delete global.document;
});
test('导出多分片（收支明细仍走右上角「导出」）：整月按天出多个文件，静默后一起交付',async()=>{
 let willDownload=null;
 const ses={on:(evt,fn)=>{if(evt==='will-download')willDownload=fn;}};
 const mkItem=name=>{
  const cbs={};
  const item={getFilename:()=>name,setSavePath(){},once:(evt,fn)=>{cbs[evt]=fn;}};
  item.finish=state=>cbs.done({},state);
  return item;
 };
 const page={fundHome:true,record:true,tabs:{month:true,daily:true},monthInputs:[{value:'2026-11'}],row:null,rows:[],rowsDay:[],head:null,empty:false,loading:false,body:'日汇总',url:'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_day'};
 const host={busy:false,loginBusy:false,accountTransferBusy:false,
  shop:id=>({id,name:'vldoliya旗舰店',platform:'taobao'}),
  window:()=>win,
  assertWindow:()=>({mainFrame:{framesInSubtree:[]},on(){},capturePage:async()=>({isEmpty:()=>true})}),
  authenticate:async()=>{},readPage:async()=>page,
  execute:async(win,script)=>{
   if(/fillMonthScript/.test(script))return {ok:true,how:'typed'};
   if(/clickTextScript/.test(script)){
    const m=script.match(/\(\"([^\\\"]+)\"\)/),label=m&&m[1];
    if(label==='导出'){
     // 点导出后官方开始分片下载：第一个文件立即开始，第二个 300ms 后到（间隔 < 静默期）
     const i1=mkItem('2218742008899_20261101_0.xlsx');willDownload({preventDefault(){}},i1);
     setImmediate(()=>i1.finish('completed'));
     setTimeout(()=>{const i2=mkItem('2218742008899_20261102_0.xlsx');willDownload({preventDefault(){}},i2);setImmediate(()=>i2.finish('completed'));},300);
     return 1;
    }
    return 0;
   }
   if(/fileUrlProbeScript/.test(script))return [];
   return null;
  },
  load:async()=>{}};
 const win={id:'w1',webContents:{session:ses},isDestroyed:()=>false,isVisible:()=>true,hide(){}};
 const fund=new FundSummary({autoDownload:false,host,root:fs.mkdtempSync(path.join(os.tmpdir(),'shima-fund-multi-')),downloads:os.tmpdir()});
 fund.downloadTimeoutMs=15000;fund.downloadIdleMs=1000;
 const result=await fund.download({shopId:'s1',kind:'detail',month:'2026-11'});
 assert.equal(result.files.length,2,'两个分片都应交付：'+JSON.stringify(result.files));
 assert.ok(result.files[0].endsWith('vldoliya旗舰店_收支明细_2026-11_2218742008899_20261101_0.xlsx'));
 assert.ok(result.files[1].endsWith('2218742008899_20261102_0.xlsx'));
 // 下载已开始，ctx 已结算清空
 assert.equal(fund.downloadCtx,null);
});
test('detailRowsScript 兼容月汇总 6 位年月行（202610）：只收目标月行（11-08 德国甄选截图实锤）',()=>{
 const rowsFn=eval('('+detailRowsScript.toString()+')');
 const mkLink=()=>({childNodes:[{nodeType:3,textContent:'下载明细'}],getClientRects:()=>[{}],checkVisibility:()=>true,closest:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({left:880,top:200,width:60,height:22})});
 const mkTr=date=>{
  const link=mkLink();
  const tds=[{textContent:date,childNodes:[]},{textContent:'',childNodes:[]},{textContent:'下载明细',childNodes:[]}].map(t=>({...t,getClientRects:()=>[{}],checkVisibility:()=>true,closest:()=>null,querySelectorAll:()=>[link]}));
  const tr={children:tds,getClientRects:()=>[{}],checkVisibility:()=>true,closest:()=>null,querySelectorAll:sel=>sel==='a,span,div,button'?[link]:[]};
  return tr;
 };
 global.document={querySelectorAll(){return [mkTr('202610'),mkTr('202611'),mkTr('20261104')];}};
 const got=rowsFn('202610');
 assert.deepEqual(got.map(r=>r.date),['202610'],'月汇总 6 位年月行按整串匹配目标月');
 assert.deepEqual(rowsFn('202611').map(r=>r.date),['202611','20261104'],'6 位整串行与 8 位日期行都归入目标月，互不误收 202610');
 delete global.document;
});
test('历史月月汇总导出：也走行级「下载明细」（11-08 德国甄选包：右上角导出不排队），当月直接拒绝（v1.2.51）',async()=>{
 let willDownload=null;
 const ses={on:(evt,fn)=>{if(evt==='will-download')willDownload=fn;}};
 const cbs={};
 const item={getFilename:()=>'2221707009293_202610_month.xlsx',setSavePath(){},once:(evt,fn)=>{cbs[evt]=fn;}};
 item.finish=state=>cbs.done({},state);
 const page={fundHome:true,record:true,tabs:{month:true},monthInputs:[{value:'2026-10'}],row:null,rows:[],rowsDay:[],head:null,empty:false,loading:false,body:'月汇总',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'};
 const scripts=[];const clicks=[];
 const host={busy:false,loginBusy:false,accountTransferBusy:false,
  shop:id=>({id,name:'龙文铭石五金专营店',platform:'taobao'}),
  window:()=>win,
  assertWindow:()=>({mainFrame:{framesInSubtree:[]},on(){},capturePage:async()=>({isEmpty:()=>true})}),
  authenticate:async()=>{},readPage:async()=>page,
  execute:async(win,script)=>{
   scripts.push(String(script).slice(0,60));
   if(/fillMonthScript/.test(script))return {ok:true,how:'typed'};
   if(/detailRowsScript/.test(script))return [{date:'202610',x:900,y:200}];
   if(/clickDetailScript/.test(script)){clicks.push(String(script).match(/,"(\d{6})"\)/)?.[1]);const it=item;willDownload({preventDefault(){}},it);setImmediate(()=>it.finish('completed'));return {ok:true,x:900,y:200};}
   if(/nextPageScript/.test(script))return 0;
   if(/clickTextScript/.test(script))return 0;
   if(/fileUrlProbeScript/.test(script))return [];
   return null;
  },
  load:async()=>{}};
 const win={id:'w1',webContents:{session:ses},isDestroyed:()=>false,isVisible:()=>true,hide(){}};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-fund-month-'));
 const fund=new FundSummary({autoDownload:false,host,root,downloads:os.tmpdir()});
 fund.detailPageWaitMs=300;
 // 当月（2026-11）点月汇总 → 直接拒绝，不开窗口不发请求
 await assert.rejects(fund.download({shopId:'s1',kind:'month',month:'2026-11'}),/整月结束后才出账|日汇总/);
 // 历史满月（2026-10）→ 月汇总页走行级「下载明细」，不再点右上角「导出」
 const result=await fund.download({shopId:'s1',kind:'month',month:'2026-10'});
 assert.equal(result.files.length,1,'月汇总行级明细文件应交付：'+JSON.stringify(result.files));
 assert.ok(result.files[0].includes('月汇总_2026-10'),'文件名应带类型与月份：'+result.files[0]);
 assert.ok(scripts.some(s=>/fillMonthScript/.test(s)),'应走月份区间填写（fillMonthScript）');
 assert.ok(!scripts.some(s=>/clickTextScript/.test(s)&&/导出/.test(s)),'不应再点右上角「导出」：'+scripts.join(' | '));
 assert.deepEqual(clicks,['202610'],'应点目标月份行的「下载明细」');
 assert.equal(fund.downloadCtx,null);
});
test('新版工作台 target=_blank 菜单：window-open 请求转回本窗口加载（2026-11-05 诊断场景）',async()=>{
 let openHandler=null;const loaded=[];
 const wc={session:{on(){}},setWindowOpenHandler:fn=>{openHandler=fn;},loadURL:async u=>{loaded.push(u);}};
 const win={id:'w1',webContents:wc,isDestroyed:()=>false};
 const month={fundHome:true,record:true,tabs:{month:true},monthInputs:[{value:'2026-10'}],row:null,head:null,empty:false,loading:false,body:'月汇总',url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'};
 const {fund,host}=tempFund({read(){return month;},execute(){}});
 host.window=()=>win;
 fund.rowTimeoutMs=1200;fund.openTimeoutMs=2000;
 await fund.start({shopIds:['s1'],months:{start:'2026-10',end:'2026-10'}});
 await fund.work.catch(()=>{});
 assert.ok(openHandler,'query 应给窗口挂 window-open 接管（armWindowOpen）');
 const r1=openHandler({url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'});
 assert.deepEqual(r1,{action:'deny'},'站内建窗请求应 deny');
 // v1.2.55：站内链接改为下一轮事件循环再导航——绝不能在 window-open 回调里同步 loadURL 重入
 assert.ok(!loaded.includes('https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'),'不得在 window-open 回调里同步 loadURL（重入会让主进程原生崩溃、菜单点了没反应）');
 await new Promise(r=>setImmediate(r));
 assert.ok(loaded.includes('https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'),'站内链接应转回本窗口加载：'+loaded.join(' | '));
 const r2=openHandler({url:'https://evil.example.com/x'});
 assert.deepEqual(r2,{action:'deny'},'站外请求也应 deny');
 // OSS 直链：只记录不导航，供 downloadDailyRows 用 net 代下
 const r3=openHandler({url:'https://taobao-finance.oss-cn-zhangjiakou.aliyuncs.com/fund/bill/detail/a_20261101_0.xlsx?Signature=s'});
 assert.deepEqual(r3,{action:'deny'},'OSS 直链建窗也应 deny');
 assert.equal((wc.__shimaOssHits||[]).length,1,'OSS 直链应被记进 __shimaOssHits');
 await new Promise(r=>setImmediate(r));
 assert.ok(!loaded.some(u=>/evil/.test(u)),'站外链接不应被加载');
 assert.ok(!loaded.some(u=>/aliyuncs/.test(u)),'OSS 直链不应把主窗口导航走');
});

test('v1.2.64 合成指针一条龙：浮层活不过单次脚本执行——链式点击后浮层已关（已导航）则直接成功，不再依赖二次量坐标',async()=>{
 // 11-09 11:51 日志实锤：合成 hover 能展开浮层（opened:true），但随后另起一次执行去量坐标时
 // 浮层已关，hit 恒为 null。新链路在一个执行里完成展开+找新出现子项+点击，并带回坐标。
 let reads=0;
 const rects={hover:{x:65,y:547},hit:null}; // read() 永远量不到子项（浮层已关，只剩假目标被拒绝）
 const events=[];
 const shops=[{id:'s1',name:'测试旗舰店',platform:'taobao',username:'shop1'}];
 const host={busy:false,loginBusy:false,accountTransferBusy:false,writeFailure:false,concurrency:2,shops,data:{shops},queryContext:new AsyncLocalStorage(),
  shop(id){return shops[0];},assertWindow(){},check(){},window(){return {id:'w1'};},async authenticate(){return 'x';},async load(){},
  async readPage(){reads++;return {hover:rects.hover,hit:rects.hit,dismiss:null,diag:{vh:811,vw:1264}};},
  async execute(win,script){if(String(script).includes('stillVisible'))return {ok:true,opened:true,clicked:true,at:{x:150,y:230},stillVisible:false};return null;},
  async sendMouse(win,type,x,y){events.push(type+'@'+x+','+y);return true;}};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-fund-chain1-'));
 const fund=new FundSummary({autoDownload:false,host,root,downloads:root});
 fund.inspectAll=async()=>({url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'}); // v1.2.70：点击后视为已导航
 const ok=await fund.realMenuClick({id:'w1'},'财务','资金管理');
 assert.equal(ok,true,'链式合成点击后浮层关闭=已导航，应直接成功');
 assert.ok(reads<=1,'不应依赖二次量坐标（旧链路在此空转）：reads='+reads);
 assert.equal(events.includes('mouseDown@150,230'),false,'浮层已关就不该再真实点击（避免点到新页面）');
});
test('v1.2.64 合成指针一条龙：合成点击后浮层仍开着 → 真实鼠标按脚本带回坐标立即补刀',async()=>{
 const events=[];
 const shops=[{id:'s1',name:'测试旗舰店',platform:'taobao',username:'shop1'}];
 const host={busy:false,loginBusy:false,accountTransferBusy:false,writeFailure:false,concurrency:2,shops,data:{shops},queryContext:new AsyncLocalStorage(),
  shop(id){return shops[0];},assertWindow(){},check(){},window(){return {id:'w1'};},async authenticate(){return 'x';},async load(){},
  async readPage(){return {hover:{x:65,y:547},hit:null,dismiss:null,diag:{vh:811,vw:1264}};},
  async execute(win,script){if(String(script).includes('stillVisible'))return {ok:true,opened:true,clicked:true,at:{x:150,y:230},stillVisible:true};return null;},
  async sendMouse(win,type,x,y){events.push(type+'@'+x+','+y);return true;}};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-fund-chain2-'));
 const fund=new FundSummary({autoDownload:false,host,root,downloads:root});
 fund.inspectAll=async()=>({url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home'}); // v1.2.70：点击后视为已导航
 const ok=await fund.realMenuClick({id:'w1'},'财务','资金管理');
 assert.equal(ok,true,'浮层还开着时应真实点击补刀成功');
 assert.equal(events.includes('mouseDown@150,230'),true,'按脚本带回的最新坐标真实点击');
 assert.equal(events[events.length-1],'mouseUp@150,230','补刀是完整的三段点击');
});
test('v1.2.64 menuPointerScript 源码自检：必须含「新出现子项」判定与 frame 偏移换算（防回退成只看常驻元素）',()=>{
 const src=fs.readFileSync('electron/fund-summary.cjs','utf8');
 const m=src.match(/function menuPointerScript[\s\S]*?\n}/);
 assert.ok(m,'能取到 menuPointerScript 源码');
 const s=m[0];
 assert.ok(s.includes('!before.has')===false||s.includes('before.has'),'应维护 hover 前元素集合以排除常驻假目标');
 assert.ok(s.includes('before.has(e)'),'新出现子项判定：不在 hover 前集合中');
 assert.ok(s.includes('frameElement'),'应沿 frameElement 链换算顶层坐标');
 assert.ok(s.includes('stillVisible'),'应回报合成点击后浮层是否仍开');
 assert.ok(s.includes("fire(el,true)"),'找到子项后必须带 click 的完整序列');
});
test('v1.2.68 menuPointerScript 源码自检：紧邻过滤撤销——fresh 子项直接可点（14:25 批次实锤紧邻校验是误杀）',()=>{
 const src=fs.readFileSync('electron/fund-summary.cjs','utf8');
 const m=src.match(/function menuPointerScript[\s\S]*?\n}/);
 assert.ok(m,'能取到 menuPointerScript 源码');
 const s=m[0];
 assert.ok(s.includes('before.has(e)'),'仍要维护 hover 前元素集合（fresh 本身排除常驻项）');
 assert.ok(!/filter\(adjacent\)/.test(s),'fresh 不得再叠加紧邻过滤（v1.2.65 误杀 (152,188) 真子项）');
 assert.ok(s.includes('anchorRect'),'保留锚点矩形供日志参考');
 assert.ok(s.includes('rejectedAdj'),'保留紧邻参考日志字段');
 assert.ok(s.includes("fire(el,true)"),'找到子项后必须带 click 的完整序列');
 assert.ok(s.includes('stillVisible'),'应回报合成点击后浮层是否仍开');
});
test('v1.2.67 自适应入口：菜单首次失败即判死（menuDead），后续不再空转菜单；菜单可用的店仍菜单优先',()=>{
 const src=fs.readFileSync('electron/fund-summary.cjs','utf8');
 assert.ok(/menuDead=false/.test(src),'应有 menuDead 运行态标记');
 const menuBlock=src.match(/if\(shellBooted&&!menuDead&&menuTries<4\)\{[\s\S]*?\n    \}/);
 assert.ok(menuBlock,'菜单分支必须受 !menuDead 门控');
 assert.ok(/menuDead=true/.test(menuBlock[0]),'菜单失败后应置 menuDead');
 // 菜单优先：菜单分支位置必须早于「次选直达」的 !directTried 块
 assert.ok(src.indexOf('menuTries<4')<src.indexOf('if(!directTried)'),'菜单仍是首选，直达只作次选');
 // 微前端挂载恢复阶梯：菜单判死后跳过菜单步骤，直接重跳目标页
 assert.ok(/if\(menuDead\)\{\s*\n\s*this\.phaseText='财务模块未挂载，重新直跳/.test(src),'microFix 第 0 步应对 menuDead 分流');
 assert.ok(!/directTries/.test(src),'不再单设连发直跳计数（会挤掉收支记录入口探测的时间预算）');
});
test('v1.2.75 移除「常用」收藏入口：菜单路径只剩「财务→资金管理/总览」（用户 11-10 要求删干净，已被保证金入口替代）',()=>{
 const src=fs.readFileSync('electron/fund-summary.cjs','utf8');
 assert.ok(!/realMenuClick\(win,'常用'/.test(src),'不得再有任何「常用」菜单点击');
 assert.ok(/realMenuClick\(win,'财务','资金管理'\)/.test(src),'财务→资金管理 路径必须保留');
 const menuEnter=src.match(/const menuEnter=async\(\)=>\{[\s\S]*?\n   if\(await this\.realMenuClick/);
 assert.ok(menuEnter&&/enterViaDeposit\(win\)\)return true/.test(menuEnter[0]),'menuEnter 应保持最先试保证金入口');
});
test('v1.2.74 depositEntryScript：只认「保证金」卡片里的查看详情，预警弹窗同名按钮不得劫持（用户 11-10 截图实锤两个入口同名）',()=>{
 const fn=eval('('+depositEntryScript.toString()+')');
 const mk=(text,cardInnerText)=>{
  const link={childNodes:[{nodeType:3,textContent:text}],getClientRects:()=>[{}],style:'',querySelectorAll:()=>[],closest:()=>null,checkVisibility:()=>true,getBoundingClientRect:()=>({left:900,top:500,width:60,height:22}),scrollIntoView(){},innerText:cardInnerText};
  if(cardInnerText){const card={childNodes:[],getClientRects:()=>[{}],style:'',querySelectorAll:()=>[],closest:()=>null,checkVisibility:()=>true,getBoundingClientRect:()=>({left:850,top:480,width:200,height:60}),innerText:cardInnerText,parentElement:null};link.parentElement=card;}
  return link;
 };
 const good=mk('查看详情','综合资质考量 保证金 查看详情');   // 首页右下角资质卡片（祖先带「保证金」）
 const bad=mk('查看详情','重要消息 预警通知 发货物流违规商品预警'); // 预警弹窗同名按钮（祖先无「保证金」）
 global.document={querySelectorAll(){return [bad,good];},body:{innerText:''}};
 const r=fn();
 assert.ok(r.found,'应找到保证金卡片的查看详情');
 assert.deepEqual({x:r.x,y:r.y},{x:930,y:511},'应返回链接中心坐标');
 delete global.document;
 // 没有任何带「保证金」祖先的候选 → found:false 快速回落
 global.document={querySelectorAll(){return [mk('查看详情','重要消息 预警通知')];},body:{innerText:''}};
 assert.equal(fn().found,false,'祖先链没有「保证金」时不得命中');
 delete global.document;
});
test('v1.2.76 保证金匹配放宽 + miss 诊断：短文本动作词（查看/管理/进入等）都认，找不到时带回页面结构供 fund.log 定位',()=>{
 const fn=eval('('+depositEntryScript.toString()+')');
 const mk=(text,ancText)=>{
  const link={childNodes:[{nodeType:3,textContent:text}],getClientRects:()=>[{}],style:'',querySelectorAll:()=>[],closest:()=>null,checkVisibility:()=>true,getBoundingClientRect:()=>({left:900,top:500,width:60,height:22}),scrollIntoView(){},innerText:ancText||text,tagName:'A',className:'entry'};
  if(ancText){const card={childNodes:[],getClientRects:()=>[{}],style:'',querySelectorAll:()=>[],closest:()=>null,checkVisibility:()=>true,getBoundingClientRect:()=>({left:850,top:480,width:200,height:60}),innerText:ancText,parentElement:null};link.parentElement=card;}
  return link;
 };
 // v1.2.74 只认「查看详情」时多家店首页 deposit-entry 0 条日志（11-10 实锤）→ 放宽后「查看」也应命中
 global.document={querySelectorAll(){return [mk('查看','保证金 查看OK')];},body:{innerText:''}};
 assert.ok(fn().found,'「查看」短文本动作词应命中保证金卡片');
 delete global.document;
 // 找不到时 found:false 且带回「保证金」相关元素诊断（不再只有 count:0 盲猜）
 const depEl={childNodes:[{nodeType:3,textContent:'保证金'}],getClientRects:()=>[{}],style:'',querySelectorAll:()=>[],closest:()=>null,checkVisibility:()=>true,getBoundingClientRect:()=>({left:10,top:10,width:40,height:20}),tagName:'SPAN',className:'tip',innerText:'保证金'};
 global.document={querySelectorAll(){return [depEl,mk('查看详情','重要消息 预警')];},body:{innerText:''}};
 const r=fn();
 assert.equal(r.found,false);
 assert.ok(r.dep&&r.dep.length===1&&r.dep[0].text==='保证金','miss 时应带回「保证金」相关元素诊断');
 delete global.document;
 const src=fs.readFileSync('electron/fund-summary.cjs','utf8');
 assert.ok(/stage:'miss'/.test(src),'enterViaDeposit 找不到卡片时应写 deposit-entry miss 日志');
});
test('v1.2.74 保证金入口优先：menuEnter 最先试 enterViaDeposit，失败才回落常用/财务菜单',()=>{
 const src=fs.readFileSync('electron/fund-summary.cjs','utf8');
 const menuEnter=src.match(/const menuEnter=async\(\)=>\{[\s\S]*?\n   if\(await this\.realMenuClick/);
 assert.ok(menuEnter,'menuEnter 结构应保持「先保证金入口后菜单」');
 assert.ok(/enterViaDeposit\(win\)\)return true/.test(menuEnter[0]),'menuEnter 应最先调用 enterViaDeposit');
 assert.ok(/menuVerifyOk\(win,5000\)/.test(src.match(/async enterViaDeposit[\s\S]*?\n }/)[0]),'enterViaDeposit 应验证落进财务模块');
});
test('v1.2.67 探针：menu-rect 带回 atHover（elementFromPoint 实际命中文本），menu-pointer 失败时带回全部新出现元素',()=>{
 const src=fs.readFileSync('electron/fund-summary.cjs','utf8');
 const rect=src.match(/function menuRectScript[\s\S]*?\n}/)[0];
 assert.ok(rect.includes('atHover'),'menuRectScript 诊断应包含 atHover');
 const ptr=src.match(/function menuPointerScript[\s\S]*?\n}/)[0];
 assert.ok(ptr.includes('allFresh'),'浮层未展开时应带回所有新出现元素（不限紧邻）');
 assert.ok(ptr.includes('pointText'),'应记录光标落点命中文本');
});
test('v1.2.70 菜单点击必须验证导航：点完页面原地不动（11-10 实锤 stillVisible:true 且不跳转）→ realMenuClick 返回 false 让直达接管',async()=>{
 // 11-10 fund.log 实锤：chain clicked:true / stillVisible:true，真实补刀后页面仍停在千牛首页，
 // 旧逻辑把「事件发出去了」当成功 → menuEnter 白等 3 秒、menuDead 虚设、直达被无限推迟
 const events=[];
 const shops=[{id:'s1',name:'测试旗舰店',platform:'taobao',username:'shop1'}];
 const host={busy:false,loginBusy:false,accountTransferBusy:false,writeFailure:false,concurrency:2,shops,data:{shops},queryContext:new AsyncLocalStorage(),
  shop(id){return shops[0];},assertWindow(){},check(){},window(){return {id:'w1'};},async authenticate(){return 'x';},async load(){},
  async readPage(){return {hover:{x:65,y:547},hit:null,dismiss:null,diag:{vh:811,vw:1264}};},
  async execute(win,script){if(String(script).includes('stillVisible'))return {ok:true,opened:true,clicked:true,at:{x:152,y:188},stillVisible:true};return null;},
  async sendMouse(win,type,x,y){events.push(type+'@'+x+','+y);return true;}};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-fund-verify1-'));
 const fund=new FundSummary({autoDownload:false,host,root,downloads:root});
 fund.inspectAll=async()=>({url:'https://myseller.taobao.com/home.htm/QnworkbenchHome/',record:false,fundHome:false,monthInputs:[]}); // 页面始终停在首页
 const ok=await fund.realMenuClick({id:'w1'},'财务','资金管理');
 assert.equal(ok,false,'没导航必须报失败（直达才有机会接管）');
 const logText=fs.readFileSync(path.join(root,'fund.log'),'utf8');
 assert.ok(logText.includes('menu-verify')&&logText.includes('"ok":false'),'验证结果应落日志供定位');
});
test('v1.2.70 菜单点击验证通过：URL 进入 whale-accountant → realMenuClick 返回 true',async()=>{
 const events=[];
 const shops=[{id:'s1',name:'测试旗舰店',platform:'taobao',username:'shop1'}];
 const host={busy:false,loginBusy:false,accountTransferBusy:false,writeFailure:false,concurrency:2,shops,data:{shops},queryContext:new AsyncLocalStorage(),
  shop(id){return shops[0];},assertWindow(){},check(){},window(){return {id:'w1'};},async authenticate(){return 'x';},async load(){},
  async readPage(){return {hover:{x:65,y:547},hit:null,dismiss:null,diag:{vh:811,vw:1264}};},
  async execute(win,script){if(String(script).includes('stillVisible'))return {ok:true,opened:true,clicked:true,at:{x:152,y:188},stillVisible:false};return null;},
  async sendMouse(win,type,x,y){events.push(type+'@'+x+','+y);return true;}};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-fund-verify2-'));
 const fund=new FundSummary({autoDownload:false,host,root,downloads:root});
 fund.inspectAll=async()=>({url:'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_day'});
 const ok=await fund.realMenuClick({id:'w1'},'财务','资金管理');
 assert.equal(ok,true,'真导航了才算成功');
});
test('v1.2.70 直达候选顺序：旧域 qn 直达排第二（11-04 实锤 1.5 秒就绪；此前排最后、stall 只轮 2 个候选导致旧域永远轮不到）',()=>{
 const m=require('../electron/fund-summary.cjs');
 for(const tab of ['月汇总','日汇总','收支明细']){
  const c=m.fundUrlCandidates(tab);
  assert.ok(c.length>=3,tab+' 应有多个候选');
  assert.ok(/myseller\.taobao\.com.*whale-accountant/.test(c[0]),tab+' 第一候选仍是新域带参直达');
  assert.ok(/qn\.taobao\.com/.test(c[1]),tab+' 第二候选必须是旧域 qn 直达：'+c[1]);
 }
});
test('v1.2.70 stall 升级轮满 3 个直达候选再回首页（确保旧域候选真能被轮到），第 5 次才抛错',()=>{
 const src=fs.readFileSync('electron/fund-summary.cjs','utf8');
 assert.ok(src.includes('stalls===1||stalls===2||stalls===4'),'stall 1/2/4 都应轮换直达候选');
 assert.ok(src.includes('stalls===3'),'stall 3 应回首页重启外壳');
 const seg=src.match(/if\(stalls===1\|\|stalls===2\|\|stalls===4\)\{[\s\S]*?throw Error/)[0];
 assert.ok(/nextDirect\(\)/.test(seg),'升级路径应轮换候选');
 assert.ok(/direct-load/.test(seg),'每次直达都应落日志（此前直达是否真被尝试无从考证）');
});
test('v1.2.77 微应用不挂载三通道（METRISH/龙文铭石 12:03/12:08 诊断包实锤：URL 已在 whale-accountant、侧栏高亮，微应用 present 而不挂载内容区空白，二轮重开新窗也失败）',()=>{
 const src=fs.readFileSync('electron/fund-summary.cjs','utf8');
 // ① 总览中转：点「总览」后独立等挂载（overviewWaitMs，默认 20 秒），挂上点页面「收支记录」，不再点回资金管理
 const seg=src.match(/if\(microFix===2\)\{[\s\S]*?\n    \}/)[0];
 assert.ok(/overviewWaitMs\|\|20000/.test(seg),'microFix 第 2 步应给「总览」独立挂载等待（默认 20 秒）');
 assert.ok(/clickText\(win,'收支记录'\)/.test(seg),'总览挂载后应点页面「收支记录」（用户验证的可靠路径）');
 assert.ok(!/realMenuClick\(win,'财务','资金管理'\)/.test(seg),'microFix 第 2 步不得再点回「资金管理」（微应用根本挂不上，点回无意义）');
 // ② 微应用梯子的直达重载也要落 direct-load 日志（此前梯子内直达是否被尝试无从考证）
 const ladder=src.match(/microFix===0\)[\s\S]*?microFix=0;\s*\n\s*const u=nextDirect\(\)/);
 assert.ok(ladder,'微应用梯子应有换入口直达');
 const dl=src.match(/this\.log\('direct-load','micro-ladder '\+u\)/g);
 assert.ok(dl&&dl.length>=2,'微应用梯子两处直达重载都应记 direct-load 日志');
 // ③ 诊断包采集官方页 console 报错（定位微应用挂载失败根因）
 const trace=src.match(/armNavTrace\(win\)\{[\s\S]*?\n \}/)[0];
 assert.ok(trace.includes('console-message'),'导航轨迹应采集 console-message');
 assert.ok(/n>=2/.test(trace),'console 只收 warning/error 级别，防刷屏挤掉导航事件');
});

test('v1.2.78 静默路径全补日志：auth-kick 落日志且重登耗时补回预算，loading 卡住 25 秒按停滞直跳，抛错前落 nav-fail 全景',()=>{
 const src=fs.readFileSync('electron/fund-summary.cjs','utf8');
 assert.ok(/this\.log\('auth-kick'/.test(src),'authKick 重登触发必须落日志（此前零日志）');
 assert.ok(/deadline\+=Date\.now\(\)-kickT0/.test(src),'重登耗时应补回导航预算（此前挤占 150 秒）');
 assert.ok(/loading 卡住/.test(src),'loading 持续卡住应有 nav-stall 日志分支');
 assert.ok(/loadingStallMs\|\|25000/.test(src),'loading 停滞阈值 25 秒可配');
 const lf=src.match(/this\.log\('nav-fail',[\s\S]*?\);/);
 assert.ok(lf&&/authKicked/.test(lf[0])&&/menuDead/.test(lf[0]),'抛「未能打开」前应落 nav-fail 全景日志');
 assert.ok(src.indexOf("this.log('nav-fail'")<src.indexOf('未能打开「'),'nav-fail 日志应在抛错之前');
 assert.ok(/tab-no-data /.test(src),'页签点击无数据后的直达重载应记日志');
 assert.ok(/onFund-round /.test(src)&&/onFund-first /.test(src),'onFund 分支两发直达重载应记日志');
});

test('v1.2.79 行级下载 ossUsed 跨行累计：直链消费游标必须提升到 run 作用域（此前每行重置为 0，恒下 urls[0]=第一行文件，5 店 N 份文件 md5 全同）',()=>{
 const src=fs.readFileSync('electron/fund-summary.cjs','utf8');
 // 声明在 run 作用域（与 page/total/ossGot 同一条声明链）
 assert.ok(/let page=1,total=0,ossGot=0,dlGot=0,ossUsed=0;/.test(src),'ossUsed 应在 downloadDailyRows 顶部与游标一起声明（run 作用域）');
 // 行循环内不得再声明 ossUsed（否则每行重置）
 const rowLoop=src.match(/const rowDeadline=Date\.now\(\)\+45000;[\s\S]{0,80};/);
 assert.ok(rowLoop&&!/ossUsed\s*=0[,;]/.test(rowLoop[0]),'行循环内不得重置 ossUsed');
 // 消费处仍是 urls[ossUsed++]
 assert.ok(/ossTrack\.urls\[ossUsed\+\+\]/.test(src),'直链消费游标逻辑保持不变');
});

test('v1.2.80 批量下载任务表 batchJobs：只取当轮 completed 无 error 的行，去重键带 runId（重新抓取后同店同月可再下载）',()=>{
 const rows=[
  {runId:'r2',shopId:'a',shopName:'A店',month:'2026-11',status:'completed',detailCount:34},
  {runId:'r2',shopId:'b',shopName:'B店',month:'2026-11',status:'completed',detailCount:0,error:'该月无数据'},
  {runId:'r2',shopId:'c',shopName:'C店',month:'2026-11',status:'failed',detailCount:null,error:'进不去'},
  {runId:'r2',shopId:'d',shopName:'D店',month:'2026-11',status:'completed',detailCount:null},
  {runId:'r1',shopId:'a',shopName:'A店',month:'2026-11',status:'completed',detailCount:20}
 ];
 const jobs=batchJobs(rows,{now:'2026-11',runId:'r2'});
 assert.deepEqual(jobs.map(j=>j.shopId),['a','d'],'只保留当轮 completed 且有明细（detailCount 为 0 / 有 error / 失败行都排除）');
 assert.equal(jobs[0].kind,'daily','当月走日汇总逐日');
 const old=batchJobs([{runId:'r1',shopId:'a',shopName:'A店',month:'2026-10',status:'completed',detailCount:5}],{now:'2026-11',runId:'r1'});
 assert.equal(old[0].kind,'month','历史满月走月汇总导出');
 // 关键回归：上一轮（r1）下载成功后，新一轮（r2）同一个店铺+月份必须还能被选中
 const done=new Set(['a|2026-11|r2']);
 assert.deepEqual(batchJobs(rows,{now:'2026-11',runId:'r2',done}).map(j=>j.shopId),['d'],'本轮已下载的跳过');
 const nextRun=batchJobs([{runId:'r3',shopId:'a',shopName:'A店',month:'2026-11',status:'completed',detailCount:40}],{now:'2026-11',runId:'r3',done});
 assert.deepEqual(nextRun.map(j=>j.shopId),['a'],'新 runId 不应被上一轮的下载记录挡住（旧键只到店铺|月份，这正是按钮点了没反应的原因）');
});

test('v1.2.80 抓取后自动下载：仅在开关打开且整月口径（day 为空）时挂到 work 链尾，异常不污染抓取结果',()=>{
 const src=fs.readFileSync('electron/fund-summary.cjs','utf8');
 const seg=src.match(/if\(this\.autoDownload\(\)&&!day\)\{[\s\S]*?\n  \}/);
 assert.ok(seg,'start() 应挂自动下载分支');
 assert.ok(/this\.work=this\.work\.then\(/.test(seg[0]),'自动下载必须接在 work 链尾（busy=false 之后，download() 才不会被拒）');
 assert.ok(/downloadBatch\(\{runId\}\)/.test(seg[0]),'应调用 downloadBatch');
 assert.ok(/batch-auto-fail/.test(seg[0]),'自动下载失败必须落日志且不影响抓取结果');
 assert.ok(/autoDownload\(\)\{return this\.data\.autoDownload!==false;\}/.test(src),'开关默认开，持久化在 fund-summary.json');
 const main=fs.readFileSync('electron/main.cjs','utf8');
 assert.ok(/downloadBatch','setAutoDownload/.test(main),'main.cjs IPC 白名单应放行两个新动作');
});
