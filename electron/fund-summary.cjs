'use strict';
// 资金月汇总模块：淘宝/天猫「财务 → 资金管理 → 聚合结算账户 → 月汇总」抓取（页面页签：收支明细/日汇总/月汇总）。
// 复用推广费服务的窗口、会话与登录核验（host 传入 PromotionFee 实例），不改动千牛推广费抓取逻辑。
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{net}=require('electron');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// v1.2.87：结果表默认只显示「今天/昨天」的记录（与推广费同口径）。此前每店历史最新一行全部显示，
// 11-04/11-06 的失败行一直挂在表里，财务会误以为刚跑的批次全失败。历史行保留，随 state().stale 返回。
const BJS_OFFSET=8*3600000;
function rowRecent(row,now){
 const t=now||Date.now(),yesterday=new Date(t+BJS_OFFSET-86400000).toISOString().slice(0,10);
 if(row.updatedAt){const parsed=Date.parse(row.updatedAt);if(Number.isFinite(parsed)){const day=new Date(parsed+BJS_OFFSET).toISOString().slice(0,10);if(day>=yesterday)return true;}}
 const settled=row.day||'';
 // 完全没有时间信息（老版本写入的行）不做判断，保留显示
 if(!row.updatedAt&&!settled)return true;
 return !!settled&&settled>=yesterday;
}
const FUND_EARLIEST='2024-08'; // 官方公告：最早支持 2024年8月 的数据
const KINDS={daily:'日汇总',detail:'收支明细',month:'月汇总'};
// 用户提供的官方直达链接（2026-11 实测有效）：直接 load 跳转，绕过工作台菜单导航；菜单探测仅作兜底
const FUND_URLS={
 '月汇总':'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_month',
 '日汇总':'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_day',
 '收支明细':'https://qn.taobao.com/home.html/whale-accountant/pay/capital/home?active=fund_detail',
};
// v1.2.46：新版工作台外壳首页。13:39-13:55 五诊断包实锤——冷壳（外壳还没在任何页面启动过）直跳
// 资金路由会被反复弹回首页或让 icestark 微应用永远挂不上；而先让外壳在首页完整启动（任意微应用
// 挂载成功）后直跳资金路由，1.5 秒即挂载成功（13:40 诊断流程 stage①→② 实测）
const SHELL_HOME='https://myseller.taobao.com/home.htm/QnworkbenchHome/';
// 2026-11-05 16:51 用户截图指正（v1.2.41 方向改错）：正确页面仍是「资金管理」/pay/capital/home，
// 但总览只有「资金账户」一个页签——必须点进「聚合结算账户」卡片，里面才有 收支明细/日汇总/月汇总
// 三个页签（面包屑：资金管理 > 聚合结算账户 > 日汇总）。「收支账单」/bill/summary 是货款收入等
// 月账单汇总页，没有月/日汇总页签，属错页（MUJU 16:02 诊断包实锤：挂载成功但无目标行）。
// 候选顺序：新域带参 → **旧域 qn 直达**（11-04 诊断实锤 1.5 秒即就绪；v1.2.70 前排在最后、
// stall 升级只轮 2 个候选导致旧域永远轮不到，11-10 实锤卡首页店全灭）→ 新域裸 → 收支账单 → 总览；
// 进入资金管理后先点「聚合结算账户」
const fundUrlCandidates=tab=>{
 const active={'月汇总':'fund_month','日汇总':'fund_day','收支明细':'fund_detail'}[tab]||'';
 const base='https://myseller.taobao.com/home.htm/whale-accountant';
 if(tab==='收支明细')return [
  base+'/pay/capital/home?active=fund_detail',
  FUND_URLS[tab],
  base+'/pay/capital/home',
  base+'/bill/account-details',
  base+'/index',
 ].filter(Boolean);
 return [
  base+'/pay/capital/home'+(active?'?active='+active:''),
  FUND_URLS[tab],
  base+'/pay/capital/home',
  base+'/bill/summary'+(active?'?active='+active:''),
  base+'/bill/summary',
  base+'/index',
 ].filter(Boolean);
};
// 月汇总整页导航在双11等大促期间也会变慢，给足 60 秒；单次读取仍走 host 的 20 秒脚本看门狗
// v1.2.45：150 秒。10:46 三诊断包实锤——URL 已停在正确的资金页、外壳在但 icestark 微应用
// 60~90 秒都没挂载完（大促期间官方应用加载慢且时快时慢：10:31 同样 6 家全过、10:46 全卡挂载）。
// 导航总窗口必须盖过「等挂载 60s + 同址重载 + 再等 60s」的最坏路径
const OPEN_TIMEOUT_MS=150000,ROW_TIMEOUT_MS=30000,DOWNLOAD_TIMEOUT_MS=45000,MANUAL_TIMEOUT_MS=15*60*1000,LOGIN_GUARD_MS=5*60*1000;
// 导出账单是官方异步生成的（v1.2.24 实锤：点「导出」后弹「新建下载任务」，文件生成+传输要远超 45 秒），
// 整个导出窗口放宽到 2 分钟；期内既等 will-download 也探测 OSS 文件直链代下
const EXPORT_TIMEOUT_MS=120000;
// 整月导出按天/分片出多个文件：连续这么久没有新分片落地即认为出完（v1.2.27）
const DOWNLOAD_IDLE_MS=10000;
// 抓取失败时自动落诊断包的上限：并发多店铺同时失败也不刷屏，先看第一手的
const FAIL_CAPTURE_LIMIT=3;
// v1.2.40 资金抓取强制串行（用户 2026-11-05 实测反馈）：此前沿用推广费的 concurrency（默认 4），
// 会同时打开 4 个店铺窗口；每个店铺是独立 partition 会话，需要各自登录/验证时登录弹窗一起弹，
// 人工只能顾一个，其余店铺页面被挤掉、直达链接失效 → 整批失败。
// 资金页只有「一次读一个店铺一个月」这一个动作，串行不损失正确性，只牺牲理论吞吐：固定 1。
const RUN_CONCURRENCY=1;

function monthEnd(month){const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);}
// 官方口径（2026-11 用户确认）：月汇总只在整月结束后出账，当月只能查日汇总自行累加
const nowMonth=()=>new Date(Date.now()+28800000).toISOString().slice(0,7);
const nowDate=()=>new Date(Date.now()+28800000).toISOString().slice(0,10);
// 校验月份区间：格式 YYYY-MM、起止有序、不早于 2024-08、不晚于当前月
function monthRange(input){
 const valid=s=>{if(!/^\d{4}-\d{2}$/.test(s||''))return false;const [y,m]=s.split('-').map(Number);return y>=2000&&y<=2100&&m>=1&&m<=12;};
 if(!valid(input?.start)||!valid(input?.end))throw Error('请选择有效的开始、结束月份');
 if(input.end<input.start)throw Error('开始月份不能晚于结束月份');
 if(input.start<FUND_EARLIEST)throw Error('官方仅支持 2024年8月 起的数据，最早可选 '+FUND_EARLIEST);
 const now=new Date(Date.now()+28800000).toISOString().slice(0,7);
 if(input.end>now)throw Error('结束月份不能晚于当前月（'+now+'）');
 const months=[];let [y,m]=input.start.split('-').map(Number);
 for(;;){const key=y+'-'+String(m).padStart(2,'0');months.push(key);if(key===input.end)break;m++;if(m>12){m=1;y++;}if(months.length>30)throw Error('月份跨度过大，单次最多 30 个月');}
 return months;
}
function parseAmount(value){const s=String(value??'').replace(/[¥￥,\s]/g,'');if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;const [a,b='']=s.split('.'),n=Number(a)*100+Number(b.padEnd(2,'0'));return Number.isSafeInteger(n)?n:null;}
function parseCount(value){const s=String(value??'').replace(/[^\d]/g,'');return s&&String(Number(s))===s?Number(s):null;}
// 按表头定位列，表头对不上时退回截图中的固定列序：日期/收入笔数/收入金额/支出笔数/支出金额/期末余额
function parseSummaryRow(head,cells){
 const find=label=>head.findIndex(h=>h.replace(/\s/g,'').includes(label));
 let iMonth=find('日期'),iInCount=find('收入笔数'),iInAmount=find('收入金额'),iOutCount=find('支出笔数'),iOutAmount=find('支出金额'),iBalance=find('期末余额'),iDetail=find('明细笔数');
 if(iMonth<0||iInAmount<0||iOutAmount<0){
  // 官方「聚合结算账户·月汇总」列序：日期明细/明细笔数/收入金额/收入笔数/支出金额/支出笔数/期末余额
  if(cells.length>=7)[iMonth,iInCount,iInAmount,iOutCount,iOutAmount,iBalance,iDetail]=[0,3,2,5,4,6,1];
  else {[iMonth,iInCount,iInAmount,iOutCount,iOutAmount,iBalance]=[0,1,2,3,4,5];iDetail=-1;}
 }
 const month=String(cells[iMonth]??'').replace(/\D/g,'');
 const incomeCents=iInAmount<0?null:parseAmount(cells[iInAmount]),expenseCents=iOutAmount<0?null:parseAmount(cells[iOutAmount]),balanceCents=iBalance<0?null:parseAmount(cells[iBalance]);
 return {month,incomeCount:iInCount<0?null:parseCount(cells[iInCount]),incomeCents,expenseCount:iOutCount<0?null:parseCount(cells[iOutCount]),expenseCents,balanceCents,detailCount:iDetail<0?null:parseCount(cells[iDetail]),readable:incomeCents!==null&&expenseCents!==null};
}
// 页面脚本：只读渲染结果，判断当前停留在资金管理流程的哪一步、月汇总表是否出数
function fundInspect(){
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0');
 const text=e=>(e?.innerText||e?.textContent||'').replace(/[\uE000-\uF8FF]/g,'').replace(/\s+/g,' ').trim();
 const own=e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s+/g,'').trim();
 const body=document.body?.innerText||'';
 if(/请完成验证|安全验证|拖动.{0,8}滑块/.test(body))return {error:'请在官方窗口完成人工验证',code:'verification'};
 // 密码框必须可见才算登录页：壳页的其他 frame 可能藏有隐藏登录表单，误判会中断抓取
 if(/login\./.test(location.hostname)||[...document.querySelectorAll('input[type=password]')].some(visible))return {error:'请先登录该店铺账号',code:'need_login'};
 const byText=t=>[...document.querySelectorAll('a,span,div,button,li,[role=tab],[role=button]')].filter(visible).filter(e=>own(e)===t).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0]||null;
 const has=t=>!!byText(t);
 const loading=!![...document.querySelectorAll('[aria-busy=true],.next-loading-mask,.ant-spin-spinning,.next-loading')].find(visible);
 // 月汇总表：表头含 日期 与 收入金额，行首是 6 位年月；官方新页可能是 div 网格（role=table/row/cell），与真实 <table> 都要认。
 // 2026-11-04 12:32 诊断包实锤：next-table 把表头和数据行拆成两张独立 <table>（.next-table-header / .next-table-body），
 // 逐表「表头+数据行」配对永远失败——改为先全页收表头、再全页收数据行
 let row=null,head=null;const rows=[];const rowsDay=[];
 for(const tb of [...document.querySelectorAll('table,[role=table]')].filter(visible)){
  const thead=tb.querySelector('thead');
  if(thead&&/日期/.test(text(thead))&&/收入金额|支出金额/.test(text(thead))){
   const hc=[...thead.querySelectorAll('th,[role=columnheader]')].map(th=>text(th));
   if(hc.length>=3&&!head)head=hc;
  }
 }
 for(const tb of [...document.querySelectorAll('table,[role=table]')].filter(visible)){
  const trs=tb.tagName==='TABLE'?[...tb.querySelectorAll('tr')]:[...tb.querySelectorAll('[role=row]')];
  for(const tr of trs){
   const cells=[...tr.querySelectorAll('td,[role=cell],[role=gridcell]')].map(td=>text(td));
   if(cells.length<4)continue;
   // 月汇总行首是 6 位年月（202610）；日汇总行首是日期（2026-11-03 / 20261103 / 11-03）
   if(/^\d{6}$/.test(cells[0])){rows.push(cells);if(!row)row=cells;}
   else if(/^\d{4}-?\d{2}-?\d{2}$/.test(cells[0])||/^\d{1,2}-\d{1,2}$/.test(cells[0]))rowsDay.push(cells);
  }
  if(rows.length+rowsDay.length>=40)break;
 }
 const inputs=[...document.querySelectorAll('input')].filter(visible);
 const monthInputs=inputs.map(e=>({value:e.value,readOnly:e.readOnly})).filter(i=>/^\d{4}-\d{2}(-\d{2})?$/.test(i.value||'')||/入账|日期|月份/.test(i.value||''));
 // v1.2.43：补「没有数据」——2026-11-06 腾乐健截图实锤，官方空态文案是「没有数据」而非「暂无数据」
 const empty=/暂无数据|没有找到相关数据|没有数据/.test(body);
 const onFundUrl=/whale-accountant\/(pay\/capital|bill\/)/i.test(location.href)||/active=fund_(month|day|detail)/i.test(location.href||'');
 // 新版工作台是 icestark 微前端（2026-11-05 12:28 诊断包实锤）：外壳只渲染菜单，财务模块异步挂到
 // #icestarkNode；挂载前内容区全空白（无页签/控件/表格）。探测挂载状态供等待逻辑与诊断使用
 // （try 防御：个别环境/mock 的 document 缺这些 API 时按「非新版外壳」处理）
 let microNode=null,microEl=null;
 try{microNode=document.getElementById('icestarkNode');}catch(e){}
 try{microEl=document.querySelector('.ice-stark-loading');}catch(e){}
 const micro={present:!!(microNode||microEl),loaded:!!(microNode&&microNode.childNodes&&microNode.childNodes.length)};
 // 工作台通过 xdomain-iframe 桥加载应用，真实应用地址藏在 hash 的 JSON 里，解码出来供诊断/直跳
 let xdUrl='';try{const m=decodeURIComponent(location.hash||'').match(/"url"\s*:\s*"([^"]+)"/);if(m)xdUrl=m[1];}catch(e){}
 return {fundHome:/聚合结算账户|可提现余额|可用余额|保证金账户/.test(body)||onFundUrl,onFundUrl,micro,xdUrl,record:has('月汇总')&&(has('日汇总')||has('收支明细')),tabs:{month:has('月汇总'),daily:has('日汇总'),detail:has('收支明细')},monthInputs,row,rows,rowsDay,head,empty,loading,url:location.href,body:body.slice(0,600)};
}
// 页面脚本：在入账日期控件里填写月份区间。
// 官方控件真实结构（2026-11-04 12:32 诊断包）：input[placeholder=起始日期/结束日期]，值是月份区间 YYYY-MM，
// React 受控组件——直接 inp.value=xxx 不生效，必须用 native setter 写值再派发 input 事件；
// 不能派发 Enter（会提前提交表单，按默认区间查询还触发官方批量账单下载把页面带跑）。
// v1.2.36：confirmEnter=true 时写值后补派发 Enter——13:23 诊断实锤官方新版控件会无视 native setter
// 写值（React state 从未更新，点搜索后把 DOM 重置回默认区间）；Enter 确认让官方收下新值。
// 仅导出流程（日汇总页，Enter 副作用=form submit=搜索，正是需要的动作）开启，月汇总抓取仍禁用
function fillMonthScript(start,end,dayFirst,confirmEnter){
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0');
 const own=e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s+/g,'').trim();
 const inputs=[...document.querySelectorAll('input')].filter(visible);
 // 官方控件：placeholder 起始/结束日期优先；兜底按值格式或占位文本找
 const byPh=re=>inputs.find(e=>re.test(e.placeholder||''));
 let dates=[byPh(/起始/),byPh(/结束/)];
 if(!(dates[0]&&dates[1]))dates=inputs.filter(e=>/^\d{4}-\d{2}(-\d{2})?$/.test(e.value||'')||/入账|日期|月份/.test(e.placeholder||''));
 const type=(inp,val)=>{
  inp.focus();inp.select?.();
  // React 受控组件：走原型 native setter 写值，再冒泡 input/change 事件，框架才能感知
  let setter=null;try{setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;}catch(e){}
  if(setter){setter.call(inp,val);}else{inp.value=val;}
  inp.dispatchEvent(new Event('input',{bubbles:true}));inp.dispatchEvent(new Event('change',{bubbles:true}));
  if(confirmEnter){const ke={key:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true};inp.dispatchEvent(new KeyboardEvent('keydown',ke));inp.dispatchEvent(new KeyboardEvent('keyup',ke));}
  inp.blur();
 };
 const byPanel=(inp,target)=>{inp.click();const day=String(Number(target.slice(8)));const cells=[...document.querySelectorAll('[class*=panel] td,[class*=panel] li,[class*=calendar] td,[class*=calendar] li,[class*=picker] td,[class*=picker] li')].filter(visible);const cell=cells.find(e=>{const t=own(e);return t===day||t===target.slice(8)+'日'||t===target.slice(5)+'月';});if(cell){cell.click();return true;}return false;};
 const norm=s=>String(s||'').replace(/\D/g,'');
 const tryType=pair=>{for(let i=0;i<2;i++){const inp=dates[i];if(!inp||inp.readOnly)return false;type(inp,pair[i]);if(norm(inp.value)!==norm(pair[i]))return false;}return true;};
 const covers=vals=>{const a=norm(vals[0]),b=norm(vals[1]),m=norm(start.slice(0,7));return a&&b&&a<=m&&m<=b;};
 if(dates.length>=2){
  const current=[dates[0].value,dates[1].value];
  // 官方控件显示月份区间（YYYY-MM 至 YYYY-MM）：先按月份填，失败再试完整日期；
  // 日汇总页是完整日期区间（YYYY-MM-DD），传入 dayFirst 时反过来先试完整日期
  const attempts=dayFirst?[[start,end],[start.slice(0,7),end.slice(0,7)]]:[[start.slice(0,7),end.slice(0,7)],[start,end]];
  for(const pair of attempts)if(tryType(pair))return {ok:true,how:'typed',values:[dates[0].value,dates[1].value]};
  // 写不进去但当前区间已覆盖目标月（默认区间常是「上月 ~ 本月」）：直接用当前区间查询，读行时按目标月挑行
  if(!dayFirst&&covers(current))return {ok:true,how:'kept',values:current};
  const a=byPanel(dates[0],start),b=byPanel(dates[1],end);
  return {ok:a&&b,how:'panel',values:[dates[0]&&dates[0].value,dates[1]&&dates[1].value],reason:a&&b?'':'月份面板未找到 '+start.slice(0,7)+'/'+end.slice(0,7)};
 }
 return {ok:false,reason:'页面上未找到入账日期控件，可见输入框 '+inputs.length+' 个'};
}
// 页面脚本：点「下一页」（next-pagination 的按钮只有 aria-label，没有可见文本）；已到最后一页返回 0
function nextPageScript(){
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0');
 const btn=[...document.querySelectorAll('button,[role=button],a')].filter(visible).find(e=>/下一页|next page/i.test(e.getAttribute('aria-label')||e.title||''));
 if(!btn||btn.disabled||btn.getAttribute('aria-disabled')==='true')return 0;
 btn.click();return 1;
}
// 页面脚本：收集日汇总表格中目标月各行的「下载明细」链接（行首日期归一成 YYYYMMDD），
// 返回 [{date,x,y}]（链接中心坐标供真实鼠标兜底）。next-table 表头/表体是两张 table，
// 但只有表体行首是日期，天然过滤掉表头行；用户 2026-11-05 指正：明细必须按行级「下载明细」逐日下载
function detailRowsScript(yyyymm){
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0');
 const own=e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s+/g,'').trim();
 const ym=String(yyyymm||'').replace(/\D/g,'');
 const rows=[];
 for(const tr of document.querySelectorAll('tr')){
  if(!visible(tr))continue;
  const cells=[...tr.children].map(td=>String(td.textContent||'').replace(/\s+/g,''));
  const n=String(cells[0]||'').replace(/\D/g,'');
  // v1.2.51：月汇总行首是 6 位年月（202610），日汇总是 8 位日期（20261104）——两种都收，
  // 6 位行要求整串等于目标年月（否则 202610 会匹配到任何含 202610 的 8 位日期）
  if(!((n.length===8&&n.indexOf(ym)===0)||n===ym))continue;
  const link=[...tr.querySelectorAll('a,span,div,button')].filter(e=>visible(e)&&own(e)==='下载明细').sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
  if(!link)continue;
  const r=link.getBoundingClientRect();
  if(r.width<=0||r.height<=0)continue;
  rows.push({date:n,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)});
 }
 return rows;
}
// 页面脚本：点击指定日期行内的「下载明细」（合成点击优先），返回坐标供主进程真实鼠标兜底
function clickDetailScript(yyyymm,date){
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0');
 const own=e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s+/g,'').trim();
 const ym=String(yyyymm||'').replace(/\D/g,''),want=String(date||'').replace(/\D/g,'');
 for(const tr of document.querySelectorAll('tr')){
  if(!visible(tr))continue;
  const cells=[...tr.children].map(td=>String(td.textContent||'').replace(/\s+/g,''));
  if(String(cells[0]||'').replace(/\D/g,'')!==want)continue;
  const link=[...tr.querySelectorAll('a,span,div,button')].filter(e=>visible(e)&&own(e)==='下载明细').sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
  if(!link)return {ok:false,reason:'行内未找到「下载明细」链接'};
  const r=link.getBoundingClientRect();
  link.click();
  return {ok:true,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
 }
 return null;
}
// 页面脚本：在导出弹窗/页面 DOM 里找账单文件直链（OSS 预签名 URL，免登录、约 2 分钟有效）；
// 官方「新建下载任务」弹窗绕开 Electron 下载管理器时，主进程拿到直链后用 net 自己下载
function fileUrlProbeScript(){
 const seen=[];const add=u=>{if(u&&!seen.includes(u))seen.push(u);};
 for(const a of document.querySelectorAll('a[href]')){const h=String(a.href||'');if(/aliyuncs\.com\/|oss[^/]*aliyun|fundAccount|\.(xlsx|xls|csv)(?:\?|$)/i.test(h))add(h);}
 for(const el of document.querySelectorAll('[data-url],[data-href],[data-file-url]')){const h=String(el.getAttribute('data-url')||el.getAttribute('data-href')||el.getAttribute('data-file-url')||'');if(/^https:/i.test(h)&&/aliyuncs\.com\/|fundAccount|\.(xlsx|xls|csv)(?:\?|$)/i.test(h))add(h);}
 return seen;
}
// 页面脚本：点击文本精确匹配的最小可见元素，返回点击个数。
// 千牛侧边栏是 Web Components（shadow root）时 document.querySelectorAll 穿不透，命中不到再递归 shadow 找一次
function clickTextScript(target){
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0');
 const own=e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s+/g,'').trim();
 const key=target.replace(/\s+/g,'');
 const pick=root=>[...root.querySelectorAll('a,span,div,button,li,[role=menuitem],[role=tab],[role=button],td')].filter(e=>visible(e)&&own(e)===key);
 let els=pick(document);
 if(!els.length){const out=[];const walk=root=>{for(const h of root.querySelectorAll('*')){if(!h.shadowRoot)continue;out.push(...pick(h.shadowRoot));walk(h.shadowRoot);}};walk(document);els=out;}
 els.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);
 if(!els.length)return 0;els[0].click();
 // 官方页签是 li[role=tab] > div.next-tabs-tab-inner 结构（2026-11-04 诊断包），点击监听在 li 上：补点外层一次
 const tabItem=els[0].closest&&els[0].closest('[role=tab]');
 if(tabItem&&tabItem!==els[0]){try{tabItem.click();}catch(e){}}
 return 1;
}
// 页面脚本（v1.2.74）：找首页「综合资质考量」卡片里的「保证金 → 查看详情」入口（用户 11-10 提议并实测
// 可用——点开直接落在财务模块「资金管理 > 保证金账户」，左侧财务菜单全部就位，绕开「财务」hover
// 浮层时开时不开的问题）。只认祖先链里带「保证金」的查看详情：首页另有预警弹窗的同名按钮，点它
// 会打开别的浮层。返回顶层视口坐标（frame 偏移已换算），点击由主进程真实鼠标完成。
function depositEntryScript(){
 let fox=0,foy=0;
 try{let f=window.frameElement;while(f){const r=f.getBoundingClientRect();fox+=r.left;foy+=r.top;f=f.ownerDocument.defaultView.frameElement;}}catch(e){}
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0');
 const own=e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s+/g,'').trim();
 const hasDep=e=>{let p=e;for(let i=0;i<8&&p;i++){if((p.innerText||'').includes('保证金'))return true;p=p.parentElement;}return false;};
 const sel='a,span,div,button,li,[role=button],td';
 // v1.2.76 放宽匹配（11-10 实锤：只认「查看详情」时多家店首页根本找不到卡片，deposit-entry 0 条日志）：
 // 「保证金」祖先链内的任意短文本动作元素——查看/查看详情/管理/进入/明细 都算
 const match=e=>{const t=own(e);return !!t&&t.length<=12&&/查看|详情|管理|进入|明细/.test(t)&&hasDep(e);};
 let els=[...document.querySelectorAll(sel)].filter(e=>visible(e)&&match(e));
 if(!els.length){const out=[];const walk=root=>{for(const h of root.querySelectorAll('*')){if(!h.shadowRoot)continue;out.push(...[...h.shadowRoot.querySelectorAll(sel)].filter(e=>visible(e)&&match(e)));walk(h.shadowRoot);}};walk(document);els=out;}
 if(!els.length){
  // v1.2.76：找不到时带回页面里「保证金/查看详情」相关元素的结构，写进 fund.log 定位版式差异
  const dep=[...document.querySelectorAll('a,span,div,button,li,td')].filter(e=>visible(e)&&own(e).includes('保证金')).slice(0,6).map(e=>({tag:e.tagName.toLowerCase(),cls:String(e.className||'').slice(0,36),text:own(e).slice(0,40)}));
  const views=[...document.querySelectorAll('a,span,div,button,li,[role=button]')].filter(e=>visible(e)&&own(e)==='查看详情').slice(0,6).map(e=>{let p=e.parentElement,ctx='';for(let i=0;i<4&&p;i++){ctx=(p.innerText||'').replace(/\s+/g,' ').slice(0,50);if(ctx.includes('保证金'))break;p=p.parentElement;}return {ctx:(ctx||'').includes('保证金')?ctx.slice(0,50):'',cls:String(e.className||'').slice(0,30)};});
  return {found:false,dep,views};
 }
 els.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);
 const e=els[0];
 try{e.scrollIntoView({block:'nearest'});}catch(err){}
 const r=e.getBoundingClientRect();
 return {found:true,count:els.length,x:Math.round(fox+r.left+r.width/2),y:Math.round(foy+r.top+r.height/2)};
}
// 页面脚本：返回悬浮项/目标菜单项的中心坐标（主 frame 侧边栏），供主进程发送真实鼠标事件；
// 合成 DOM 事件（isTrusted=false）点不动的官方菜单靠这个兜底
function menuRectScript(hoverText,keyword){
 // v1.2.58：本脚本可能在子 iframe 里执行（侧栏菜单在 frame 中时主 frame 量不到任何坐标，
 // realMenuClick 直接返回 false → 「点不到财务」，用户手动点开后程序才能继续——16:14 截图实锤）。
 // sendInputEvent 吃的是顶层视口坐标，这里把 frame 内坐标沿 frameElement 链累加偏移换算到顶层。
 let fox=0,foy=0;
 try{let f=window.frameElement;while(f){const r=f.getBoundingClientRect();fox+=r.left;foy+=r.top;f=f.ownerDocument.defaultView.frameElement;}}catch(e){}
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0');
 const own=e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s+/g,'').trim();
 const sel='a,span,div,button,li,[role=menuitem],[role=button],td';
 const all=(root,t)=>[...root.querySelectorAll(sel)].filter(e=>visible(e)&&own(e)===String(t).replace(/\s+/g,''));
 const pickIn=(root,t)=>{
  let els=all(root,t);
  if(!els.length)return null;
  // v1.2.53（12:41 METRISH 截图实锤）：顶部头像旁有「财务」角色标签——全页取最小元素会命中它，
  // hover 它打开的是账号下拉菜单（截图里账号菜单展开），侧边栏真菜单永远点不到。
  // 优先取左侧栏区域（x<450 且 y>64）的候选，没有才放宽全页
  const side=els.filter(e=>{const r=e.getBoundingClientRect();return r.left<450&&r.top>64;});
  return (side.length?side:els).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0]||null;
 };
 const pick=t=>{
  if(!t)return null;
  const direct=pickIn(document,t);
  if(direct)return direct;
  // shadow DOM 兜底：逐个 shadow root 递归找，命中即返回
  let found=null;
  const walk=root=>{for(const h of root.querySelectorAll('*')){if(!h.shadowRoot||found)continue;found=pickIn(h.shadowRoot,t);if(!found)walk(h.shadowRoot);}};
  walk(document);
  return found;
 };
 // v1.2.60（16:54 用户录屏实锤）：旧版这里每次 center() 都 scrollIntoView({block:'center'})——
 // 程序自己把侧栏滚起来，菜单项坐标当场作废（录屏里侧栏整体上滚、「首页」滚出视口），
 // 这就是「点击之后页面位置会变」的主因。改为：元素完全在视口外才用 block:'nearest' 最小位移滚动，
 // 且滚完立刻重读坐标；元素可见时绝不滚动。
 const center=e=>{if(!e)return null;let r=e.getBoundingClientRect();
  const vw=(typeof window!=='undefined'&&window.innerWidth)||1e5,vh=(typeof window!=='undefined'&&window.innerHeight)||1e5;
  if(r.bottom<0||r.top>vh||r.right<0||r.left>vw){try{e.scrollIntoView({block:'nearest'});}catch(err){}r=e.getBoundingClientRect();}
  return r.width>0&&r.height>0?{x:Math.round(r.left+r.width/2+fox),y:Math.round(r.top+r.height/2+foy)}:null;};
 // v1.2.53：账号下拉若已展开（含「退出当前账号」项），返回一个收起用的空白坐标（菜单容器左外侧），
 // 主进程先点它收起菜单再继续导航——展开的下拉会挡住后续一切点击
 let dismiss=null;
 for(const e of document.querySelectorAll('div,span,li,a')){
  if(visible(e)&&own(e)==='退出当前账号'){
   const el=e.closest('[class*=popup],[class*=overlay],[class*=menu],[class*=dropdown],[class*=panel]')||e.parentElement;
   const rr=(el||e).getBoundingClientRect();
   dismiss={x:Math.max(5,Math.round(rr.left-60+fox)),y:Math.max(5,Math.round(rr.top-30+foy))};
   break;
  }
 }
 // v1.2.48：hoverText 支持数组（多级菜单，如「财务」→「资金管理」→「收支记录」），按顺序悬停
 const hoverList=Array.isArray(hoverText)?hoverText:[hoverText];
 const hoverEls=hoverList.map(t=>pick(t)).filter(Boolean);
 const hovers=hoverEls.map(center).filter(Boolean);
 const anchorEl=hoverEls[hoverEls.length-1]||null;
 const anchorRect=anchorEl?anchorEl.getBoundingClientRect():null;
 // v1.2.59（16:50 日志实锤）：页面里存在**多个**「资金管理」——财务在 y=507，而命中的那个在 y=188，
 // 相距 319px，明显不是「财务」展开出来的子项。旧逻辑只要命中就当作展开成功，于是点了个假目标，
 // 然后必然进不去（用户看到的就是「永远要手动点财务」）。子菜单项必须紧贴悬浮项下方（或同一侧栏列）才算数。
 const hitEl=pick(keyword);
 let hitRect=null,rejected=null;
 // v1.2.60：命中自检——录屏实锤发到 (152,188) 的真实点击会落到浮层上一项「总览」（项间距只有 ~40px，
 // 浮层项与外层同名项又容易混）。点击坐标必须在「点下去 elementFromPoint 命中的就是关键词」的位置上：
 // 中心点不对就在元素矩形内按 4px 步进上下扫点，找到真正命中关键词的点，避免发出一个必然点偏的坐标。
 const textAt=(ex,ey)=>{
  try{const el=document.elementFromPoint(ex,ey);if(!el)return '';
   let n=el;for(let i=0;i<4&&n;i++){const t=(n.textContent||'').replace(/\s+/g,'');if(t&&t.length<=24)return t.slice(0,12);n=n.parentElement;}
   return '';
  }catch(e){return '';}
 };
 let hitAt=null,hitText='';
 if(hitEl){
  const r=hitEl.getBoundingClientRect();
  if(anchorRect){
   const dx=Math.abs((r.left+r.width/2)-(anchorRect.left+anchorRect.width/2));
   const dy=(r.top+r.height/2)-(anchorRect.top+anchorRect.height/2);
   if(dx<=460&&dy>=-140&&dy<=720){hitRect=r;}
   else rejected={x:Math.round(r.left+r.width/2+fox),y:Math.round(r.top+r.height/2+foy),dx:Math.round(dx),dy:Math.round(dy)};
  }else hitRect=r;
  if(hitRect){
   const cx=r.left+r.width/2,cy=r.top+r.height/2;
   const key=String(keyword||'').replace(/\s+/g,'');
   hitText=textAt(cx,cy);
   if(key&&hitText===key){hitAt={x:Math.round(cx+fox),y:Math.round(cy+foy)};}
   else if(key){
    for(let s=4;s<=Math.max(20,r.height);s+=4){
     let done=false;
     for(const [ox,oy] of [[0,s],[0,-s],[s*1.5,0],[-s*1.5,0],[0,s*2],[0,-s*2]]){
      const px=cx+ox,py=cy+oy;
      if(px<r.left||px>r.right||py<r.top||py>r.bottom)continue;
      if(textAt(px,py)===key){hitAt={x:Math.round(px+fox),y:Math.round(py+foy)};hitText=key;done=true;break;}
     }
     if(done)break;
    }
   }
  }
 }
 return {
  hover:hovers[0]||null,hovers,hit:hitAt||(hitRect?center(hitEl):null),hitText,dismiss,
  diag:{
   fox:Math.round(fox),foy:Math.round(foy),dpr:(typeof window!=='undefined'&&window.devicePixelRatio)||1,
   vw:(typeof window!=='undefined'&&window.innerWidth)||0,vh:(typeof window!=='undefined'&&window.innerHeight)||0,
   anchor:anchorRect?{x:Math.round(anchorRect.left+fox),y:Math.round(anchorRect.top+foy),w:Math.round(anchorRect.width),h:Math.round(anchorRect.height)}:null,
   hitRect:hitRect?{x:Math.round(hitRect.left+fox),y:Math.round(hitRect.top+foy)}:null,
   // v1.2.67：悬停坐标下 elementFromPoint 实际命中的文本（验证坐标是否落偏的关键证据）
   atHover:hovers[0]?textAt(hovers[0].x-fox,hovers[0].y-foy):'',
   rejected
  }
 };
}
// v1.2.59：页面内用**完整指针事件序列**点开菜单项（合成 click 点不动的官方菜单靠它）。
// 千牛侧栏大多监听 pointerdown/mousedown 而不是 click，只派发 click 不会展开——
// 16:50 之后「资金管理」子项能被合成点击命中，说明这条路可行，只是要对「财务」补全指针序列。
// 返回点击前后目标项可见性对比，供主进程判定「是否真的展开」，不再靠「存在即成功」自欺。
// 页面脚本（v1.2.64 一条龙）：同一脚本执行内完成「hover 展开 → 找新出现的子项 → 合成点击」。
// 11-09 11:51 日志实锤：合成 hover 能把浮层打开（menu-pointer opened:true），但浮层活不过本次
// 脚本执行——随后另起一次 executeJavaScript 去量坐标时浮层已关，永远只剩页面里常驻的假
// 「资金管理」（紧邻约束正确拒绝了它），hit 恒为 null，后面四步兜底全部空转。
// 所以展开、找子项、点击必须一口气做完；子项以「hover 前不存在、hover 后新出现」为准，
// 常驻假目标天然被排除；坐标沿 frameElement 链换算到顶层视口带回，供真实鼠标复核补刀。
function menuPointerScript(hoverText,keyword){
 let fox=0,foy=0;
 try{let f=window.frameElement;while(f){const r=f.getBoundingClientRect();fox+=r.left;foy+=r.top;f=f.ownerDocument.defaultView.frameElement;}}catch(e){}
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0');
 const own=e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s+/g,'').trim();
 const key=String(keyword||'').replace(/\s+/g,'');
 const hkey=String(Array.isArray(hoverText)?hoverText[0]:(hoverText||'')).replace(/\s+/g,'');
 const sel='a,span,div,button,li,[role=menuitem],[role=button],td';
 const candidates=t=>[...document.querySelectorAll(sel)].filter(e=>visible(e)&&own(e)===t);
 const sideFirst=els=>{const s=els.filter(e=>{const r=e.getBoundingClientRect();return r.left<450&&r.top>64;});return s.length?s:els;};
 const target=sideFirst(candidates(hkey)).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
 if(!target)return {ok:false,reason:'找不到菜单悬浮项'};
  // v1.2.68：紧邻过滤已撤销（14:25 批次实锤是误杀，见下方 before 注释）。
  // adjacent 仅保留用于日志参考：fresh 命中项若超出紧邻范围会记入 rejectedAdj，方便下次定位。
  const anchorRect=target.getBoundingClientRect();
 // v1.2.67：光标落点自检——把 hover 坐标下 elementFromPoint 命中的文本带回，
 // 一眼看出「悬停到底悬在谁身上」（16:12 日志 opened 恒为 false，需要确认坐标是否落偏）
 const pointText=(px,py)=>{
  try{const el=document.elementFromPoint(px,py);if(!el)return '';
   let n=el,out=[];for(let i=0;i<3&&n;i++){const t=(n.textContent||'').replace(/\s+/g,'');if(t&&t.length<=20)out.push(t.slice(0,10));n=n.parentElement;}
   return out.join('>');
  }catch(e){return '';}
 };
 const rejectedAdj=[];
 const adjacent=e=>{
  if(!anchorRect)return true;
  const r=e.getBoundingClientRect();
  const dx=Math.abs((r.left+r.width/2)-(anchorRect.left+anchorRect.width/2));
  const dy=(r.top+r.height/2)-(anchorRect.top+anchorRect.height/2);
  const ok=dx<=460&&dy>=-140&&dy<=720;
  if(!ok&&rejectedAdj.length<3)rejectedAdj.push({x:Math.round(r.left+r.width/2+fox),y:Math.round(r.top+r.height/2+foy),dx:Math.round(dx),dy:Math.round(dy)});
  return ok;
 };
  // hover 前先记下已可见的同名元素：只有 hover 后**新出现**的子项才算浮层展开
  // v1.2.68（14:25 批次日志复盘）：v1.2.65 的紧邻校验是误杀——hover「财务」后新出现的
  // 「资金管理」@(152,188) /「总览」@(138,147) 就是浮层子项（allFresh 证据），14:25 批次
  // v1.2.64 无紧邻约束时逐店点它们 10~90 秒内全部 run-opened 成功；v1.2.65 拒掉后只剩
  // 直达可达的店（vldoliya/icestark 新外壳）能进，其余全灭。fresh 集合本身已排除
  // hover 前可见的常驻项，不再叠加紧邻约束；adjacent 保留仅供日志参考（rejectedAdj）。
 const before=new Set(candidates(key));
 const fire=(el,withClick)=>{
  const r=el.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);
  const base={bubbles:true,cancelable:true,composed:true,view:window,clientX:x,clientY:y,screenX:x,screenY:y,button:0,buttons:0};
  const seq=[
   ['pointerover',{...base,pointerId:1,pointerType:'mouse',isPrimary:true}],
   ['pointerenter',{...base,pointerId:1,pointerType:'mouse',isPrimary:true,bubbles:false}],
   ['mouseover',base],
   ['mouseenter',{...base,bubbles:false}],
   ['pointermove',{...base,pointerId:1,pointerType:'mouse',isPrimary:true}],
   ['mousemove',base]
  ];
  if(withClick)seq.push(
   ['pointerdown',{...base,pointerId:1,pointerType:'mouse',isPrimary:true,buttons:1}],
   ['mousedown',{...base,buttons:1}],
   ['pointerup',{...base,pointerId:1,pointerType:'mouse',isPrimary:true}],
   ['mouseup',base],
   ['click',{...base,detail:1}]
  );
  for(const [type,init] of seq){
   try{const ev=/^pointer/.test(type)?new PointerEvent(type,init):new MouseEvent(type,init);el.dispatchEvent(ev);}catch(e){}
  }
 };
 fire(target,false);
 return new Promise(resolve=>{
  const started=Date.now();let clickTried=false;
  const freshRaw=()=>candidates(key).filter(e=>!before.has(e));
  const fresh=()=>freshRaw();
  const tick=()=>{
   const el=sideFirst(fresh()).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
   if(el){
    const r=el.getBoundingClientRect(),at={x:Math.round(r.left+r.width/2+fox),y:Math.round(r.top+r.height/2+foy)};
    fire(el,true);
    setTimeout(()=>{
     const still=fresh().length>0;
     resolve({ok:true,opened:true,clicked:true,at,stillVisible:still,rejectedAdj:rejectedAdj.slice(0,3),frame:{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}});
    },700);
    return;
   }
   // 1.2 秒还没浮出：补一次真实 click（覆盖点击展开型菜单）再继续等
   if(!clickTried&&Date.now()-started>1200){clickTried=true;try{target.click();}catch(e){}}
   if(Date.now()-started<3000){setTimeout(tick,150);return;}
   resolve({ok:true,opened:false,clicked:false,beforeVisible:before.size>0,rejectedAdj:rejectedAdj.slice(0,3),
    atHover:pointText(Math.round(anchorRect.left+anchorRect.width/2),Math.round(anchorRect.top+anchorRect.height/2)),
    allFresh:freshRaw().slice(0,6).map(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2+fox),y:Math.round(r.top+r.height/2+foy),text:own(e).slice(0,8)};}),
    reason:'hover 后没有新出现的子项（浮层未展开或已立即关闭）'});
  };
  tick();
 });
}
// 页面脚本：先对悬浮文本派发 hover 事件展开子菜单（1.5 秒无果再补一次真实 click，覆盖点击展开型菜单），
// 在 4 秒内轮询查找含关键词的可见菜单项并点击；命中锚点时返回其 href（供主进程直接 load 跳转）；
// 未命中时返回菜单区财务相关短文本，便于诊断
function menuProbeScript(keyword,hoverText){
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0');
 const own=e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s+/g,'').trim();
 const key=String(keyword||'').replace(/\s+/g,'');
 const hkey=String(hoverText||'').replace(/\s+/g,'');
 const fire=(e,type)=>e.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window}));
 const sel='a,span,div,button,li,[role=menuitem],[role=tab],[role=button],td';
 const byLite=(root,pred)=>[...root.querySelectorAll(sel)].filter(pred);
 const search=()=>byLite(document,e=>visible(e)&&own(e).includes(key)).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);
 // shadow DOM 深度搜索：侧边栏用 Web Components 时常规查询命不中，递归 shadow root 兜第二次
 const deepSearch=()=>{const out=[];const walk=root=>{for(const h of root.querySelectorAll('*')){if(!h.shadowRoot)continue;out.push(...byLite(h.shadowRoot,e=>visible(e)&&own(e).includes(key)));walk(h.shadowRoot);}};walk(document);return out.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);};
 const deepHosts=()=>{const out=[];const walk=root=>{for(const h of root.querySelectorAll('*')){if(!h.shadowRoot)continue;out.push(...byLite(h.shadowRoot,e=>visible(e)&&own(e)===hkey));walk(h.shadowRoot);}};walk(document);return out;};
 // v1.2.53：hover 目标同样优先侧边栏区域（顶部头像旁「财务」角色标签会把账号下拉点开）
 const sideFirst=els=>{const s=els.filter(e=>{const r=e.getBoundingClientRect();return r.left<450&&r.top>64;});return s.length?s:els;};
 const hosts=hkey?sideFirst(byLite(document,e=>visible(e)&&own(e)===hkey)).concat(deepHosts()):[];
 const fireHosts=types=>{for(const h of hosts)for(const t of types){try{fire(h,t);}catch(e){}}};
 return new Promise(resolve=>{
  const started=Date.now();let clickTried=false;
  const tick=()=>{
   let hits=search();
   // 常规查询连续落空时再启深度搜索，避免每 150ms 都遍历整页 shadow 树
   if(!hits.length&&Date.now()-started>600)hits=deepSearch();
   if(hits.length){
    const first=hits[0],anchor=first.closest('a[href]')||first.querySelector('a[href]');
    try{first.click();}catch(e){}
    resolve({clicked:1,href:anchor?anchor.href:'',text:own(first).slice(0,20)});
   }else if(Date.now()-started<4000){
    if(hosts.length&&!clickTried&&Date.now()-started>1500){clickTried=true;for(const h of hosts){try{h.click();}catch(e){}}}
    setTimeout(tick,150);
   }else{
    // 菜单项可能藏在隐藏 DOM 里：抓含关键词的链接（不管可见与否）、尝试点击隐藏匹配项，并把悬浮目标的链接带回
    const links=[...document.querySelectorAll('a[href]')].map(a=>({t:String(a.textContent||'').replace(/\s+/g,''),href:a.href})).filter(l=>l.t.includes(key)&&/^https:/i.test(l.href)).map(l=>l.href);
    const hiddenHit=[...document.querySelectorAll(sel)].filter(e=>own(e)===key).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
    if(hiddenHit){try{hiddenHit.click();}catch(e){}}
    const hoverAnchor=hosts.map(h=>h.closest('a[href]')||h.querySelector('a[href]')).find(Boolean);
    resolve({clicked:hiddenHit?2:0,hrefs:[...new Set(links)].slice(0,3),hoverHref:hoverAnchor&&/^https:/i.test(hoverAnchor.href)?hoverAnchor.href:'',candidates:[...document.querySelectorAll(sel)].filter(visible).map(e=>own(e)).filter(t=>t&&t.length<=10&&/资金|账户|收支|财务|对账|结算|提现|总览/.test(t)).slice(0,12)});
   }
  };
  if(hosts.length)fireHosts(['mouseenter','mouseover','pointerenter','pointerover','mousemove']);
  tick();
 });
}
// 页面脚本：诊断采集——当前地址（含桥接 iframe 解码后的真实应用地址）、正文、左侧菜单候选、
// 财务相关可点元素、iframe 列表（带坐标偏移，供真实鼠标事件换算窗口坐标）、shadow root 内容
function diagnoseScript(){
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0');
 const text=e=>(e?.innerText||e?.textContent||'').replace(/[\uE000-\uF8FF]/g,'').replace(/\s+/g,' ').trim();
 const rectOf=e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};};
 const sel='a,span,div,button,li,[role=menuitem],[role=tab],[role=button]';
 const collect=root=>[...root.querySelectorAll(sel)].filter(visible).map(e=>{const t=text(e);return t&&t.length<=30?{t,tag:e.tagName.toLowerCase(),cls:String(e.className||'').slice(0,70),href:(e.closest('a[href]')||{}).href||'',r:rectOf(e)}:null;}).filter(Boolean);
 const items=collect(document);
 // Web Components：侧边栏若用 shadow DOM 渲染，常规选择器拿不到，这里单独收集
 let shadowHosts=0;const shadowItems=[];
 (function walk(root){for(const h of root.querySelectorAll('*')){if(!h.shadowRoot)continue;shadowHosts++;shadowItems.push(...collect(h.shadowRoot));walk(h.shadowRoot);}})(document);
 let xd='';try{const m=decodeURIComponent(location.hash||'').match(/"url"\s*:\s*"([^"]+)"/);if(m)xd=m[1];}catch(e){}
 const all=items.concat(shadowItems);
 return {
  url:location.href,xdUrl:xd,title:document.title,
  body:(document.body?.innerText||'').replace(/\s+/g,' ').slice(0,1500),
  menu:items.filter(o=>o.r.x<340&&o.t.length<=14).slice(0,60),
  shadowHosts,shadowMenu:shadowItems.filter(o=>o.t.length<=14).slice(0,40),
  keywords:all.filter(o=>/财务|资金|账户|结算|对账|资产|钱包|收款|账单/.test(o.t)).slice(0,40),
  iframes:[...document.querySelectorAll('iframe,frame')].map(f=>({src:String(f.src||f.name||'').slice(0,300),visible:visible(f),r:rectOf(f)})),
  inputs:document.querySelectorAll('input').length,
  scroll:{x:Math.round(scrollX||0),y:Math.round(scrollY||0)}
 };
}
// 页面脚本：导出精简 DOM（去掉脚本/样式），供事后离线对照真实结构写选择器
function dumpHtmlScript(limit){
 const clone=document.documentElement.cloneNode(true);
 for(const e of clone.querySelectorAll('script,style,link,noscript,svg,path'))e.remove();
 // shadow root 的内容不在 outerHTML 里，单独序列化后追加
 const shadows=[];let i=0;
 (function walk(root){for(const h of root.querySelectorAll('*')){if(!h.shadowRoot)continue;i++;shadows.push('<!-- shadow#'+i+' host='+h.tagName.toLowerCase()+'.'+String(h.className||'').slice(0,40)+' -->\n'+h.shadowRoot.innerHTML);walk(h.shadowRoot);}})(document);
 let html=clone.outerHTML.replace(/\n\s*\n/g,'\n').replace(/[ \t]{2,}/g,' ');
 if(shadows.length)html+='\n<SHADOW_ROOTS>\n'+shadows.join('\n')+'\n</SHADOW_ROOTS>';
 const cap=limit||400000;
 return {url:location.href,title:document.title,length:html.length,truncated:html.length>cap,html:html.slice(0,cap)};
}
function sanitizeName(name){return String(name||'').replace(/[\\/:*?"<>|\s]+/g,'-').slice(0,60)||'店铺';}
function today(){return new Date(Date.now()+28800000).toISOString().slice(0,10);}
// v1.2.80 批量下载任务表（纯函数，便于单测）：按抓取结果挑出可下载的行——
// 只要指定 runId（新一轮抓取=新 runId，重新抓过后同一店铺同月可以再下载一次）、completed、
// 无 error（「该月无数据」用 error 标记，自然排除）、明细笔数不为 0 的行。
// kind 分流：历史满月走月汇总导出，当月/未来月走日汇总逐日「下载明细」。
function batchJobs(results,{now,runId,done}={}){
 const out=[],seen=new Set(),ym=now||nowMonth(),set=done||new Set();
 for(const r of results||[]){
  if(runId&&r.runId!==runId)continue;
  if(r.status!=='completed'||r.error)continue;
  if(r.detailCount===0)continue;
  const key=r.shopId+'|'+r.month+'|'+(r.runId||'');
  if(set.has(key)||seen.has(key))continue;
  seen.add(key);
  out.push({key,shopId:r.shopId,name:r.shopName,month:r.month,kind:r.month<ym?'month':'daily'});
 }
 return out;
}

class FundSummary{
 constructor({host,root,dialog,downloads,desktop,hidden=false,autoDownload}){
  Object.assign(this,{host,root,dialog,downloads,desktop,hidden});
  this.file=path.join(root,'fund-summary.json');
  this.busy=false;this.stopped=false;this.downloadBusy=false;this.downloadCtx=null;this.phaseText='';this.lastError='';this.activeQueries=new Map();
  // 手动接管：等待用户在弹窗里点到资金页；诊断：采集真实页面结构
  this.manual=false;this.manualConfirmed=new Set();this.manualSkipped=new Set();this.manualPendingInfo=null;this.diagnosing=false;this.failCaptures=0;this.failCapturedShops=new Set();
  this.data={version:1,exportFolder:'',results:[]};
  // v1.2.80 批量下载任务去重集合：键 = 店铺|月份|runId（**必须带 runId**——此前 UI 只按店铺|月份去重，
  // 上一批下载成功后重新抓取的新数据仍被跳过，用户看到的就是「批量下载明细按钮用不了了」）
  this.batchDone=new Set();
  // 排队抓取时同时开几个店铺窗口：固定 1（串行），详见 RUN_CONCURRENCY 注释
  this.runConcurrency=RUN_CONCURRENCY;
  try{this.data=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('资金月汇总记录无法读取，未覆盖原文件');}
  this.data.exportFolder=typeof this.data.exportFolder==='string'?this.data.exportFolder:'';
  // v1.2.80：测试用 autoDownload:false 关掉「抓取后自动下载」（否则 mock 环境也会白跑一轮下载，
  // 多触发登录并把测试拖到 100 秒以上）；生产不传该参数，按持久化设置走（默认开）
  if(autoDownload===false)this.data.autoDownload=false;
  // 上次中断的抓取不自动续跑，与推广费同一语义
  this.data.results=(this.data.results||[]).map(r=>['running','queued'].includes(r.status)?{...r,status:'paused',error:'上次抓取已中断，未自动重新抓取'}:r);
 }
 // 轨迹日志（v1.2.55）：用户点「批量下载明细」时主进程会整个消失（Crashpad 抓到 0x80000003 trap，
 // 没有任何 JS 异常），JS 层日志一片空白。把下载/导航每一步同步落盘，下次再崩能看出停在哪一步。
 log(event,detail){
  try{
   const file=path.join(this.root,'fund.log');
   if(fs.existsSync(file)&&fs.statSync(file).size>1<<20)fs.writeFileSync(file,'');
   fs.appendFileSync(file,new Date(Date.now()+28800000).toISOString().replace('T',' ').slice(0,19)+' | '+event+(detail?' | '+String(detail).replace(/\s+/g,' ').slice(0,400):'')+'\n');
  }catch(e){}
 }
 save(data){try{fs.mkdirSync(this.root,{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(data),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);this.data=data;}catch(e){throw Error('资金月汇总记录保存失败：'+e.message);}}
 exportFolder(){return this.data.exportFolder||path.join(this.desktop||this.downloads,'诗玛资金导出');}
 setExportFolder(dir){if(this.busy||this.downloadBusy)throw Error('抓取或导出正在运行');if(typeof dir!=='string'||!path.isAbsolute(dir))throw Error('导出文件夹路径无效');this.save({...this.data,exportFolder:dir});return this.state();}
 check(){if(this.stopped)throw Error('抓取已暂停');if(this.host.writeFailure)throw Error('本机保存失败，已停止后续抓取');}
 // 登录/页面就绪核验加 5 分钟护栏（v1.2.31）：authenticate 内部等人工登录/验证时没有任何 check() 执行点，
 // 一旦挂住 downloadBusy 永不释放，页面上「一键抓取/下载明细/暂停」全部灰死，只能重开软件——实测踩过。
 // 人工登录可以慢，但不允许无限挂；超时中止后用户可点「暂停」或直接重试
 async authenticateGuarded(shop,win){
  const pending=this.host.authenticate(shop,win,{revalidate:true});
  pending.catch(()=>{});// 护栏先超时命中时，防孤儿 reject
  return await Promise.race([
   pending,
   new Promise((_,rej)=>{const t=setTimeout(()=>rej(Error('等待该店铺登录/页面就绪超过 5 分钟，已中止本次任务（官方窗口可能还在等人工登录）——请在官方窗口完成登录后再重试')),LOGIN_GUARD_MS);if(t.unref)t.unref();}),
  ]);
 }
 state(){
  // v1.2.85 显示合并（与推广费同口径，2026-11-11 财务反馈「重抓后第一轮的数据看不到」）：
  // 每店显示最新一行；最新一行失败/已暂停/需人工时，把该店上一轮已获取的结果一并显示
  //（carriedOver 标注），完成数与合计仍按「每店最新已获取」计算。落盘数据不改动。
  const all=this.data.results||[];
  const lastIdx=new Map();
  for(let i=0;i<all.length;i++){const r=all[i];if(!r.shopId)continue;lastIdx.set(r.shopId,i);}
  const latest=[...lastIdx.values()].map(i=>all[i]);
  const now=Date.now(),carried=[];const carriedSeen=new Set();
  for(const r of latest){
   // 同推广费：只有最新一行是近期的失败/暂停才回显上一轮结果，避免孤立旧行
   if(!r.shopId||!['failed','manual','paused'].includes(r.status)||!rowRecent(r,now))continue;
   for(let i=all.length-1;i>=0;i--){const o=all[i];if(o.shopId===r.shopId&&o.status==='completed'&&!carriedSeen.has(r.shopId)){carriedSeen.add(r.shopId);carried.push({...o,carriedOver:true});break;}}
  }
  // v1.2.87：近期行（今天/昨天）进表，更早的失败/暂停记录归入 stale，默认不显示。
  // 最新一轮的行一律保留（允许用户查很久以前的自定义区间）。
  const allRows=[...carried,...latest],lastRun=all.at(-1)?.runId;
  const keep=r=>r.carriedOver||(!!lastRun&&r.runId===lastRun)||rowRecent(r,now);
  const recent=allRows.filter(keep),stale=allRows.filter(r=>!keep(r));
  return {results:recent,stale,busy:this.busy,downloadBusy:this.downloadBusy,diagnosing:this.diagnosing,manual:this.manual,manualPending:this.manualPendingInfo,phase:this.busy||this.downloadBusy||this.diagnosing?this.phaseText:'',error:this.busy||this.downloadBusy?'':this.lastError,exportFolder:this.exportFolder(),exportFolderCustom:!!this.data.exportFolder,autoDownload:this.autoDownload(),batchDone:[...this.batchDone],shops:this.host.data.shops.map(({secret,...s})=>({id:s.id,name:s.name,platform:s.platform||'taobao',username:s.username,loginConfirmedAt:s.loginConfirmedAt||null,loginNeedsAttention:!!s.loginNeedsAttention}))};}
 async clickText(win,target){
  // 菜单可能在 iframe 里：跨所有子 frame 尝试点击文本
  const wc=this.host.assertWindow(win),frames=(wc&&wc.mainFrame&&wc.mainFrame.framesInSubtree)||[];
  for(const frame of (frames.length?frames:[undefined])){
   try{if(await this.host.execute(win,'('+clickTextScript.toString()+')('+JSON.stringify(target)+')',true,frame)==1)return true;}catch(e){}
  }
  return false;
 }
 framesOf(win){
  const wc=this.host.assertWindow(win),frames=(wc&&wc.mainFrame&&wc.mainFrame.framesInSubtree)||[];
  return frames.length?frames:[wc];
 }
 // 千牛工作台是壳页面，财务应用很可能嵌在 iframe 里：逐个 frame 执行只读检查，
 // 返回信息量最大的结果（有数据/已到资金页优先），并把所有 frame 的地址带回供报错诊断
 async inspectAll(win){
  const withTimeout=(p,ms)=>Promise.race([p.catch(()=>null),new Promise(r=>setTimeout(()=>r(null),ms))]);
  let best=null,bestScore=-1,errBest=null;const urls=[];
  const score=st=>(st.record||st.row?8:0)+(st.fundHome||st.onFundUrl?4:0)+(st.monthInputs&&st.monthInputs.length?2:0)+(st.tabs&&Object.values(st.tabs).some(Boolean)?1:0);
  for(const frame of this.framesOf(win)){
   const st=await withTimeout(this.host.readPage(win,'('+fundInspect.toString()+')()',frame),8000);
   if(!st||typeof st!=='object')continue;
   st.frame=frame;
   if(st.url&&!urls.includes(st.url))urls.push(st.url);
   if(st.xdUrl&&!urls.includes('桥内:'+st.xdUrl))urls.push('桥内:'+st.xdUrl);
   if(st.error){
    // 出错 frame 里保留拦截性最强的：人工验证 > 需要登录 > 其他
    const rank=st.code==='verification'?2:st.code==='need_login'?1:0;
    const cur=errBest?(errBest.code==='verification'?2:errBest.code==='need_login'?1:0):-1;
    if(rank>cur)errBest=st;
    continue;
   }
   const s=score(st);
   if(s>bestScore||!best){best=st;bestScore=s;}
  }
  if(!best)best=errBest||{error:'所有页面区域都无法读取（可能正在跳转）',code:'unreadable'};
  if(urls.length)best.allUrls=urls.join(' | ');
  return best;
 }
 // 真实鼠标统一入口（v1.2.55）：坐标必须是有限数且落在窗口范围内才发。
 // 之前直接把元素坐标透传给 host.sendMouse，元素没量到尺寸时是 undefined → Math.round 得 NaN，
 // 非法坐标进 Chromium 输入管道属于未定义行为（主进程原生崩溃的候选点之一）
 async mouse(win,type,x,y){
  const nx=Number(x),ny=Number(y);
  if(!Number.isFinite(nx)||!Number.isFinite(ny)||nx<0||ny<0||nx>6000||ny>6000)return false;
  // v1.2.59：getBoundingClientRect 给的是 CSS 像素，sendInputEvent 吃的是设备无关像素；
  // 页面一旦被缩放（Ctrl+滚轮 / setZoomFactor）两者不等，按缩放比换算，否则真实鼠标会整片点偏
  let k=1;
  try{
   const wc=this.host.assertWindow(win);
   const z=wc&&typeof wc.getZoomFactor==='function'?Number(wc.getZoomFactor()):1;
   if(Number.isFinite(z)&&z>0.4&&z<3)k=z;
  }catch(e){}
  return await this.host.sendMouse(win,type,Math.round(nx*k),Math.round(ny*k));
 }
 // 真实鼠标按顶层视口坐标完整三段点击（v1.2.65 提为类方法，realMenuClick 内部复用）
 async clickXY(win,p){
  if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))return false;
  await this.mouse(win,'mouseMove',p.x,p.y);await wait(120);
  await this.mouse(win,'mouseDown',p.x,p.y);await wait(60);
  await this.mouse(win,'mouseUp',p.x,p.y);
  return true;
 }
 // v1.2.70：菜单点击后的「导航验证」——11-10 实锤合成/真实点击 (152,188) 后 stillVisible:true、
 // 页面原地不动，旧逻辑把「事件发出去了」当成功，menuEnter 白等 3 秒再扑空、menuDead 判定虚设，
 // 直达接管被无限推迟。这里轮询页面：URL 进了 whale-accountant 或资金迹象出现才算真成功
 async menuVerifyOk(win,ms){
  const end=Date.now()+(ms||6000);
  while(Date.now()<end){
   await wait(800);
   let st=null;
   try{st=await this.inspectAll(win);}catch(e){}
   if(st){
    if(/whale-accountant/i.test(st.url||''))return true;
    if(st.record||st.fundHome||(st.monthInputs&&st.monthInputs.length))return true;
   }
  }
  return false;
 }
 // v1.2.74：首页「保证金 → 查看详情」常驻卡片入口（用户 11-10 提议：先点保证金，进财务模块后
 // 左侧栏找「资金管理」，再进收支汇总）。查看详情是首页常驻卡片链接，不依赖任何 hover 浮层；
 // 点开落在资金管理>保证金账户（财务模块内），外层导航循环接手后续（侧栏资金管理/直达/收支记录）。
 // 找不到卡片（首页版式不同）时快速返回 false，回落菜单原路径，零副作用。
 async enterViaDeposit(win){
  if(typeof this.host.sendMouse!=='function')return false;
  const script='('+depositEntryScript.toString()+')()';
  let hit=null,miss=null;
  for(const frame of this.framesOf(win)){
   try{
    const r=await this.host.readPage(win,script,frame).catch(()=>null);
    if(r&&r.found){hit={...r,frame:frame===undefined?'main':'child'};break;}
    if(r&&!r.found)miss=r;
   }catch(e){}
  }
  if(!hit){
   // v1.2.76：没找到保证金卡片时把页面「保证金/查看详情」相关元素结构写进日志——
   // 实测一轮即可看清各家首页版式差异，不再盲猜匹配条件
   this.log('deposit-entry',JSON.stringify({stage:'miss',dep:miss&&miss.dep||null,views:miss&&miss.views?miss.views.filter(v=>v&&v.ctx).slice(0,4):null}));
   return false;
  }
  this.log('deposit-entry',JSON.stringify({stage:'found',x:hit.x,y:hit.y,frame:hit.frame}));
  try{const wc=this.host.assertWindow(win);if(wc&&typeof wc.focus==='function')wc.focus();}catch(e){}
  await this.clickXY(win,{x:hit.x,y:hit.y});
  const ok=await this.menuVerifyOk(win,5000);
  this.log('deposit-entry',JSON.stringify({stage:'verify',ok}));
  return ok;
 }
 // 真实鼠标点菜单：hover 悬浮项 → 找目标菜单项 → mouseDown/mouseUp；
 // 500ms 内子菜单没出现就真点一下悬浮项（覆盖点击展开型）再找一次
 async realMenuClick(win,hoverText,keyword){
  if(typeof this.host.sendMouse!=='function')return false;
  // v1.2.60：点击前把页面聚焦——无焦点的窗口里合成鼠标事件会被静默忽略
  //（16:49-16:52 日志量到坐标却始终点不开、用户手点一下立刻恢复，正是焦点丢失形态）
  try{const wc=this.host.assertWindow(win);if(wc&&typeof wc.focus==='function')wc.focus();}catch(e){}
  const rectScript='('+menuRectScript.toString()+')('+JSON.stringify(hoverText||'')+','+JSON.stringify(keyword||'')+')';
  const pointerScript='('+menuPointerScript.toString()+')('+JSON.stringify(hoverText||'')+','+JSON.stringify(keyword||'')+')';
  // v1.2.58：菜单可能嵌在子 iframe 里——主 frame 量不到坐标不等于菜单不存在。逐 frame 量，谁量到用谁；
  // 坐标已由 menuRectScript 换算成顶层视口坐标。v1.2.59：只有「子项紧邻悬浮项」才算 hit（不再把
  // 页面里别处的同名项当成功），并带回 diag 供日志定位。
  const read=async()=>{
   let best=null,bestFrame='';
   for(const frame of this.framesOf(win)){
    try{
     const st=await this.host.readPage(win,rectScript,frame).catch(()=>null);
     if(st&&(st.hover||st.hit||st.dismiss)){best=st;bestFrame=frame===undefined?'main':'child';break;}
    }catch(e){}
   }
   this.log('menu-rect',JSON.stringify({hover:best&&best.hover,hit:best&&best.hit,hitText:best&&best.hitText,frame:bestFrame,hoverText:Array.isArray(hoverText)?hoverText.join('>'):hoverText,diag:best&&best.diag}));
   return best;
  };
  const moveHovers=async st=>{
   const list=(st&&st.hovers&&st.hovers.length)?st.hovers:(st&&st.hover?[st.hover]:[]);
   if(!list.length)return false;
   for(const p of list){
    await this.mouse(win,'mouseMove',p.x,p.y);await wait(200);
    // 真实用户移动鼠标是连续轨迹：补两个微位移，让只监听 mousemove 的自研菜单也能感知到进入
    await this.mouse(win,'mouseMove',p.x+2,p.y+1);await wait(200);
    await this.mouse(win,'mouseMove',p.x,p.y);await wait(300);
   }
   return true;
  };
  const clickXY=p=>this.clickXY(win,p);
  // v1.2.70：每条点击路径「点了」之后必须验证真的导航了才算成功；没导航就继续下一条策略。
  // 验证窗口 4 秒（诊断实锤导航 1.5 秒内完成）；只挂主路径 ①②（11-10 实锤假成功正发生在这两条），
  // ③④⑤ 兜底路径保持原有「点中即成功」，避免每个网格点都空等拖垮整体节奏
  const verified=async via=>{
   const ok=await this.menuVerifyOk(win,4000);
   this.log('menu-verify',JSON.stringify({via,ok}));
   return ok;
  };
  const clickAt=async st=>{
   if(!st||!st.hit)return false;
   // v1.2.60：点击前重新量一次、以最新坐标落点——浮层弹出/侧栏滚动会让旧坐标当场作废
   //（用户录屏实锤：点击后侧栏整体滚动、「首页」滚出视口，老坐标点下去已是别的菜单项）
   const fresh=await read();
   const h=fresh&&fresh.hit;
   if(!h)return false;
   if(st.hit&&(Math.abs(h.x-st.hit.x)>3||Math.abs(h.y-st.hit.y)>3)){
    this.log('menu-drift',JSON.stringify({old:st.hit,new:h}));
   }
   return await clickXY(h);
  };
  // 合成指针序列点悬浮项：不依赖坐标，专治「真实鼠标点不动但合成点击能命中」的官方菜单
  // v1.2.64：返回完整 chain 结果（at=子项顶层坐标、stillVisible=点击后浮层是否还开着）
  const pointerOpen=async()=>{
   for(const frame of this.framesOf(win)){
    try{
     const r=await this.host.execute(win,pointerScript,true,frame);
     if(r&&r.ok){
      this.log('menu-pointer',JSON.stringify({...r,frame:frame===undefined?'main':'child'}));
      if(r.opened)return r;
     }
    }catch(e){}
   }
   return null;
  };
  let first=await read();
  // v1.2.59：侧栏可能是「图标收起态」——文字（财务/资金管理…）要等鼠标移进侧栏才渲染出来。
  // 16:49:38 日志整段 hover=null、用户把鼠标移到侧栏后才量到坐标，正是这个形态。
  // 先把真实鼠标移到侧栏空白处触发展开，再量第二次。
  if(!first||!first.hover){
   const midY=(first&&first.diag&&first.diag.vh)?Math.round(first.diag.vh/2):400;
   for(const p of [{x:26,y:midY},{x:64,y:midY},{x:40,y:Math.min(midY+120,700)}]){
    await this.mouse(win,'mouseMove',p.x,p.y);await wait(450);
    first=await read();
    if(first&&first.hover)break;
   }
  }
  // v1.2.53：账号下拉若已展开，先真实点击空白处收起——展开的下拉会挡住侧栏菜单的一切点击
  if(first&&first.dismiss){
   this.phaseText='检测到账号下拉菜单展开，先收起再点侧边栏…';
   await this.mouse(win,'mouseMove',first.dismiss.x,first.dismiss.y);await wait(120);
   await this.mouse(win,'mouseDown',first.dismiss.x,first.dismiss.y);await this.mouse(win,'mouseUp',first.dismiss.x,first.dismiss.y);
   await wait(500);
  }
  // ① 菜单本来就是展开的（子项已就位）：直接点（历史路径，点中即成功）
  if(first&&first.hit&&await clickAt(first))return true;
  // ② 合成指针一条龙（v1.2.64）：同一脚本执行内 hover 展开 → 找新出现子项 → 合成点击并带回坐标。
  // 浮层活不过单次脚本执行（11-09 11:51 日志实锤），旧的「开完再另起一次量坐标」永远量不到子项。
  // 合成点击后浮层已关 → 大概率已导航；浮层还开着 → 真实鼠标按脚本带回的坐标补刀。
  // v1.2.70：这条主路径必须验证真的导航了——11-10 fund.log 实锤 clicked:true/stillVisible:true
  // 但页面原地不动，旧逻辑把「事件发出去了」当成功 → menuEnter 白等 3 秒、直达接管被无限推迟。
  // 验证不过 → 菜单判死快速失败，让直达链接接管（走完 ③④⑤ 只会白耗 40 秒）
  const chain=await pointerOpen();
  if(chain&&chain.opened){
   if(chain.clicked&&!chain.stillVisible){
    if(await verified('chain'))return true;
    return false;
   }
   if(chain.at){
    await clickXY(chain.at);
    if(await verified('chain-at'))return true;
    return false;
   }
  }
  // ③ 真实鼠标悬停展开（兜底路径：点中即成功，不验证）
  if(await moveHovers(await read())){
   const st=await read();
   if(st&&st.hit&&await clickAt(st))return true;
  }
  // ④ 真实点击悬浮项展开（覆盖点击展开型菜单）
  const list=(first&&first.hovers&&first.hovers.length)?first.hovers:(first&&first.hover?[first.hover]:[]);
  for(const p of list){
   await this.mouse(win,'mouseMove',p.x,p.y);
   await this.mouse(win,'mouseDown',p.x,p.y);await wait(60);await this.mouse(win,'mouseUp',p.x,p.y);
   await wait(700);
  }
  if(list.length){
   const st=await read();
   if(st&&st.hit&&await clickAt(st))return true;
  }
  // ⑤ 网格兜底：坐标系若仍有轻微偏差（缩放/边框/单元格布局），在悬浮项附近做小范围点击，
  // 每次点完都验证「子项是否就位」，命中即停——比死守一个坐标更能容忍误差
  const anchor=(first&&first.hover)||list[list.length-1]||null;
  if(anchor){
   const offsets=[[0,-10],[0,10],[-8,0],[8,0],[0,-18],[0,18]];
   for(const [dx,dy] of offsets){
    await this.mouse(win,'mouseMove',anchor.x+dx,anchor.y+dy);await wait(120);
    await this.mouse(win,'mouseDown',anchor.x+dx,anchor.y+dy);await wait(60);
    await this.mouse(win,'mouseUp',anchor.x+dx,anchor.y+dy);await wait(600);
    const st=await read();
    if(st&&st.hit&&await clickAt(st))return true;
   }
  }
  return false;
}
 // 逐级导航：直达链接优先（2026-11-04 诊断包证实：直跳 fund_month 1.5 秒内即就绪，
 // record=true 且日期控件就位，无需任何菜单导航）；真实点「财务→资金管理」会跳到「资金账户」总览
 // 反而把页面点走，故菜单导航只在直达链接确实被弹回（directBounced）后才启用
 async openRecordTab(win,tab,shop){
  // 阶段提示（v1.2.23）：此前本阶段进度行一直停在「准备抓取」，用户误以为卡在月汇总
  this.phaseText='正在打开「'+tab+'」页（直达链接优先，最长等 150 秒）';
  // v1.2.78：deadline 改 let——authKick 的重登核验耗时要补回预算（此前重登耗时直接挤占
  // 150 秒导航预算，重登慢的店菜单/直达一次都轮不到就超时，且全程零日志）
  let deadline=Date.now()+(this.openTimeoutMs||OPEN_TIMEOUT_MS);let lastBody='',lastUrl='',lastProbe='',lastUrls='',navRound=0,directTried=false,directBounced=false,lastMicro=null,microWait=0,microFix=0,staleRounds=0,shellBooted=false,bootDeadline=0,menuTries=0,menuDead=false,lastSig='',stallSince=Date.now(),stalls=0,lastLoading=false;
  // v1.2.51（用户 11-08 反馈+点名要求）：登录放行后若 15 秒页面毫无动静（URL 没变、没到资金页、
  // 微应用没挂载），自动重新触发一次登录——等价于用户手动「再点一次登录」。放在导航循环里做：
  // 正常店铺页面很快有动静（跳转/挂载即返回），零额外等待；只有真卡住才等满 15 秒补一脚
  const loopStart=Date.now();let firstUrl='',authKicked=false;
  // v1.2.34：直达链接改候选轮换（新域带参 → 新域裸 → 旧域），每次重试换下一个
  const cands=fundUrlCandidates(tab);let candIdx=0;
  const directUrl=cands[0]||'';
  const nextDirect=()=>{const u=cands[candIdx%cands.length];candIdx++;return u;};
  const probe=async(keyword,hover)=>{
   const wc=this.host.assertWindow(win),frames=(wc&&wc.mainFrame&&wc.mainFrame.framesInSubtree)||[];
   const merged=[],hrefs=[];let found=null,hoverHref='';
   for(const frame of (frames.length?frames:[undefined])){
    try{
     const r=await this.host.execute(win,'('+menuProbeScript.toString()+')('+JSON.stringify(keyword)+','+JSON.stringify(hover)+')',true,frame);
     if(r&&r.clicked){found=r;break;}
     if(r&&r.hoverHref&&!hoverHref)hoverHref=r.hoverHref;
     if(r&&r.hrefs)for(const h of r.hrefs)if(!hrefs.includes(h))hrefs.push(h);
     if(r&&r.candidates&&r.candidates.length)for(const c of r.candidates)if(!merged.includes(c))merged.push(c);
    }catch(e){}
   }
   // 只在真正点中时提前返回；否则汇总所有 frame 的候选词与隐藏链接（菜单可能在 iframe 或藏在隐藏 DOM）
   return found||{clicked:0,candidates:merged.slice(0,12),hrefs:hrefs.slice(0,3),hoverHref};
  };
  const triedHrefs=new Set();
  const loadUntried=hrefs=>{const url=(hrefs||[]).find(h=>/^https:/i.test(h)&&!triedHrefs.has(h));if(url){triedHrefs.add(url);return url;}return '';};
  // v1.2.56（用户 11-08 截图指正，METRISH/博乐旗两图实锤）：左侧菜单根本没有「收支记录」项——
  // 菜单是 总览/资金管理/业务查询/对账管理/…。「收支记录」是**资金管理页聚合结算账户卡片上**
  // （或总览页货款账户卡片上）的链接。人工路径 = 菜单点「资金管理」（或「总览」）→ 页面点「收支记录」。
  // 之前对菜单找「收支记录」永远扑空、重试 4 次全空转再被直达弹回，就是「登录后卡在首页没动作」。
  const menuEnter=async()=>{
   // v1.2.74：最优先试首页「保证金 → 查看详情」常驻卡片入口（用户 11-10 提议并截图实测可用），
   // 点开直接落财务模块；失败再走「财务」菜单（常用入口已在 v1.2.75 移除）。
   if(await this.enterViaDeposit(win))return true;
   // v1.2.75：「常用」收藏入口已按用户要求整体移除（11-10 下午被「保证金→查看详情」常驻卡片入口替代）
   if(await this.realMenuClick(win,'财务','资金管理')||await this.realMenuClick(win,'财务','总览')){
    await wait(3000);
    // 落到资金账户总览 / 财务总览后，点页面里的「收支记录」链接进聚合结算账户
    if(await this.clickText(win,'收支记录'))return true;
    const r=await probe('收支记录');
    if(r&&r.clicked)return true;
    const direct=loadUntried(r&&r.hrefs);
    if(direct){await this.host.load(win,direct);await wait(1500);return true;}
    if(r&&r.href&&/^https:/i.test(r.href)&&!triedHrefs.has(r.href)){triedHrefs.add(r.href);await this.host.load(win,r.href);await wait(1000);return true;}
   }
   return false;
  };
  while(Date.now()<deadline){
   this.check();this.host.assertWindow(win);
   const st=await this.inspectAll(win);
   if(st.error&&st.code!=='need_login')throw Error(st.error);
   if(st.code==='need_login')throw Error('请先在推广费页登录该店铺账号');
   lastBody=st.body||'';lastUrl=st.url||'';lastUrls=st.allUrls||'';lastMicro=st.micro||lastMicro;lastLoading=!!st.loading;
   if(!firstUrl)firstUrl=lastUrl;
   if(shop&&!authKicked&&Date.now()-loopStart>=(this.authKickMs||15000)&&!st.record&&!(st.micro&&st.micro.loaded)&&!(st.monthInputs&&st.monthInputs.length)&&lastUrl===firstUrl){
    authKicked=true;
    this.phaseText=(shop.name||'该店铺')+' 登录后 15 秒页面无反应，自动重新触发一次登录…';
    // v1.2.78：这条路径此前零日志（12:4x run 实锤 10 分钟无一条记录），且重登耗时直接吃掉
    // 导航预算——现在落日志并把耗时补回 deadline
    this.log('auth-kick',(shop.name||'')+' url='+String(lastUrl).slice(0,100));
    const kickT0=Date.now();
    try{await this.host.authenticate(shop,win,{revalidate:true});}catch(e){}
    deadline+=Date.now()-kickT0;
    continue;
   }
   if(st.micro&&st.micro.loaded)shellBooted=true;
   // v1.2.52（用户 11-08 反馈：多数店仍要手动点进去）：15 秒停滞看门狗——页面任何进展信号
   // （URL / 微应用挂载 / 资金页 / 页签控件 / 数据行）连续 15 秒毫无变化，就「重新进入」：
   // 回工作台首页重启外壳，下一轮按手动路径点「财务 → 收支记录」再跳目标页（等价于用户
   // 手动「关掉再进来点一遍」）。微前端挂载等待窗口内不打断（那是官方应用正常加载），
   // 其余一切停滞场景（登录后卡壳、点菜单后没反应、直达后停在总览无控件）都由它兜底
   const sig=[lastUrl,!!(st.micro&&st.micro.loaded),!!st.record,!!st.fundHome,(st.monthInputs&&st.monthInputs.length)||0,(st.rowsDay&&st.rowsDay.length)||0,!!(st.row&&st.row.length),!!st.loading].join('|');
   if(sig!==lastSig){lastSig=sig;stallSince=Date.now();stalls=0;}
   // v1.2.55（用户 2026-11-08：「失败的一般是弹窗后停滞在首页不动」）：旧逻辑只有一级恢复——回首页重进。
   // 可页面本来就在首页时，回首页等于什么都没做，sig 不变、15 秒后再来一次，一直耗到 150 秒超时，
   // 用户看到的就是「窗口开着停在首页不动」。改为分级：回首页 → 直跳目标页 → 抛错交给上层二轮重试。
   // 外壳启动引导期（bootDeadline 内）不干预：首页本来就该静止，那是官方应用在初始化。
   else if(!st.loading&&!(microWait&&Date.now()<microWait)&&!(bootDeadline&&Date.now()<bootDeadline)&&Date.now()-stallSince>=(this.stallMs||15000)){
    stallSince=Date.now();microWait=0;microFix=0;staleRounds=0;menuTries=0;stalls++;
    this.log('nav-stall','第'+stalls+'次 | url='+lastUrl+' | sig='+sig);
    if(stalls===1||stalls===2||stalls===4){
     // 页面停在首页/总览不动时，「回首页」等于原地踏步，直跳目标页才可能破局。
     // v1.2.70：连轮 3 个候选（新域带参 → 旧域 qn → 新域裸），确保 11-04 实锤有效的旧域直达真能轮到
     this.phaseText='页面 15 秒无反应，直接打开「'+tab+'」页链接（候选第'+stalls+'个）…';
     shellBooted=true;bootDeadline=Date.now();
     const u=nextDirect();this.log('direct-load',u);
     await this.host.load(win,u);await wait(1500);continue;
    }
    if(stalls===3){
     this.phaseText='直达候选仍弹回，回工作台首页重启外壳后再跳「'+tab+'」页…';
     shellBooted=false;bootDeadline=0;
     // v1.2.70：外壳重启后菜单有机会恢复（新外壳新 DOM），复位菜单判死给它一次机会
     menuDead=false;menuTries=0;
     await this.host.load(win,SHELL_HOME);await wait(1500);continue;
    }
    throw Error(shop?shop.name+' 页面连续停滞无响应（仍被弹回工作台首页）':'页面连续停滞无响应（仍被弹回工作台首页）');
   }
   else if(st.loading&&Date.now()-stallSince>=(this.loadingStallMs||25000)){
    // v1.2.78（12:34-12:49 run 实锤：10 分钟零日志、每店正好 150s×2）：st.loading 为真时
    // 引导/菜单/直达/stall 看门狗全部被 !st.loading 跳过 → 静默空转到超时，一点痕迹没有。
    // loading 持续 25 秒也按停滞处理：记日志并直跳候选刷新页面（正常加载几秒内结束，不会误伤）
    stallSince=Date.now();stalls++;
    this.log('nav-stall','loading 卡住第'+stalls+'次 | url='+lastUrl);
    const u=nextDirect();this.log('direct-load','loading-stall '+u);
    await this.host.load(win,u);await wait(1500);continue;
   }
   if(st.record){
    await this.clickText(win,tab);
    if(tab!=='月汇总'){
     await wait(700);
     // 页签点击后地址应带上对应 active 参数；没变说明点空了，直接 load 该页签的直达链接兜底
     // v1.2.34：新版工作台 URL 不带 active 参数（被 SPA 丢弃），改为看「本页签的数据迹象」——
     // 注意 monthInputs 是月汇总的控件，对日汇总不算数据（单测用例 27 实锤过这个误判）
     const st2=await this.inspectAll(win).catch(()=>null);
     const hasData=st2&&(st2.empty||(st2.rowsDay&&st2.rowsDay.length)||(st2.row&&st2.row.length));
     // v1.2.78：这发直达此前零日志
     if(st2&&!hasData){const u=nextDirect();this.log('direct-load','tab-no-data '+u);await this.host.load(win,u);await wait(1500);}
     return;
    }
    if(st.row||st.empty||st.monthInputs.length){await wait(300);return;}
    await wait(700);continue;
   }
   const onFund=st.fundHome||/whale-accountant\/(pay\/capital|bill\/)/i.test(st.url||'');
   // v1.2.35：新版工作台是 icestark 微前端（12:28 诊断包实锤）——外壳只渲染菜单，财务模块异步挂到
   // #icestarkNode，直达后 13 秒都没挂上就被「URL 对但 4 轮无控件就 reload」反复打断，越打越慢。
   // URL 已落在财务路径而微应用还没挂上时：先耐心等 30 秒（期间绝不 reload/点菜单），
   // 等满仍空白才换下一候选（带参 → 裸路径 → 总览 → 旧域）；一旦挂载立即恢复正常流程
   if(onFund&&st.micro&&st.micro.present&&!st.micro.loaded){
    if(!microWait){
     microWait=Date.now()+(this.microWaitMs||15000);
     this.phaseText='新版工作台财务模块（微前端）正在挂载，耐心等待（最多 15 秒）…';
     continue;
    }
    if(Date.now()<microWait){await wait(1000);continue;}
    microWait=0;
    // v1.2.47/48（15:25/15:28 两包实锤）：窗口停在资金页、外壳菜单完整（截图可见「财务」子菜单），
    // 微应用没挂载是因为只 load URL 没走 SPA 内部导航。依次升级恢复（用户手动验证的顺序）：
    // ① 真实点击「财务 → 收支记录」（用户唯一稳定入口）
    // ② 真实点击「财务 → 资金管理」
    // ③ 先点「总览」离开再点回「资金管理」（重触发挂载）
    // ④ 回首页重启外壳（13:40 诊断实测外壳启动后直跳 1.5 秒挂载）
    // ⑤ 换下一个直达入口
    if(microFix===0){
     microFix=1;
     // v1.2.67：菜单已判定不可用的店不再先耗一轮菜单，直接重跳目标页；菜单可用的店保持原顺序
     if(menuDead){
      this.phaseText='财务模块未挂载，重新直跳「'+tab+'」页链接…';
      const u=nextDirect();this.log('direct-load','micro-ladder '+u);
      await this.host.load(win,u);await wait(1800);continue;
     }
     this.phaseText='财务模块未挂载，按人工路径点菜单「财务 → 资金管理」再点页面「收支记录」…';
     if(await menuEnter()){await wait(4000);continue;}
     menuDead=true;
    }
    if(microFix===1){
     microFix=2;
     // v1.2.67：菜单已判定不可用 → 跳过菜单重试，直接进入换入口/重启外壳
     if(!menuDead){
      this.phaseText='财务模块未挂载，真实点击左侧菜单「财务 → 资金管理」重触发挂载…';
      if(await this.realMenuClick(win,'财务','资金管理')){await wait(4000);continue;}
     }
    }
    if(microFix===2){
     microFix=3;
     if(!menuDead){
      // v1.2.77（METRISH/龙文铭石 12:03/12:08 诊断包实锤：URL 已在 whale-accountant、侧栏「资金管理」
      // 高亮，但微应用 5 分钟不挂载（present:true loaded:false）、内容区空白）——旧梯子点了「总览」后
      // 立刻点回「资金管理」，从不给总览挂载机会。改为：点「总览」独立等最多 20 秒挂载，挂上就点
      // 页面「收支记录」进聚合结算账户（用户验证的可靠路径 总览→收支记录）；总览也挂不上才落回下一级
      this.phaseText='先点侧栏「总览」等它挂载（可靠路径：总览 → 页面「收支记录」）…';
      await this.realMenuClick(win,'财务','总览');
      const ovDeadline=Date.now()+(this.overviewWaitMs||20000);
      while(Date.now()<ovDeadline){
       this.check();
       let ost=null;try{ost=await this.inspectAll(win);}catch(e){}
       if(ost&&ost.micro&&ost.micro.loaded){
        this.phaseText='「总览」已挂载，点击页面「收支记录」进聚合结算账户…';
        if(await this.clickText(win,'收支记录')){await wait(1500);}
        break;
       }
       await wait(1000);
      }
      continue;
     }
    }
    if(microFix===3){
     microFix=4;
     this.phaseText='SPA 点击无效，回首页重启工作台外壳后重试…';
     await this.host.load(win,SHELL_HOME);await wait(1500);continue;
    }
    // v1.2.52：梯子循环——换入口后回到第 0 步重新尝试真实点击菜单（双 11 期间挂载
    // 时快时慢，单圈穷尽不代表死局；菜单点击是最接近用户手动操作的恢复手段）
    this.phaseText='财务模块仍未挂载，换入口重试…';
    microFix=0;
    const u=nextDirect();this.log('direct-load','micro-ladder '+u);
    await this.host.load(win,u);await wait(1500);continue;
   }
   if(st.micro&&st.micro.loaded)microWait=0;
   // 直达链接加载后又被弹回非资金页（qn.taobao.com 无独立会话时会跳回工作台首页），记录下来供报错诊断
   if(directTried&&!directBounced&&!onFund){directBounced=true;this.phaseText='直达链接被弹回，正在改走菜单入口打开「'+tab+'」页';}
   if(onFund){
    // 直达链接可能已落在目标页签：只要日期控件或数据行出来了就直接进入下一步，不必等页签文本
    if(tab==='月汇总'&&(st.row||st.empty||st.monthInputs.length)){await wait(300);return;}
    // v1.2.42：微前端已挂载、但页面里没有月/日汇总页签（停在「资金账户」总览）——用户截图指正：
    // 正确路径是点进「聚合结算账户」卡片（面包屑 资金管理 > 聚合结算账户 > 日汇总），里面才有
    // 收支明细/日汇总/月汇总 三页签；bill/summary「收支账单」是错页。先点「聚合结算账户」，
    // 点不进才轮换下一候选入口
    if(tab!=='收支明细'&&st.micro&&st.micro.loaded&&!st.record){
     staleRounds++;
     if(staleRounds>=3){
      staleRounds=0;
      // v1.2.56（用户截图实锤）：「聚合结算账户」在总览页只是卡片标题未必可点，
      // 真正的入口是卡片里的「收支记录」链接——人工就是点它进去的，先试它
      this.phaseText='「资金管理」总览没有「'+tab+'」页签，点击页面「收支记录」链接进聚合结算账户…';
      if(await this.clickText(win,'收支记录')){await wait(1500);navRound++;continue;}
      this.phaseText='点「聚合结算账户」进入结算账户视图…';
      if(await this.clickText(win,'聚合结算账户')){await wait(1200);navRound++;continue;}
      const entry=await probe('收支记录','财务');
      if(entry&&entry.clicked){await wait(1200);navRound++;continue;}
      const directR=loadUntried(entry&&entry.hrefs);
      if(directR){await this.host.load(win,directR);await wait(1000);navRound++;continue;}
      const entry2=await probe('聚合结算账户');
      if(entry2&&entry2.clicked){await wait(1200);navRound++;continue;}
      const direct=loadUntried(entry2&&entry2.hrefs);
      if(direct){await this.host.load(win,direct);await wait(1000);navRound++;continue;}
      if(entry2&&entry2.href&&/^https:/i.test(entry2.href)&&!triedHrefs.has(entry2.href)){triedHrefs.add(entry2.href);await this.host.load(win,entry2.href);await wait(800);navRound++;continue;}
      this.phaseText='「收支记录 / 聚合结算账户」入口都未找到，换下一个入口（收支账单 / 总览兜底）…';
      await this.host.load(win,nextDirect());await wait(1500);navRound++;continue;
     }
     await wait(800);continue;
    }
    staleRounds=0;
    // URL 已带目标 active 参数但控件未出：应用仍在渲染，等待即可，不要重复 load 或点菜单
    // v1.2.35：放宽为「路径一致即等」——新版 SPA 会把 ?active= 丢掉，按参数比对永远不成立
    const pathOf=u=>String(u||'').split(/[?#]/)[0];
    const activeMatch=directUrl&&pathOf(st.url)===pathOf(directUrl);
    if(activeMatch){await wait(700);continue;}
    // v1.2.29：URL 对但连续 4 轮（约 4 秒）控件仍没出，补一发直达重载给应用再次渲染的机会；
    // v1.2.34：重载改逐候选轮换（新域带参 → 新域裸 → 旧域）
    if(directUrl&&navRound%4===3){const u=nextDirect();this.log('direct-load','onFund-round '+u);await this.host.load(win,u);await wait(1500);navRound++;continue;}
    // 首选再补一发直达链接（诊断证实这是最可靠路径），点菜单只会跳到「资金账户」总览
    if(directUrl&&!triedHrefs.has(directUrl)){triedHrefs.add(directUrl);this.log('direct-load','onFund-first '+directUrl);await this.host.load(win,directUrl);await wait(1500);continue;}
    // 直达都用过仍未就绪才点「聚合结算账户」入口（旧版页面兜底）
    let advanced=false;
    for(const label of ['资金管理','聚合结算账户','收支账单','账户明细','收支记录']){
     if(await this.clickText(win,label)){await wait(800);advanced=true;break;}
     const r=await probe(label);
     if(r&&r.clicked){await wait(900);advanced=true;break;}
     const direct=loadUntried(r&&r.hrefs);
     if(direct){await this.host.load(win,direct);await wait(800);advanced=true;break;}
     if(r&&r.href&&/^https:/i.test(r.href)&&!triedHrefs.has(r.href)){triedHrefs.add(r.href);await this.host.load(win,r.href);await wait(600);advanced=true;break;}
    }
    if(!advanced)await wait(700);
    continue;
   }
   if(!st.loading){
    // v1.2.46：直跳资金路由前先确认外壳已启动（任意微应用挂载成功）。冷壳直跳会被弹回首页
    // 或永远挂不上（13:39-13:55 五包实锤）；外壳启动后直跳 1.5 秒即就位（13:40 诊断实测）。
    // 引导最多 25 秒，超时放弃引导按原流程直跳——兼容没有 icestark 微前端的旧版工作台
    if(!shellBooted){
     if(!bootDeadline){
      bootDeadline=Date.now()+(this.shellBootMs||25000);
      if(!/QnworkbenchHome/i.test(st.url||'')){
       this.phaseText='工作台外壳尚未启动，先打开首页完成初始化…';
       await this.host.load(win,SHELL_HOME);await wait(1500);navRound++;continue;
      }
      await wait(1000);continue;
     }
     if(Date.now()<bootDeadline){await wait(1000);continue;}
     shellBooted=true;
    }
    // v1.2.67（16:12 日志实锤）：部分店铺的侧栏「财务」浮层对合成 hover/点击**从不展开**
    // （menu-pointer 恒 opened:false，仅有的新元素是 y≈147/188 的常驻假目标），而每次菜单尝试
    // 要空转 30-60 秒。策略改为自适应：菜单首次失败即判定本次运行「菜单不可用」(menuDead)，
    // 后续不再重试菜单、直接走直达链接——菜单本来能用的店行为完全不变（仍是菜单优先）。
    // v1.2.48（用户 2026-11-06 明确反馈）：用户几乎每家都要手动点「财务 → 收支记录」才进得去，
    // 直达链接在新版工作台经常唤不起微应用（15:25/15:28 两包实锤：URL 对、外壳在、内容区空白）。
    // 结论：把用户验证过的手动路径提为**首选**——外壳启动后先真实点击「财务 → 收支记录」，
    // 点中就走人（SPA 内部导航百分百触发 icestark 挂载）；点不到才退回直达链接
    // v1.2.52：菜单首选允许多次重试（此前 menuEntryTried 一次性标记——第一次点空
    // （菜单未渲染好/子菜单未展开）就永不重试，只能等用户手动救，11-08 实锤这就是
    // 「只有个别店自己进去」的主因）。上限 4 次，用尽才退回直达链接
    if(shellBooted&&!menuDead&&menuTries<4){
     menuTries++;
     this.phaseText='按人工路径进入：菜单「财务 → 资金管理」→ 页面「收支记录」（第 '+menuTries+' 次）…';
     if(await menuEnter()){await wait(3000);navRound++;continue;}
     menuDead=true;
    }
    // 菜单判定不可用后不再空转菜单（上面的门控已跳过）；直达重试由下面的 navRound%3 周期节拍负责，
    // 不在循环顶部另加连发——否则会挤掉「收支记录」入口探测的时间预算（v1.2.67 回归用例 31 实锤）
    // 次选：直接 load 官方直达链接（用户提供，2026-11 实测有效），跳过整个菜单导航
    if(!directTried){
     directTried=true;
     if(directUrl){await this.host.load(win,directUrl);await wait(1500);continue;}
    }
    // 直达链接尚未被弹回时只等待（应用经 xdomain 桥渲染需要数秒），此时点菜单只会帮倒忙
    if(!directBounced){await wait(800);continue;}
    // 用户确认的可靠入口（2026-11-04）：卖家中心「财务→总览→支付宝账户卡片→收支记录」可直接进入
    // 聚合结算账户；被弹回后先找这个入口的链接/元素，比点「财务→资金管理」（落到资金账户总览）更准
    // v1.2.29：弹回也可能是子应用会话冷掉后的单次跳转——每次重新 load 直达链接都会重新走一遍
    // 子应用鉴权（16:03 诊断实锤：弹回后此前的循环只点菜单、从不重试直达，白白耗尽 60 秒），
    // 因此每 3 轮补一发直达链接重载，菜单点击只作穿插兜底
    if(directUrl&&navRound%3===2){
     this.phaseText='直达链接被弹回，正在重试直达（第 '+Math.floor(navRound/3+1)+' 次）';
     await this.host.load(win,nextDirect());await wait(1800);navRound++;continue;
    }
    // v1.2.44（用户 2026-11-06 批量下载实锤）：直达链接几乎家家被弹回新版天猫工作台首页，
    // 用户逐店手动点「财务 → 收支记录」救回整批——这是当前唯一验证可用的入口（旧入口
    // 「资金管理」在新版首页侧边栏不存在）。千牛侧边栏只认可信输入（合成 DOM 事件点不动），
    // 所以每轮先上真实鼠标：hover「财务」展开子菜单 → 依次找「收支记录」→「资金管理」，
    // 都点不中才退回合成探测（menuProbeScript 带 hover 兜底）
    if(!menuDead&&await menuEnter()){
     this.phaseText='已按人工路径点「资金管理/总览」→ 页面「收支记录」…';await wait(1800);navRound++;continue;
    }
    let jumped=false;
    for(const label of ['收支记录','资金管理','聚合结算账户','收支账单','账户明细']){
     const entry=await probe(label,(label==='收支记录'||label==='资金管理')?'财务':'');
     const direct=loadUntried(entry&&entry.hrefs);
     if(direct){await this.host.load(win,direct);await wait(1500);jumped=true;break;}
     if(entry&&entry.clicked){await wait(1200);jumped=true;break;}
     if(entry&&entry.href&&/^https:/i.test(entry.href)&&!triedHrefs.has(entry.href)){triedHrefs.add(entry.href);await this.host.load(win,entry.href);await wait(800);jumped=true;break;}
    }
    if(jumped)continue;
    // 交替两种菜单机制——偶数轮 hover「财务」展开，奇数轮直接找（复用上轮点击展开的状态）；
    // 菜单打不开时逐级再兜底：隐藏链接直跳 → 隐藏菜单项点击 → 点击「财务」入口
    const hoverRound=navRound%2===0;navRound++;
    const r=await probe('收支记录',hoverRound?'财务':'');
    if(r&&r.href&&/^https:/i.test(r.href)){await this.host.load(win,r.href);await wait(600);continue;}
    if(r&&r.clicked){await wait(1000);continue;}
    if(r&&r.candidates&&r.candidates.length)lastProbe=r.candidates.join('/');
    const direct=loadUntried(r.hrefs)||(r.hoverHref&&/^https:/i.test(r.hoverHref)&&!triedHrefs.has(r.hoverHref)?(triedHrefs.add(r.hoverHref),r.hoverHref):'');
    if(direct){await this.host.load(win,direct);await wait(800);continue;}
    if(hoverRound&&await this.clickText(win,'财务')){await wait(900);continue;}
   }
   await wait(800);
  }
  // v1.2.78：抛错前落一条全景日志——12:4x run 实锤 10 分钟零日志失败，抛错时把循环里
  // 走到哪一步（菜单试了几次/是否弹回/loading 卡没卡/authKick 触没触发）一次看全
  this.log('nav-fail',JSON.stringify({tab,url:String(lastUrl||'').slice(0,120),first:String(firstUrl||'').slice(0,120),loading:lastLoading,micro:lastMicro||null,bounced:directBounced,menuTries,menuDead,authKicked,stalls}));
  if(!lastProbe){try{const r=await probe('资金管理','财务');if(r&&r.candidates&&r.candidates.length)lastProbe=r.candidates.join('/');}catch(e){}}
  const microHint=lastMicro&&lastMicro.present&&!lastMicro.loaded?'；新版工作台财务模块（微前端）始终未挂载（外壳菜单在、内容区空白）——多为官方页面加载慢或异常，请稍等两分钟重试一次，或在官方窗口手动点开「财务 → 资金管理」后再点抓取':'';
  // v1.2.42：正确路径是「资金管理 → 聚合结算账户」（用户截图 16:51 指正），「收支账单」是错页
  const pageHint=/whale-accountant\/pay\/capital/i.test(lastUrl||'')?'；当前停在「资金管理」总览（只有「资金账户」页签）——请在官方窗口手动点一下页面里的「聚合结算账户」卡片确认能进（面包屑：资金管理 > 聚合结算账户），里面才有 月汇总/日汇总 页签，能进后再点抓取':'';
  throw Error('未能打开「'+tab+'」页（已尝试直达链接多次重载、真实点击与菜单导航'+(directBounced?'；直达链接反复重试仍被弹回工作台首页，该店铺的财务子应用会话可能已失效——请在官方窗口手动点一次左侧菜单「财务 → 收支记录」，再点页面里的「聚合结算账户」，能打开后再点抓取；若手动也进不去，请到店铺列表点「重新登录」':'')+microHint+pageHint+'），页面停留在：'+(lastBody.slice(0,120)||'空白')+'…（地址：'+(lastUrl||'未知')+(lastUrls&&lastUrls!==lastUrl?'；全部区域：'+lastUrls.slice(0,260):'')+(lastProbe?'；菜单关键词：'+lastProbe:'')+'），请补查');
 }
 async fillMonth(win,month){
  const start=month+'-01',end=monthEnd(month);
  let last=null;
  // v1.2.30：打开页签后应用渲染日期控件需要数秒（批量抓取实测「可见输入框 0 个」秒败），
  // 改为 20 秒轮询重试，控件一出现就填；不再一锤子买卖
  const deadline=Date.now()+20000;
  while(Date.now()<deadline){
   this.check();this.host.assertWindow(win);
   // 日期控件可能在 iframe 里：逐个 frame 尝试填写，成功即点查询
   for(const frame of this.framesOf(win)){
    let set;try{set=await this.host.execute(win,'('+fillMonthScript.toString()+')('+JSON.stringify(start)+','+JSON.stringify(end)+')',true,frame);}catch(e){continue;}
    if(set&&set.ok){
     for(const label of ['搜索','查 询','查询'])if(await this.clickText(win,label))break;
     return set;
    }
    if(set)last=set;
   }
   this.phaseText='等待入账日期控件渲染（'+month+'）…';
   await wait(1500);
  }
  throw Error('入账日期控件无法自动填写：'+((last&&last.reason)||(last&&last.values?'当前控件值 '+last.values.join(' ~ '):'20 秒内始终未见日期控件（应用可能没渲染完或被弹回工作台首页）'))+'，请补查');
 }
 // 按完整日期区间查询（日汇总页用）：控件是 YYYY-MM-DD 区间，dayFirst=true 让它先按日期写
 async fillDates(win,start,end){
  let last=null;
  // 回读所有 frame 里可见的日期输入值，验证填写是否真的生效
  const readVals=async()=>{
   for(const frame of this.framesOf(win)){
    try{
     const r=await this.host.execute(win,'(()=>{const vis=e=>!!e&&e.getClientRects().length>0;const vs=[...document.querySelectorAll("input")].filter(vis).map(e=>e.value).filter(v=>/^\\d{4}-\\d{2}-\\d{2}$/.test(v||""));return vs.slice(0,4);})()',false,frame);
     if(r&&r.length)return r.map(String);
    }catch(e){}
   }
   return [];
  };
 // v1.2.32：官方控件会拒绝未来日期——填 11-01~11-30 后被重置回默认区间（18:05 诊断实锤，
 // 截图里入账日期回到 10-04~11-04 且「导出记录」为空=导出从未排队）。点完搜索必须回读验证
 const deadline=Date.now()+(this.fillTimeoutMs||20000);let attempt=0,searched=false;
 while(Date.now()<deadline){
  this.check();this.host.assertWindow(win);
  for(const frame of this.framesOf(win)){
   // 第一轮用纯 native setter 写值；被官方控件重置过一次后，改用「写值+Enter 确认」变体
   let set;try{set=await this.host.execute(win,'('+fillMonthScript.toString()+')('+JSON.stringify(start)+','+JSON.stringify(end)+',true,'+(attempt>0)+')',true,frame);}catch(e){continue;}
   if(set&&set.ok){
    for(const label of ['搜索','查 询','查询'])if(await this.clickText(win,label)){searched=true;break;}
    await wait(1200);
    const vals=await readVals();
    // 回读不到日期输入（页面结构变化）：保持旧行为，按填写成功处理
    if(!vals.length)return {...set,searched};
    // v1.2.36：校验收紧到「完整日期精确匹配」；v1.2.43 再修一处假阳性——当月 end=今天 与官方
    // 默认区间的结束日期（今天）相同，旧判定 some(start||end) 会把「被重置回默认区间」误判为成功
    //（腾乐健 11-06 诊断实锤：控件显示 10-06~11-06 却放行了）。改为必须「起始日期」精确命中
    if(vals.some(v=>{const n=String(v).replace(/\D/g,'');return n===start.replace(/\D/g,'');}))return {...set,searched};
    last={reason:'填写后的值没有生效（回读到 '+vals.join(' ~ ')+'，期望 '+start+' ~ '+end+'）——官方控件拒绝了自动填写'};
    break;
   }
   if(set)last=set;
  }
  this.phaseText='等待日期区间控件渲染并确认生效（'+start+' ~ '+end+'）…';
  attempt++;
  await wait(1500);
 }
 throw Error('日期区间控件无法自动填写（'+start+' ~ '+end+'）'+(searched?'（已点过搜索，页面停在当前区间）':'')+':'+((last&&last.reason)||(last&&last.values?'当前控件值 '+last.values.join(' ~ '):'20 秒内始终未见日期控件（应用可能没渲染完或被弹回工作台首页）'))+'，请补查');
}
 // 日汇总累加成月：官方月汇总只在整月结束后出账（用户 2026-11 确认），当月只能靠日汇总累加
 // v1.2.61：day 传 'YYYY-MM-DD' 时只查这一天（每日计划的 T-1 单日口径），期末余额即该日余额
 async queryDaily(win,shop,month,day){
  const maxEnd=monthEnd(month),today=nowDate();
  // 单日模式：区间=该日；否则当月只查到今天，跨月历史月份查到月末
  const end=day||(month===nowMonth()&&today<maxEnd?today:maxEnd);
  const start=day||(month+'-01');
  this.phaseText='正在读取 '+shop.name+' '+month+' 日汇总（'+start+' ~ '+end+'）并累加';
  // v1.2.43：填日期失败不再整店判死——官方默认区间（上月同日~今天）必然覆盖当月，
  // 带着当前区间继续读即可（读不到再由 readDaily 报出看到的月份）；历史月则把填写失败并入最终报错
  let fillNote='',searched=false;
  try{const r=await this.fillDates(win,start,end);searched=!!(r&&r.searched);}
  catch(error){fillNote='日期自动填写未生效（'+String(error.message||'').replace(/[，].*/,'')+'）';}
  return await this.readDaily(win,month,{fillNote,searched,day});
 }
 async readRow(win,month){
  const yyyymm=month.replace('-',''),deadline=Date.now()+(this.rowTimeoutMs||ROW_TIMEOUT_MS);let prior=null,stable=0,st=null,recover=0,stableNone=0;
  while(Date.now()<deadline){
   this.check();this.host.assertWindow(win);
   st=await this.inspectAll(win);
   if(st.error)throw Error(st.error);
   // 页签守卫（2026-11-04 12:17 诊断包实锤）：填完日期触发查询后，官方应用可能自行跳走
   // （主 frame 被带去下载账单文件，再落回「日汇总」页签），此时永远等不到月汇总结果行——
   // 先点「月汇总」页签拉回；拉不回就用直达链接重进并重新填日期重查（最多 3 次，防止打转）。
   // 仅在「已到资金应用域名但不在月汇总 active 且无结果行」时触发，避免误伤其他页面状态
   const u=String(st.url||'');
   const allRows=st.rows&&st.rows.length?st.rows:(st.row?[st.row]:[]);
   if(!allRows.length&&!st.empty&&/whale-accountant|active=fund_(day|detail)/i.test(u)&&!/active=fund_month/i.test(u)&&recover<3){
    recover++;
    if(await this.clickText(win,'月汇总')){await wait(800);continue;}
    await this.host.load(win,fundUrlCandidates('月汇总')[0]);await wait(1500);
    await this.fillMonth(win,month);
    continue;
   }
   if(allRows.length){
    // 表格可能是月份区间查询（默认区间跨 2 个月）：按行首 6 位年月挑目标行，稳定 2 次才采
    const target=allRows.find(cells=>cells[0]===yyyymm);
    if(target){
     stableNone=0;
     const key=JSON.stringify([target,st.head]);stable=key===prior?stable+1:0;prior=key;
     if(stable>=2)return parseSummaryRow(st.head||[],target);
    }else{
     prior=null;stable=0;
     // 连续多轮有行但都不是目标月：区间没覆盖或该月未出账，报清楚见到的月份
     const seenMonths=allRows.map(c=>c[0]).join('、');
     if(++stableNone>=4)throw Error('月汇总表没有 '+yyyymm+' 行（查询到 '+seenMonths+'；若该月尚未结束，官方次月 2 日后才出全账），请补查');
    }
   }else{prior=null;stable=0;
    if(st.empty&&st.monthInputs.some(i=>String(i.value||'').startsWith(month)))return {month:yyyymm,incomeCount:0,incomeCents:0,expenseCount:0,expenseCents:0,balanceCents:null,detailCount:0,readable:true,empty:true};
   }
   await wait(450);
  }
  throw Error('未等到 '+month+' 的月汇总数据（页面未见结果行'+(st.empty?'，页面提示暂无数据':'')+(st.tabs&&!st.tabs.month?'，未见「月汇总」页签':'')+'；地址：'+(st.url||'未知')+'；页面：'+String(st.body||'').slice(0,100)+'），请补查');
 }
  // 翻页：点「下一页」，返回是否翻成功（已到末页返回 false）
 async turnPage(win){
  try{
   const r=await this.host.execute(win,'('+nextPageScript.toString()+')()',true);
   return r===1||r===true;
  }catch(e){return false;}
 }
 // 逐页读日汇总并按月累加：收入/支出金额与笔数求和，期末余额取当月最后一天
 // opts.searched：fillDates 是否点过「搜索」；opts.fillNote：日期填写失败的备注
 async readDaily(win,month,opts={}){
  const yyyymm=month.replace('-','');
  const deadline=Date.now()+(this.rowTimeoutMs||ROW_TIMEOUT_MS)*2;
  const map=new Map();let st=null,prior=null,pages=0,emptyRounds=0;
  while(Date.now()<deadline){
   this.check();this.host.assertWindow(win);
   st=await this.inspectAll(win);
   if(st.error)throw Error(st.error);
   this.phaseText='正在读取日汇总 '+yyyymm.slice(0,4)+'-'+yyyymm.slice(4)+' 第 '+(pages+1)+' 页并累加（已累计 '+map.size+' 天）';
   // v1.2.43：已点过搜索且页面持续显示空态（「没有数据」等）——这是官方查询的真实结果，
   // 返回「该月无数据」而不是傻等 60 秒后报失败（腾乐健 11-06 诊断实锤）
   if(opts.searched&&st.empty&&!(st.rowsDay&&st.rowsDay.length)){
    if(++emptyRounds>=10){
     return {month:yyyymm,incomeCount:0,incomeCents:0,expenseCount:0,expenseCents:0,balanceCents:null,detailCount:0,readable:true,empty:true,source:'日汇总',days:0,pages:1,note:'官方日汇总在查询区间内显示没有数据'+(opts.fillNote?'；'+opts.fillNote:'')+'——若该店应有流水，请在官方窗口人工核对该店铺的「聚合结算账户」'};
    }
    await wait(450);continue;
   }
   // 日汇总行首可能是 2026-11-03 / 20261103 / 11-03：归一成 YYYYMMDD 做键，只保留目标月
   // v1.2.61：单日模式只保留指定那一天
   const dayKey=c=>{const n=String(c[0]||'').replace(/\D/g,'');if(n.length===8)return n;if(n.length===4)return yyyymm+n;return '';};
   const dayFilter=opts.day?c=>dayKey(c)===opts.day.replace(/\D/g,''):c=>dayKey(c).startsWith(yyyymm);
   const days=(st.rowsDay||[]).filter(dayFilter);
   if(!days.length){await wait(450);continue;}
   const key=days.map(c=>c.join('|')).join('#');
   // 首见先等一轮，确认渲染稳定（避免读到加载中的半张表）
   if(key!==prior){prior=key;await wait(450);continue;}
   for(const c of days)map.set(dayKey(c),c);
   if(await this.turnPage(win)){pages++;prior=null;await wait(1500);continue;}
   break;
  }
  const rows=[...map.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(e=>e[1]);
  if(!rows.length)throw Error('日汇总没有 '+(opts.day||month)+' 的数据'+(opts.fillNote?'（'+opts.fillNote+'）':'')+'（页面：'+String((st&&st.body)||'').slice(0,80)+'），请补查');
  const head=(st&&st.head)||[];
  let incomeCents=0,expenseCents=0,incomeCount=0,expenseCount=0,detailCount=0,readable=true;
  for(const cells of rows){
   const p=parseSummaryRow(head,cells);
   if(p.incomeCents===null||p.expenseCents===null)readable=false;
   incomeCents+=p.incomeCents||0;expenseCents+=p.expenseCents||0;
   incomeCount+=p.incomeCount||0;expenseCount+=p.expenseCount||0;detailCount+=p.detailCount||0;
  }
  const last=parseSummaryRow(head,rows[rows.length-1]);
  return {month:yyyymm,incomeCount,incomeCents,expenseCount,expenseCents,balanceCents:last.balanceCents,detailCount,readable,source:opts.day?'日汇总':'日汇总累计',days:rows.length,pages:pages+1};
 }
// 抓取期间顺带记录导航事件（直达链接被弹回的重定向链都在这里）；只挂只读监听，不改窗口行为
 armNavTrace(win){
  try{
   const wc=this.host.assertWindow(win);
   if(!wc||win.__fundNavArmed)return;
   win.__fundNavArmed=true;win.__fundNavTrace=[];
   const rec=(type,detail)=>{const t=win.__fundNavTrace;if(t&&t.length<300)t.push({ms:Date.now(),type,detail:String(detail||'').slice(0,300)});};
   const on=(evt,fn)=>{try{wc.on(evt,fn);}catch(e){}};
   on('did-start-navigation',(e,url)=>rec('nav',url));
   on('did-redirect-navigation',(e,url)=>rec('redirect',url));
   on('did-fail-load',(e,code,desc,url)=>rec('fail',code+' '+desc+' '+url));
   // v1.2.77：采集官方页 console 报错（只收 warning/error，防刷屏挤掉导航事件）——
   // METRISH/龙文铭石实锤微应用 present 而不挂载、内容区空白，控制台报错是定位挂载失败根因的关键
   on('console-message',(...a)=>{
    const e=a[0]||{};const lvl=e.level!==undefined?e.level:a[1];const msg=e.message!==undefined?e.message:a[2];
    const src=e.sourceId!==undefined?e.sourceId:a[4];const line=e.lineNumber!==undefined?e.lineNumber:a[3];
    const n=Number(lvl);const isErr=Number.isFinite(n)?n>=2:/error|warn/i.test(String(lvl));
    if(isErr)rec('console',String(lvl)+' '+String(msg).slice(0,200)+' @'+String(src||'').slice(-60)+':'+(line||''));
   });
  }catch(e){}
 }
 // v1.2.50 二轮重试（用户 18:42-18:47 三诊断包+反馈）：一轮导航彻底失败（进不去日汇总/月汇总页），
 // 不再直接判死——彻底销毁官方窗口重开新窗，再完整跑一轮（等价于用户手动「关掉窗口重新登录点一遍」；
 // 登录态在 persist 分区里，新窗口通常免登录）。只有第二轮仍失败才落诊断包。
 // v1.2.51：官方页面在双 11 高峰期可能自行崩溃（渲染进程挂掉）→ 报「窗口已关闭」，同样销毁重开重试
 isNavFailure(error){return typeof error?.message==='string'&&/未能打开「|仍被弹回工作台首页|页面连续停滞|千牛窗口已关闭/.test(error.message);}
 async query(shop,month,day){
  try{return await this.queryOnce(shop,month,day);}
  catch(error){
   if(this.stopped||!this.isNavFailure(error))throw error;
   this.phaseText=shop.name+' 第一轮没能进入资金页，关闭窗口重开新窗，开始第二轮…';
   this.host.dropWindow(shop.id);
   await wait(1200);this.check();
   return await this.queryOnce(shop,month,day);
  }
 }
 async queryOnce(shop,month,day){
  const win=this.host.window(shop);
  this.armWindowOpen(win);
  await this.authenticateGuarded(shop,win);
  // 资金页抓取时窗口置为可见：诊断包证实可见窗口下直达链接 1.5 秒内就绪，
  // 而后台隐藏窗口的渲染时序是此前多版导航失败的头号嫌疑；抓完由 host 统一释放窗口
  try{if(!win.isDestroyed()&&!win.isVisible())win.show();}catch(e){}
  this.armNavTrace(win);
  // 抓取期间也挂下载守卫：官方页偶发自发下载（账单文件），拦掉避免弹「另存为」卡住无人值守抓取
  this.armDownload(win);
  try{if(win.__fundNavTrace)win.__fundNavTrace.length=0;}catch(e){}
  if(this.manual)await this.waitManual(shop,win);
  // v1.2.61：单日模式（每日计划 T-1）——直接进日汇总页查指定一天，不碰月汇总
  if(day){
   await this.openRecordTab(win,'日汇总',shop);
   return await this.queryDaily(win,shop,month,day);
  }
  // 当月（未结束）没有月汇总账单：直接进日汇总页按天累加，省掉一轮必然为空等的月汇总查询
  const current=month===nowMonth();
  await this.openRecordTab(win,current?'日汇总':'月汇总',shop);
  if(current)return await this.queryDaily(win,shop,month);
  this.phaseText='正在读取 '+shop.name+' '+month+' 月汇总';
  await this.fillMonth(win,month);
  try{
   return await this.readRow(win,month);
  }catch(error){
   // 该月月汇总还没出（多为当月刚结束、官方次月 2 日才出整月账单）→ 回落日汇总累加，不让整家店判失败
   if(!/没有 \d{6} 行|未等到 |暂无数据/.test(error.message))throw error;
   await this.openRecordTab(win,'日汇总',shop);
   try{
    return await this.queryDaily(win,shop,month);
   }catch(error2){
    // 两条路都拿不到数：把两段原因都带出来，便于判断是「没出账」还是「页面没进对」
    throw Error(error.message+'；日汇总累加也失败：'+error2.message);
   }
  }
 }
 // 手动接管：等用户在弹出的官方窗口里自己点到 财务→资金管理→月汇总；
 // 只要识别到已经落在资金页（有日期控件或数据行）就自动放行，不必非点按钮
 async waitManual(shop,win){
  const key=shop.id,deadline=Date.now()+MANUAL_TIMEOUT_MS;
  this.manualPendingInfo={shopId:key,name:shop.name};
  try{
   while(Date.now()<deadline){
    this.check();
    if(this.manualSkipped.has(key))throw Error('已手动跳过该店铺，请稍后补查');
    if(this.manualConfirmed.has(key)){this.manualConfirmed.delete(key);return;}
    const st=await this.inspectAll(win).catch(()=>null);
    if(st&&(st.record||st.fundHome)&&(st.monthInputs.length||st.row||st.empty))return;
    this.phaseText='等待手动接管：'+shop.name+'（窗口里点到 财务→资金管理→月汇总）';
    await wait(1200);
   }
   throw Error('手动接管等待超时（15 分钟），请重新抓取');
  }finally{this.manualPendingInfo=null;}
 }
 confirmManual(shopId){
  if(shopId)this.manualConfirmed.add(shopId);
  else for(const s of this.host.data.shops)this.manualConfirmed.add(s.id);
  return this.state();
 }
 skipManual(shopId){
  if(shopId)this.manualSkipped.add(shopId);
  return this.state();
 }
 async start(input){
  if(this.busy||this.downloadBusy||this.diagnosing)throw Error('资金月汇总抓取、导出或诊断正在运行');
  if(this.host.busy||this.host.loginBusy||this.host.accountTransferBusy)throw Error('推广费查询或登录正在运行');
  if(this.host.writeFailure)throw Error('本机保存失败，已停止后续抓取');
  this.manual=!!input.manual;this.manualConfirmed.clear();this.manualSkipped.clear();this.failCaptures=0;this.failCapturedShops.clear();
  // v1.2.61：定时计划（每日计划）用——day 传 'YYYY-MM-DD' 时只抓这一天的日汇总（T-1 单日口径）
  const day=input.day||null;
  if(day&&!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('单日格式应为 YYYY-MM-DD：'+day);
  const months=monthRange(input.months),ids=[...new Set(input.shopIds||[])];
  if(!ids.length)throw Error('请勾选店铺');
  const shops=ids.map(id=>this.host.shop(id)).filter(s=>['taobao','tmall'].includes(s.platform||'taobao'));
  if(!shops.length)throw Error('资金月汇总仅支持淘宝/天猫账号，京东与抖音账号不参与');
  const runId=randomUUID(),rows=[];
  for(const s of shops)for(const m of months)rows.push({runId,shopId:s.id,shopName:s.name,platform:s.platform||'taobao',month:m,day,status:'queued',incomeCents:null,incomeCount:null,expenseCents:null,expenseCount:null,balanceCents:null,error:''});
  this.save({...this.data,results:[...this.data.results,...rows]});
  this.busy=true;this.stopped=false;this.lastError='';this.phaseText='准备抓取';
  // runSeq 守卫（v1.2.38）：备选抓取会强制重置锁后立刻开新一轮，若旧 run 这时才落定，
  // 它的 catch/finally 不得清掉新 run 的 busy/phaseText/lastError——否则新任务一开始就被判「空闲」
  const seq=(this.runSeq=(this.runSeq||0)+1);
  this.work=this.run(shops,months,runId,day).catch(error=>{if(seq===this.runSeq)this.lastError=error.message;}).finally(()=>{if(seq===this.runSeq){this.busy=false;this.phaseText='';}});
  // v1.2.80 抓取后自动批量下载明细（用户 11-10 要求：抓完不用手点「批量下载明细」）：
  // 只对整月口径的手动抓取生效（day 为空）——每日计划抓的是 T-1 单日，整月明细没意义还白等几分钟。
  // 挂在 work 链末尾是为了拿到 busy=false 之后的时机（download() 在 busy 时直接拒绝），
  // 并且下载异常不污染抓取结果（只落 batch-auto-fail 日志）
  if(this.autoDownload()&&!day){
   this.work=this.work.then(()=>{
    if(seq!==this.runSeq||this.stopped)return null;
    return this.downloadBatch({runId}).catch(error=>{this.log('batch-auto-fail',String(error&&error.message||error));return null;});
   });
  }
  return this.state();
 }
 // v1.2.38 备选抓取（用户反馈：抓完一次后「一键抓取所选」偶尔锁死，只能重开软件）：
 // 强制中止并重置本轮抓取/导出/诊断的锁与下载上下文，再按当前勾选重新抓取。
// 若上一轮真在运行，重置后它的下一个 check() 会中止并把行标成 paused——这是用户主动选择的强制行为
 restart(input){
  if(this.host.busy||this.host.loginBusy||this.host.accountTransferBusy)throw Error('推广费查询或登录正在运行，请等推广费页空闲后再备选抓取');
  this.stopped=true;
  this.busy=false;this.downloadBusy=false;this.diagnosing=false;this.downloadCtx=null;this.manualPendingInfo=null;this.phaseText='';
  return this.start(input);
 }
 async run(shops,months,runId,day){
  let next=0;
  const worker=async()=>{while(next<shops.length){if(this.stopped)return;const shop=shops[next++];
   await this.host.queryContext.run(shop.id,async()=>{
    this.activeQueries.set(shop.id,true);
    try{
     for(const month of months){
      if(this.stopped)return;
      const patch=value=>{this.check();this.save({...this.data,results:this.data.results.map(r=>r.runId===runId&&r.shopId===shop.id&&r.month===month&&(r.day||null)===(day||null)?{...r,...value,updatedAt:new Date().toISOString()}:r)});};
      patch({status:'running',shopName:this.host.shop(shop.id).name});
      try{
       const row=await this.query(shop,month,day);
       patch({status:'completed',incomeCents:row.incomeCents,incomeCount:row.incomeCount,expenseCents:row.expenseCents,expenseCount:row.expenseCount,balanceCents:row.balanceCents,detailCount:row.detailCount??null,source:row.source||'',days:row.days||0,note:row.note||'',error:row.empty?'该月无数据':''});
      }catch(error){
       if(this.stopped){try{patch({status:'paused',error:'已暂停'});}catch{}return;}
       let msg=/Object has been destroyed|Render frame was disposed/.test(error.message)?'该店铺的千牛窗口已关闭，请补查该店铺':error.message;
       // 抓取失败自动落诊断包（v1.2.15）：用户零额外操作，把桌面生成的文件夹发回即可定位导航问题；
       // 窗口已销毁的失败没有现场可采，跳过
       if(!/窗口已关闭|Object has been destroyed|Render frame was disposed/.test(msg)){
        try{
         const dir=await this.captureFailure(shop,error);
         if(dir)msg+='；已自动生成诊断包：'+dir+'（请把该文件夹发给 AI 定位）';
        }catch(e){}
       }
       patch({status:'failed',error:msg});
      }
     }
    }finally{
     this.activeQueries.delete(shop.id);
     // 抓取期间窗口是可见的（保证官方页正常渲染）；本店铺抓完立刻收回，避免窗口堆满屏幕，
     // 收回后由 host 按原规则释放窗口
     try{const finished=this.host.window(shop);if(finished&&!finished.isDestroyed()&&finished.isVisible())finished.hide();}catch(e){}
    }
   });
  }};
  const settled=await Promise.allSettled(Array.from({length:Math.min(this.runConcurrency||RUN_CONCURRENCY,shops.length)},()=>worker()));
  const failed=settled.find(r=>r.status==='rejected');if(failed)throw failed.reason;
  if(this.stopped)this.save({...this.data,results:this.data.results.map(r=>r.runId===runId&&['queued','running'].includes(r.status)?{...r,status:'paused',error:'已暂停'}:r)});
 }
 pause(){this.stopped=true;return this.state();}
 // —— 失败现场自动采集（v1.2.15）：抓取一失败就落盘诊断包，不再要求用户单独点「诊断导出」——
 // 只做只读采集（页面快照 + DOM + 截图 + 导航事件流），不导航、不等待人工，几秒内完成，不干扰并发抓取
 async captureFailure(shop,error,trigger){
  if(this.failCaptures>=FAIL_CAPTURE_LIMIT||this.failCapturedShops.has(shop.id))return '';
  let win=null;
  try{win=this.host.window(shop);this.host.assertWindow(win);}catch(e){return '';}
  const dir=path.join(this.desktop||this.downloads,'诗玛资金诊断_'+sanitizeName(shop.name)+'_'+new Date(Date.now()+28800000).toISOString().replace(/[:.]/g,'-').slice(0,19));
  try{fs.mkdirSync(dir,{recursive:true});}catch(e){return '';}
  const report={generatedAt:new Date().toISOString(),app:'诗玛财务AI工作台',trigger:trigger||'抓取失败自动采集',
   shop:{id:shop.id,name:shop.name,platform:shop.platform||'taobao'},
   error:String(error&&error.message||error).slice(0,600),
   events:(win&&win.__fundNavTrace||[]).slice(-300),frames:[]};
  // 每个页面区域的只读快照；全 frame 失败也不影响 JSON 落盘
  try{
   for(const frame of this.framesOf(win)){
    const st=await this.host.readPage(win,'('+diagnoseScript.toString()+')()',frame).catch(()=>null);
    const at=await this.host.readPage(win,'('+fundInspect.toString()+')()',frame).catch(()=>null);
    if(!st&&!at)continue;
    if(st)st.state=at?{fundHome:!!at.fundHome,onFundUrl:!!at.onFundUrl,micro:at.micro||null,record:!!at.record,row:!!at.row,monthInputs:(at.monthInputs||[]).length,error:at.error||''}:null;
    report.frames.push(st||{state:at});
   }
  }catch(e){report.framesError=e.message;}
  try{fs.writeFileSync(path.join(dir,'诊断.json'),JSON.stringify(report,null,2));}catch(e){return '';}
  // DOM 快照与截图尽力而为，任何一步失败不影响已落盘的 JSON
  let idx=0;
  try{
   for(const frame of this.framesOf(win)){
    idx++;
    const d=await this.host.readPage(win,'('+dumpHtmlScript.toString()+')('+200000+')',frame).catch(()=>null);
    if(d&&d.html){try{fs.writeFileSync(path.join(dir,'frame-'+idx+'.html'),'<!-- '+d.url+' -->\n'+d.html);}catch(e){}}
   }
  }catch(e){}
  try{
   const wc=this.host.assertWindow(win);
   const img=await wc.capturePage();
   if(img&&!img.isEmpty())fs.writeFileSync(path.join(dir,'页面截图.png'),img.toPNG());
  }catch(e){}
  this.failCaptures++;this.failCapturedShops.add(shop.id);
  return dir;
 }
 // —— 诊断：一次把「导航为什么失败」的全部现场落盘 ——
 // 采集内容：导航事件流（含重定向，能解释「直达链接被弹回」）+ CDP target 列表（跨进程 iframe 的地址）
 // + 分阶段页面快照 + 每个区域的真实 DOM + 截图。用户只需点一次，必要时在窗口里手动点两下菜单补一脚。
 async diagnose(shopId){
  if(this.busy||this.downloadBusy||this.diagnosing)throw Error('资金抓取、导出或诊断正在运行');
  if(this.host.busy||this.host.loginBusy||this.host.accountTransferBusy)throw Error('推广费查询或登录正在运行');
  const shop=this.host.shop(shopId);
  if(!['taobao','tmall'].includes(shop.platform||'taobao'))throw Error('诊断仅支持淘宝/天猫账号');
  this.diagnosing=true;this.stopped=false;this.lastError='';this.phaseText='正在采集诊断信息：'+shop.name;
  const started=Date.now(),events=[],listeners=[];
  const rec=(type,detail)=>{if(events.length<500)events.push({ms:Date.now()-started,type,detail:String(detail||'').slice(0,300)});};
  let win=null;
  try{
   win=this.host.window(shop);
   await this.authenticateGuarded(shop,win);
   const wc=this.host.assertWindow(win);
   // 诊断时窗口要可见：自动导航失败后，用户能在窗口里手动点两下补一脚
   try{if(!win.isDestroyed()&&!win.isVisible())win.show();}catch(e){}
   // ① 导航事件流：「直达链接被弹回」的真相都在这几条里
   const on=(evt,fn)=>{try{wc.on(evt,fn);listeners.push([evt,fn]);}catch(e){}};
   on('will-navigate',(e,url)=>rec('will-navigate',url));
   on('will-redirect',(e,url)=>rec('will-redirect',url));
   on('did-start-navigation',(e,url,isInPlace,isMainFrame)=>rec('did-start-navigation',(isMainFrame?'[main] ':'[sub] ')+url));
   on('did-redirect-navigation',(e,url,isInPlace,isMainFrame)=>rec('did-redirect-navigation',(isMainFrame?'[main] ':'[sub] ')+url));
   on('did-frame-navigate',(e,url,code,status,isMainFrame)=>rec('did-frame-navigate',(isMainFrame?'[main] ':'[sub] ')+url));
   on('did-fail-load',(e,code,desc,url)=>rec('did-fail-load',code+' '+desc+' '+url));
   const popups=[];
   // 记录菜单点击是否弹新窗口（诊断期间只记录地址，不真的放行新窗口）
   try{wc.setWindowOpenHandler(({url})=>{popups.push(url);rec('window-open',url);return {action:'deny'};});}catch(e){}
   // ② CDP target 枚举：跨进程 iframe（OOPIF）的地址只有协议层看得到，framesInSubtree 拿不到
   const cdpTargets=[];
   try{
    if(!wc.debugger.isAttached())wc.debugger.attach('1.3');
    const r=await wc.debugger.sendCommand('Target.getTargets');
    for(const t of (r&&r.targetInfos)||[])cdpTargets.push({type:t.type,url:String(t.url||'').slice(0,400),title:String(t.title||'').slice(0,80)});
   }catch(e){rec('cdp-error',e.message);}
   const snapAll=async label=>{
    const frames=[];
    for(const frame of this.framesOf(win)){
     const st=await this.host.readPage(win,'('+diagnoseScript.toString()+')()',frame).catch(()=>null);
     const at=await this.host.readPage(win,'('+fundInspect.toString()+')()',frame).catch(()=>null);
     if(st){st.state=at?{fundHome:!!at.fundHome,onFundUrl:!!at.onFundUrl,micro:at.micro||null,record:!!at.record,row:!!at.row,monthInputs:(at.monthInputs||[]).length,error:at.error||''}:null;frames.push(st);}
    }
    return {label,at:new Date().toISOString(),frames};
   };
   const report={generatedAt:new Date().toISOString(),app:'诗玛财务AI工作台',shop:{id:shop.id,name:shop.name,platform:shop.platform||'taobao'},stages:[],events,popups,cdpTargets};
   report.stages.push(await snapAll('① 登录后初始页面'));
   // 阶段二：直达链接（跳过菜单）——成功失败都看，重定向链会记进 events
   try{await this.host.load(win,fundUrlCandidates('月汇总')[0]);}catch(e){rec('direct-load-error',e.message);}
   await wait(1500);
   report.stages.push(await snapAll('② 直达月汇总链接后 1.5 秒'));
   // 阶段三：真实鼠标（isTrusted）点「财务」，再找子菜单「资金管理」并真实点击
   const clickInfo={hover:false,hit:false};
   try{
    const r=await this.host.readPage(win,'('+menuRectScript.toString()+')('+JSON.stringify('财务')+','+JSON.stringify('资金管理')+')');
    clickInfo.rect=r;
    if(r&&r.hover){
     await this.mouse(win,'mouseMove',r.hover.x,r.hover.y);await wait(250);
     await this.mouse(win,'mouseDown',r.hover.x,r.hover.y);await this.mouse(win,'mouseUp',r.hover.x,r.hover.y);
     clickInfo.hover=true;
    }
    await wait(1200);
    const after=await this.host.readPage(win,'('+menuRectScript.toString()+')('+JSON.stringify('财务')+','+JSON.stringify('资金管理')+')').catch(()=>null);
    clickInfo.after=after;
    if(after&&after.hit){await this.mouse(win,'mouseDown',after.hit.x,after.hit.y);await this.mouse(win,'mouseUp',after.hit.x,after.hit.y);clickInfo.hit=true;}
   }catch(e){clickInfo.error=e.message;}
   report.click=clickInfo;
   await wait(1500);
   report.stages.push(await snapAll('③ 真实点击「财务」后 3 秒'));
   // 阶段四：等用户在可见窗口里手动点到月汇总页（默认最多 120 秒，测试可置 0），一识别到就立即记录
   let reached=null;
   const waitMs=Number.isFinite(this.diagnoseWaitMs)?this.diagnoseWaitMs:120000;
   const deadline=Date.now()+waitMs;
   while(Date.now()<deadline){
    if(this.stopped)break;
    const st=await this.inspectAll(win).catch(()=>null);
    if(st&&(st.record||(st.onFundUrl&&((st.monthInputs||[]).length||st.row)))){reached={url:st.url,record:!!st.record,monthInputs:(st.monthInputs||[]).length,row:!!st.row};break;}
    this.phaseText='诊断：若窗口还没到月汇总页，请手动点「财务 → 资金管理 → 月汇总」（最多再等 '+Math.max(0,Math.round((deadline-Date.now())/1000))+' 秒）';
    await wait(2500);
   }
   report.manual={reached,elapsedMs:Date.now()-started};
   report.stages.push(await snapAll(reached?'④ 已识别到月汇总页':'④ 结束时的页面'));
   const dir=path.join(this.desktop||this.downloads,'诗玛资金诊断_'+new Date(Date.now()+28800000).toISOString().replace(/[:.]/g,'-').slice(0,19));
   fs.mkdirSync(dir,{recursive:true});
   // ③ 真实 DOM 快照：每个页面区域一份精简 HTML（去掉脚本/样式，shadow root 内容附在末尾）
   const htmlFiles=[];let idx=0;
   for(const frame of this.framesOf(win)){
    idx++;
    const d=await this.host.readPage(win,'('+dumpHtmlScript.toString()+')('+200000+')',frame).catch(()=>null);
    if(!d||!d.html)continue;
    const name='frame-'+idx+'.html';
    try{fs.writeFileSync(path.join(dir,name),'<!-- '+d.url+' -->\n'+d.html);htmlFiles.push({file:name,url:d.url,bytes:d.length,truncated:!!d.truncated});}catch(e){}
   }
   report.htmlFiles=htmlFiles;
   const file=path.join(dir,'诊断.json');
   fs.writeFileSync(file,JSON.stringify(report,null,2));
   const shot=path.join(dir,'页面截图.png');
   let shotOk=false;
   try{const img=await wc.capturePage();if(img&&!img.isEmpty()){fs.writeFileSync(shot,img.toPNG());shotOk=true;}}catch(e){}
   try{
    fs.writeFileSync(path.join(dir,'说明.txt'),[
     '诗玛财务AI工作台 · 资金页导航诊断包',
     '生成时间：'+new Date(Date.now()+28800000).toISOString().replace('T',' ').slice(0,19),
     '店铺：'+shop.name,
     '',
     '诊断.json    主报告：各阶段页面快照、导航事件流（含重定向）、CDP target 列表、菜单元素坐标',
     '页面截图.png  诊断结束时的窗口画面',
     'frame-*.html  每个页面区域（含 iframe）的精简 DOM',
     '',
     '是否识别到月汇总页：'+(reached?'是 · '+reached.url:'否'),
     '提示：整个文件夹发回即可定位；文件太大时只发 诊断.json 也可以。',
    ].join('\r\n'));
   }catch(e){}
   return {dir,file,screenshot:shotOk?shot:'',popups:popups.length,reached:!!reached,url:reached?reached.url:'',stages:report.stages.length,frames:report.stages[0].frames.length,htmlFiles:htmlFiles.length,events:events.length,targets:cdpTargets.length};
  }finally{
   for(const [evt,fn] of listeners){try{if(win&&!win.isDestroyed())win.webContents.removeListener(evt,fn);}catch(e){}}
   // 诊断覆盖了窗口的 window-open 处理：销毁窗口避免影响后续抓取（登录态在持久分区，不受影响）
   try{if(win&&!win.isDestroyed())win.destroy();}catch(e){}
   this.diagnosing=false;this.phaseText='';
  }
 }
 // —— 导出：日汇总 / 收支明细 ——
 // 逐 frame 探测账单文件直链；官方弹窗绕开下载管理器时这是唯一的自动取文件途径
 async probeFileUrl(win){
  for(const frame of this.framesOf(win)){
   try{
    const urls=await this.host.execute(win,'('+fileUrlProbeScript.toString()+')()',true,frame);
    if(Array.isArray(urls)&&urls.length)return urls[0];
   }catch(e){}
  }
  return '';
 }
 // 主进程直接下载 OSS 预签名文件到导出文件夹（免登录、链接自带签名）
 // v1.2.55：加固——先写 .part 再改名（避免中途失败留下 0 字节「假文件」，这正是用户说的
 // 「明细时有时无」的一种形态）；校验 HTTP 状态与落地字节数；失败自动重试一次
 async fetchToFile(url,dest){
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  let last=null;
  for(let attempt=0;attempt<2;attempt++){
   try{return await this.fetchOnce(url,dest);}
   catch(err){
    last=err;this.log('fetch-fail','第'+(attempt+1)+'次 '+path.basename(dest)+' | '+err.message);
    if(attempt===0){await wait(1500);this.check();}
   }
  }
  throw last;
 }
 fetchOnce(url,dest){
  return new Promise((resolve,reject)=>{
   const part=dest+'.part';
   let settled=false,req=null,out=null,timer=null;
   const cleanup=()=>{clearTimeout(timer);try{out&&!out.destroyed&&out.destroy();}catch(e){}try{req&&req.abort();}catch(e){}try{if(fs.existsSync(part))fs.unlinkSync(part);}catch(e){}};
   const fail=err=>{if(settled)return;settled=true;cleanup();reject(err);};
   const ok=()=>{
    if(settled)return;settled=true;clearTimeout(timer);
    let size=0;try{size=fs.statSync(part).size;}catch(e){}
    if(!size){return fail(Error('账单文件下载失败：服务器返回 0 字节'));}
    try{fs.renameSync(part,dest);}catch(e){return fail(Error('账单文件保存失败：'+e.message));}
    resolve(dest);
   };
   try{
    timer=setTimeout(()=>fail(Error('账单文件下载超时（90 秒）')),90000);
    req=net.request(url);
    req.setHeader('User-Agent','Mozilla/5.0 (Windows NT 10.0; Win64; x64) ShimaFinanceWorkbench');
    req.on('response',res=>{
     if(res.statusCode!==200){try{res.resume&&res.resume();}catch(e){}return fail(Error('账单文件下载失败：HTTP '+res.statusCode));}
     out=fs.createWriteStream(part);
     out.on('finish',ok);out.on('error',err=>fail(Error('账单文件写入失败：'+err.message)));
     try{res.pipe(out);}catch(e){fail(e);}
    });
    req.on('error',err=>fail(err));
    req.on('abort',()=>fail(Error('账单文件下载被中止')));
    req.end();
   }catch(e){fail(e);}
  });
 }
 // 新版工作台（2026-11-05 诊断实锤）：财务子菜单 36 处 target=_blank——点菜单会请求开新窗口，
 // 无 handler 时主窗口毫无反应（这正是「菜单点了没反应」的根因）；
 // 把站内链接的建窗请求转回本窗口加载，其余 deny 掉防失控弹窗
 armWindowOpen(win){
  const wc=win&&win.webContents;if(!wc||wc.__shimaFundOpen)return;
  try{
   wc.__shimaFundOpen=true;
   wc.setWindowOpenHandler(({url})=>{
    try{
     if(!url||!/^https:/i.test(url))return {action:'deny'};
     // 行级「下载明细」有时走 window.open(OSS 直链)：这里只记录，交给 downloadDailyRows 代下
     if(/aliyuncs\.com\/|taobao-finance\.oss/i.test(url)&&/fund\/bill/i.test(url)){
      (wc.__shimaOssHits=wc.__shimaOssHits||[]).push(url);
      return {action:'deny'};
     }
     // v1.2.55（主进程 native 崩溃修复）：此前在 window-open 回调里**同步** wc.loadURL(url)，
     // 是在 Chromium 正在处理建窗请求时重入导航管道——官方菜单 36 处 target=_blank，
     // 点一次菜单就是一次重入，正是「点批量下载闪退」与「点了菜单停在首页不动」的共同现场。
     // 改为下一轮事件循环再导航，并做存活检查。
     if(/taobao\.com|tmall\.com/i.test(url))setImmediate(()=>{try{if(wc.isDestroyed&&wc.isDestroyed())return;wc.loadURL(url);}catch(e){}});
    }catch(e){}
    return {action:'deny'};
   });
  }catch(e){}
 }
 armDownload(win){
  let ses=null;try{ses=win&&win.webContents&&win.webContents.session;}catch(e){return;}
  if(!ses)return;
  // v1.2.53：session 是持久分区共享的（dropWindow 销毁窗口重建后 session 不变）——
  // handler 已装过时必须更新「当前任务窗口」记录，否则旧 handler 闭包里的旧 win
  // 会让新窗口的下载被 `ctx.win!==win` 判负而全部 preventDefault 吞掉
  //（12:55 vldoliya 包实锤：逐行点击三次、每行 45 秒超时、零文件）
  if(ses.__shimaFundDownload){ses.__shimaFundWin=win;return;}
  ses.__shimaFundDownload=true;ses.__shimaFundWin=win;
  ses.on('will-download',(event,item)=>{
   const ctx=this.downloadCtx;
   // 抓取/读取期间官方页面偶发自行触发下载（诊断实锤：查询后主 frame 被带去下载账单文件），
   // 此时不设保存路径会弹「另存为」对话框卡住无人值守的抓取——直接取消；只有显式导出任务放行
   if(!ctx||ctx.win!==ses.__shimaFundWin){try{event.preventDefault();}catch(e){}return;}
   event.stopPropagation?.();
   ctx.started=true;
   const file=path.join(ctx.dir,ctx.prefix+'_'+item.getFilename());
   item.setSavePath(file);
   item.once('done',(e,state)=>{
    if(this.downloadCtx!==ctx)return;
    if(state!=='completed'){return;} // 单个分片失败不急停：整月导出按天/分片出多个文件，等静默期统一结算
    // 官方整月导出会出多个分片文件（2026-11-04 实测 _20261103_0 这类按日命名）：
    // 每收完一个就重置静默计时，连续无新文件才结算，避免只拿到第一个就宣告完成
    ctx.files.push(file);
    clearTimeout(ctx.idle);
    ctx.idle=setTimeout(()=>ctx.settle(),this.downloadIdleMs||DOWNLOAD_IDLE_MS);
   });
  });
 }
 // v1.2.53（12:55 vldoliya 包实锤）：行级「下载明细」的官方行为是**主窗口直接导航到 OSS 文件直链**
 //（taobao-finance.oss...aliyuncs.com/fund/bill/detail/...，三个包事件流逐行出现），不一定走
 // will-download（零文件实锤）。拦截该导航：立即 stop() 保住原页（跳走表格就没了），把直链记录
 // 交给主进程 net 代下。返回 {urls,off}，downloadDailyRows 每收一条直链产出一个当日文件
 armOssRedirect(win){
  const wc=win&&win.webContents;if(!wc)return {urls:[],off(){}};
  const urls=[];
  const isOss=u=>/aliyuncs\.com\/|taobao-finance\.oss/i.test(u)&&/fund\/bill/i.test(u);
  const push=u=>{const s=String(u||'');if(!s||!isOss(s))return false;if(!urls.includes(s))urls.push(s);return true;};
  // v1.2.55：will-navigate 在导航真正开始**之前**触发，可以 preventDefault 干净拦下（保页、无重入）；
  // 旧实现只在 did-start-navigation 里同步 wc.stop()——那是导航已开始后强行中断，属于重入操作，
  // 是主进程原生崩溃（Crashpad 0x80000003）的高危点
  const onWill=e=>{try{const u=e&&e.url||'';if(push(u))e.preventDefault();}catch(err){}};
  const onNav=(e,url)=>{try{
   const u=String(url||(e&&e.url)||'');
   if(isOss(u)){
    push(u);
    // 兜底：will-navigate 没触发（如服务端重定向）时，把 stop() 推到下一轮事件循环再执行
    setImmediate(()=>{try{if(wc.isDestroyed&&wc.isDestroyed())return;wc.stop();}catch(err){}});
   }
  }catch(err){}};
  try{wc.on('will-navigate',onWill);}catch(e){}
  try{wc.on('did-start-navigation',onNav);}catch(e){}
  return {
   urls,
   // window.open(OSS 直链) 命中时由 armWindowOpen 记在 wc 上，这里一并取走
   drain(){try{for(const u of (wc.__shimaOssHits||[]))push(u);wc.__shimaOssHits=[];}catch(e){}return urls;},
   off(){try{wc.removeListener('will-navigate',onWill);}catch(e){}try{wc.removeListener('did-start-navigation',onNav);}catch(e){}}
  };
 }
 waitForDownload(win,dir,prefix){
   const p=new Promise((resolve,reject)=>{
    const total=this.exportTimeoutMs||this.downloadTimeoutMs||EXPORT_TIMEOUT_MS;
    const timer=setTimeout(()=>{
     if(!this.downloadCtx)return;
     const ctx=this.downloadCtx;this.downloadCtx=null;clearTimeout(ctx.idle);
     // 超时但已收到部分分片：不判失败，把已拿到的文件交付出去
     ctx.files.length?ctx.resolve({files:ctx.files.slice()}):reject(Error('未捕获到导出文件下载：官方页面 '+Math.round(total/1000)+' 秒内没有开始传文件。已自动尝试填写区间、点搜索、点导出（含真实鼠标）与各弹窗按钮。请在官方窗口手动导出一次（选日期→搜索→导出→立即下载）：手动能下载说明官方流程变了他处，把诊断包发回即可定位差异'));
    },total);
    const ctx={win,dir,prefix,files:[],started:false,idle:null,timer,resolve,reject};
   // settle 需要访问实例状态：用闭包绑定
   ctx.settle=()=>{
    if(this.downloadCtx!==ctx)return;
    this.downloadCtx=null;clearTimeout(ctx.timer);clearTimeout(ctx.idle);
    ctx.resolve({files:ctx.files.slice()});
   };
   this.downloadCtx=ctx;
  });
  // 导出可能改走 OSS 直链代下（download() 里提前 return），这条 Promise 无人 await：
  // 预挂 no-op catch 防 unhandledRejection，不影响真正 await 方拿到结果
  p.catch(()=>{});
  return p;
 }
 // 收集当前页目标月各行（跨 frame 合并去重）
 async detailRows(win,yyyymm){
  const merged=[];
  for(const frame of this.framesOf(win)){
   let rows;try{rows=await this.host.execute(win,'('+detailRowsScript.toString()+')('+JSON.stringify(yyyymm)+')',false,frame);}catch(e){continue;}
   if(Array.isArray(rows))for(const r of rows)if(r&&r.date&&!merged.some(m=>m.date===r.date))merged.push(r);
  }
  return merged;
 }
 // 合成点击指定日期行的「下载明细」，返回坐标（真实鼠标兜底用）。
 // v1.2.53：表格可能渲染在子 frame 里——合成点击在 frame 内直接生效，但返回的坐标是
 // frame 视口坐标，真实鼠标需要补上该 frame 在主窗口里的偏移，否则点空
 async clickRowDetail(win,yyyymm,date){
  for(const frame of this.framesOf(win)){
   try{
    const r=await this.host.execute(win,'('+clickDetailScript.toString()+')('+JSON.stringify(yyyymm)+','+JSON.stringify(date)+')',true,frame);
    if(r&&r.ok){
     if(frame&&frame!==this.host.assertWindow(win).mainFrame){
      try{
       const off=await this.host.execute(win,'(()=>{try{const f=window.frameElement;if(!f)return null;const b=f.getBoundingClientRect();return {x:Math.round(b.left),y:Math.round(b.top)};}catch(e){return null;}})()',true,frame);
       if(off&&typeof off.x==='number'){r.x+=off.x;r.y+=off.y;}
      }catch(e){}
     }
     return r;
    }
    if(r&&r.reason)return {ok:false,reason:r.reason};
   }catch(e){}
  }
  return null;
 }
 // 真实鼠标按坐标点击（复用 realMenuClick 的发送方式）
 async realClickAt(win,x,y){
  if(typeof this.host.sendMouse!=='function')return false;
  try{
   await this.mouse(win,'mouseMove',x,y);await wait(120);
   await this.mouse(win,'mouseDown',x,y);await this.mouse(win,'mouseUp',x,y);
   return true;
  }catch(e){return false;}
 }
 // v1.2.37 行级下载明细（用户 2026-11-05 截图指正）：日汇总表格每行右侧有「下载明细」链接，
 // 逐行点击即下载该日流水文件——这才是拿明细的正路；右上角「导出」出的只是汇总文件
 //（13:23 诊断实锤合成点「导出」从未排队）。逐页处理：等本页行稳定 → 逐行点击等下载 → 翻页
 // v1.2.84 onlyDate（单日模式）：只处理指定日期那一行。防止 fillDates 被官方控件重置后
 // 表格回到默认区间（上月~本月），把整月行全下一遍——每日计划场景这是重复劳动。
 async downloadDailyRows(win,{shop,label,month,dir,prefix,onlyDate}){
  const yyyymm=month.replace('-','');
  const oldIdle=this.downloadIdleMs,oldTimeout=this.exportTimeoutMs;
  // 行级流程禁用 10 秒静默结算：行与行之间的等待绝不能把下载上下文提前收走；
  // 整体窗口按 15 分钟放宽（约 31 行 × 每行含重试的余量）
  this.downloadIdleMs=600000;this.exportTimeoutMs=900000;
  const skips=[],seen=new Set();let page=1,total=0,ossGot=0,dlGot=0,ossUsed=0;
  this.armDownload(win);
  const ossTrack=this.armOssRedirect(win);
  const pending=this.waitForDownload(win,dir,prefix);
  this.log('rows-start',shop.name+' '+label+' '+month+' → '+dir);
  try{
   for(;;){
    // 等本页目标月行渲染稳定（避免点到加载中的半张表）
    let rows=null,prior='',stable=0;
    const pageDeadline=Date.now()+(this.detailPageWaitMs||30000);
    while(Date.now()<pageDeadline){
     this.check();this.host.assertWindow(win);
     rows=await this.detailRows(win,yyyymm);
     const key=rows.map(r=>r.date).join(',');
     if(rows.length&&key===prior){if(++stable>=2)break;}
     else{stable=0;prior=key;}
     this.phaseText='正在读取'+label+'第 '+page+' 页的目标行（'+shop.name+'）…';
     await wait(900);
    }
    if(!rows||!rows.length)break;
    // v1.2.84：单日模式只保留目标日期那一行（官方控件重置日期时也绝不多下）
    if(onlyDate)rows=rows.filter(r=>r.date===onlyDate);
    if(!rows.length)break;
    for(let i=0;i<rows.length;i++){
     const d=rows[i].date;
     if(seen.has(d))continue;seen.add(d);total++;
     const show=d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6);
     this.phaseText='正在逐行下载明细 '+shop.name+' '+show+'（第 '+page+' 页 '+(i+1)+'/'+rows.length+' 行，累计 '+total+' 天）';
     const ctx=this.downloadCtx;const base=ctx?ctx.files.length:0;
     const hit=await this.clickRowDetail(win,yyyymm,d);
     this.log('row-click',show+' '+(hit?(hit.ok?'ok':'fail:'+(hit.reason||'')):'no-target'));
     if(!hit){skips.push({date:d,why:'定位不到该行的「下载明细」链接'});continue;}
     if(!hit.ok){skips.push({date:d,why:hit.reason||'「下载明细」链接点不动'});continue;}
     // 等该行文件收完（done 事件把文件 push 进 ctx.files）；期间接管官方下载弹窗按钮
     // v1.2.79 修复：ossUsed 必须跨行累计（提升到 run 作用域）——此前每行重置为 0，
     // urls[ossUsed++] 恒取 urls[0]=第一行的直链，导致每行落盘的文件内容全是第一天（14:08 run 实锤：
     // 每行 oss-hit 都拦到新直链，但 5 店 N 份文件 md5 全同=都在下第一行的文件）
     const rowDeadline=Date.now()+45000;let realTried=0,ok=false;
     while(Date.now()<rowDeadline){
      await wait(2000);this.check();this.host.assertWindow(win);
      // window.open(OSS 直链) 命中的链接在这里并入候选
      ossTrack.drain();
      // v1.2.53：官方行级下载=主窗口直接导航到 OSS 直链（不一定触发 will-download）——
      // 拦到直链就用 net 代下，产出与行级点击一一对应的当日文件
      if(ossTrack.urls.length>ossUsed){
       const u=ossTrack.urls[ossUsed++];
       const file=path.join(dir,prefix+'_'+d+'.xlsx');
       this.phaseText='已捕获「'+show+'」明细直链，正在下载…';
       this.log('oss-hit',show+' '+u.slice(0,120));
       try{
        await this.fetchToFile(u,file);
        const c=this.downloadCtx;
        if(c){c.files.push(file);c.started=true;clearTimeout(c.idle);c.idle=setTimeout(()=>c.settle(),this.downloadIdleMs||600000);}
        ok=true;ossGot++;break;
       }catch(err){this.log('oss-fail',show+' '+err.message);/* 直链下载失败：留在循环里继续等 will-download/弹窗路径 */}
      }
      const c=this.downloadCtx;
      if(!c)break; // 上下文已被收走（超时结算等异常）：不再继续点
      if(c.files.length>base){ok=true;dlGot++;break;}
      if(c.started)continue; // 该行文件正在传，继续等 done
      if(await this.clickText(win,'立即下载')||await this.clickText(win,'下 载')||await this.clickText(win,'下载'))continue;
      if(await this.clickText(win,'确 定')||await this.clickText(win,'确定'))continue;
      if(realTried<1){realTried++;await this.realClickAt(win,hit.x,hit.y);continue;}
     }
     if(!this.downloadCtx)break;
     if(!ok)skips.push({date:d,why:'已点「下载明细」，45 秒内没收到文件也没拦到直链'});
    }
    if(!this.downloadCtx)break;
    if(await this.turnPage(win)){page++;await wait(1800);}
    else break;
   }
   if(!total){
    // v1.2.55：没有任何目标月行时先看页面是不是「暂无数据」——用户口径：本身没数据的店铺不该算失败
    const st=await this.inspectAll(win).catch(()=>null);
    if(st&&st.empty){
     const c0=this.downloadCtx;if(c0){this.downloadCtx=null;clearTimeout(c0.timer);clearTimeout(c0.idle);}
     const scopeText=onlyDate?onlyDate.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')+' 当天':month+' 整月';
     this.log('rows-empty',shop.name+' '+month+' 页面显示暂无数据');
     return {files:[],note:label+'页显示暂无数据（'+scopeText+'没有流水），无需生成明细'};
    }
    throw Error(onlyDate
     ?label+'表没有 '+onlyDate.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')+' 的明细行：该日可能无流水，或日期区间被官方控件重置，请补查'
     :label+'表没有 '+month+' 的行可下载明细（请确认已按该月查询出数据），请补查');
   }
   const c=this.downloadCtx;
   if(c)c.settle();
  }catch(e){
   // 提前失败（如收不到目标月行）：清掉下载上下文计时器再抛，别让 15 分钟窗口吊住进程
   const c=this.downloadCtx;
   if(c){this.downloadCtx=null;clearTimeout(c.timer);clearTimeout(c.idle);}
   this.log('rows-error',shop.name+' '+month+' '+e.message);
   throw e;
  }finally{
   this.downloadIdleMs=oldIdle;this.exportTimeoutMs=oldTimeout;
   try{ossTrack.off();}catch(e){}
  }
  const done=await pending.catch(err=>{throw Error('逐行下载明细中断：'+err.message);});
  this.log('rows-done',shop.name+' '+month+' 行数='+total+' 文件='+done.files.length+' 直链='+ossGot+' 下载器='+dlGot+' 跳过='+skips.length);
  const note=[];
  if(skips.length)note.push('有 '+skips.length+' 天没拿到明细：'+skips.slice(0,12).map(s=>s.date.slice(4,6)+'-'+s.date.slice(6)+'（'+s.why+'）').join('、')+(skips.length>12?' 等':''));
  if(!done.files.length)throw Error('逐行下载明细没有拿到任何文件（共 '+total+' 行）'+(note.length?'：'+note[0]:'')+'。请在官方窗口手动点几行「下载明细」验证：手动能下载说明行级链接行为有变，把诊断包发回即可定位');
  return {files:done.files,note:note.join('；')};
 }
 // v1.2.80 抓取后自动下载开关（默认开）：存在 fund-summary.json，重启后保持用户选择
 autoDownload(){return this.data.autoDownload!==false;}
 setAutoDownload(on){
  if(this.busy||this.downloadBusy)throw Error('抓取或导出正在运行，结束后再改这个开关');
  this.save({...this.data,autoDownload:!!on});
  return this.state();
 }
 // v1.2.80 批量下载明细（主进程统一入口：UI 按钮与「抓取后自动下载」共用同一条逻辑）。
 // 顺序逐家调用 download()，单个店铺失败不影响后面；下载期间 phaseText 会显示当前进度，
 // 页面 1.2 秒轮询即可看到。中途「暂停」会让 download() 抛「已暂停」，这里收尾返回已完成部分。
 async downloadBatch({runId}={}){
  if(this.downloadBusy)throw Error('已有导出任务进行中，等它结束再批量下载');
  if(this.busy)throw Error('资金月汇总抓取正在运行：抓完会自动开始下载（可在设置里关掉自动下载）');
  const rid=runId||this.data.results.at(-1)?.runId||'';
  const jobs=batchJobs(this.data.results,{now:nowMonth(),runId:rid,done:this.batchDone});
  if(!jobs.length){
   const rows=this.data.results.filter(r=>r.runId===rid);
   return {jobs:0,ok:0,files:[],failures:[],notes:[],skipped:true,
    message:rows.length?'这一轮的结果已全部下载过（想要文件请重新抓取一次，或点结果行右侧的「下载明细」单家重下）':'还没有抓取结果：先点「一键抓取所选」'};
  }
  this.stopped=false;this.lastError='';
  const failures=[],notes=[],files=[];let ok=0,paused=false;
  this.log('batch-start',jobs.length+' 家 · run '+rid.slice(0,8)+(runId?'':'（最近一轮）'));
  try{
   for(let i=0;i<jobs.length;i++){
    const j=jobs[i];
    if(this.stopped){paused=true;break;}
    this.phaseText='批量下载明细 '+(i+1)+'/'+jobs.length+'：'+j.name+' '+j.month;
    this.log('batch-row',(i+1)+'/'+jobs.length+' '+j.name+' '+j.month+' '+j.kind);
    try{
     const r=await this.download({shopId:j.shopId,kind:j.kind,month:j.month});
     const list=(r&&r.files)||[];files.push(...list);ok++;
     this.batchDone.add(j.key);
     if(r&&r.note)notes.push(j.name+' '+j.month+'：'+r.note);
    }catch(error){
     const msg=String(error&&error.message||error);
     if(/已暂停|已中止/.test(msg)){paused=true;break;}
     failures.push(j.name+' '+j.month+'：'+msg.slice(0,160));
     this.log('batch-row-fail',j.name+' '+msg.slice(0,160));
    }
   }
  }finally{
   this.phaseText='';
   this.log('batch-done','成功 '+ok+'/'+jobs.length+' 家 · 文件 '+files.length+(paused?' · 已中止':'')+(failures.length?' · 失败 '+failures.length:''));
  }
  return {jobs:jobs.length,ok,files,failures,notes,paused:!!paused};
 }
 async download({shopId,kind,month}){
  if(this.downloadBusy)throw Error('已有导出任务进行中');
  if(this.busy)throw Error('资金月汇总抓取正在运行');
  if(this.host.busy||this.host.loginBusy||this.host.accountTransferBusy)throw Error('推广费查询或登录正在运行');
  const label=KINDS[kind];if(!label)throw Error('导出类型无效');
  // v1.2.49（用户 2026-11-06 口径）：月汇总是官方把**已结束整月**的日汇总打包出的总计，
  // 当月没满月根本不出账——当月点月汇总直接拒绝，引导走日汇总
  if(label==='月汇总'&&month&&month>=nowMonth())throw Error('「'+month+'」是当月或未来月份，官方月汇总要整月结束后才出账（次月 2 日出全），当月请用「日汇总」逐日下载');
  if(label==='月汇总'&&!month)throw Error('月汇总导出必须指定月份');
  const shop=this.host.shop(shopId);
  if(!['taobao','tmall'].includes(shop.platform||'taobao'))throw Error('资金导出仅支持淘宝/天猫账号');
  this.downloadBusy=true;this.stopped=false;this.phaseText='正在导出 '+shop.name+' '+label;this.lastError='';
  this.log('download-start',shop.name+' | '+label+' | '+(month||'-')+' | v'+(require('../package.json').version||''));
  try{
   try{return await this.downloadRun(shop,label,month);}
   catch(error){
    // v1.2.50 二轮重试：首轮导航失败（进不去日汇总/月汇总/收支明细页）→ 销毁窗口重开再完整跑一轮
    if(this.stopped||!this.isNavFailure(error))throw error;
    this.log('download-round2',shop.name+' 首轮失败：'+error.message);
    this.phaseText=shop.name+' 第一轮没能进入「'+label+'」页，关闭窗口重开新窗，开始第二轮…';
    this.host.dropWindow(shop.id);
    await wait(1200);this.check();
    return await this.downloadRun(shop,label,month);
   }
  }catch(error){
   this.lastError=error.message;
   this.log('download-fail',shop.name+' | '+error.message);
   // 导出失败也自动落诊断包（v1.2.24）：弹窗结构、生成进度、直链是否出现都要第一手现场；
   // 二轮重试后仍失败才走到这里，第一轮的失败不留包（避免同因重复诊断包）
   try{
    const dir=await this.captureFailure(shop,error,'导出失败自动采集');
    if(dir)this.lastError=error.message+'；已自动生成诊断包：'+dir+'（请把该文件夹发给 AI 定位）';
   }catch(e){}
   throw error;
  }
  finally{
   this.downloadBusy=false;this.phaseText='';
  }
 }
 // v1.2.84 单日明细下载（每日计划跑完后自动调，也可单独触发）：日汇总页按 date~date 查询，
 // 只下该日一行的行级「下载明细」。与整月批量下载的区别：区间填单日 + onlyDate 锁死目标行，
 // 官方控件重置日期时宁可报错也不会把整月重下一遍。
 async downloadDay({shopId,date}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))throw Error('日期格式应为 YYYY-MM-DD');
  if(this.downloadBusy)throw Error('已有导出任务进行中');
  if(this.busy)throw Error('资金月汇总抓取正在运行');
  if(this.host.busy||this.host.loginBusy||this.host.accountTransferBusy)throw Error('推广费查询或登录正在运行');
  const shop=this.host.shop(shopId);
  if(!['taobao','tmall'].includes(shop.platform||'taobao'))throw Error('资金明细仅支持淘宝/天猫账号');
  this.downloadBusy=true;this.stopped=false;this.phaseText='正在下载明细 '+shop.name+' '+date;this.lastError='';
  this.log('download-start',shop.name+' | 日汇总单日 | '+date+' | v'+(require('../package.json').version||''));
  try{
   try{return await this.downloadDayRun(shop,date);}
   catch(error){
    // 与 download() 同口径：导航类失败销毁窗口重开再跑一轮
    if(this.stopped||!this.isNavFailure(error))throw error;
    this.log('download-round2',shop.name+' 首轮失败：'+error.message);
    this.phaseText=shop.name+' 第一轮没能下载 '+date+' 明细，关闭窗口重开新窗，开始第二轮…';
    this.host.dropWindow(shop.id);
    await wait(1200);this.check();
    return await this.downloadDayRun(shop,date);
   }
  }catch(error){
   this.lastError=error.message;
   this.log('download-fail',shop.name+' | '+error.message);
   try{
    const dir=await this.captureFailure(shop,error,'单日明细下载失败自动采集');
    if(dir)this.lastError=error.message+'；已自动生成诊断包：'+dir;
   }catch(e){}
   throw error;
  }
  finally{
   this.downloadBusy=false;this.phaseText='';
  }
 }
 async downloadDayRun(shop,date){
  let win=null;
  try{
   win=this.host.window(shop);
   this.armWindowOpen(win);
   await this.authenticateGuarded(shop,win);
   try{if(!win.isDestroyed()&&!win.isVisible())win.show();}catch(e){}
   this.armNavTrace(win);
   this.log('run-window',shop.name+' 窗口就绪，进入「日汇总」页（单日 '+date+'）');
   await this.openRecordTab(win,'日汇总',shop);
   this.log('run-opened',shop.name+' 已进入「日汇总」页');
   await this.fillDates(win,date,date);
   // 点完搜索等表格重载（与 download() 的 2500ms 同口径），再读行
   await wait(2500);this.check();this.host.assertWindow(win);
   const dir=this.exportFolder();fs.mkdirSync(dir,{recursive:true});
   const res=await this.downloadDailyRows(win,{
    shop,label:'日汇总',month:date.slice(0,7),dir,
    prefix:sanitizeName(shop.name)+'_日汇总',
    onlyDate:date.replace(/-/g,'')
   });
   return res;
  }catch(error){
   this.lastError=this.lastError||error.message;
   throw error;
  }finally{
   // 与 download() 同口径：结束销毁官方窗口，不留常驻会话拖慢后续店铺
   try{if(win&&!win.isDestroyed())win.destroy();}catch(e){}
  }
 }
 async downloadRun(shop,label,month){
  const window=()=>this.exportTimeoutMs||this.downloadTimeoutMs||EXPORT_TIMEOUT_MS;
  let win=null;
  try{
   win=this.host.window(shop);
   this.armWindowOpen(win);
   await this.authenticateGuarded(shop,win);
   // 导出时窗口置为可见（与抓取同理：弹窗渲染与点击需要真实可见页面）
   try{if(!win.isDestroyed()&&!win.isVisible())win.show();}catch(e){}
   this.armNavTrace(win);
   this.log('run-window',shop.name+' 窗口就绪，开始进入「'+label+'」页');
   await this.openRecordTab(win,label,shop);
   this.log('run-opened',shop.name+' 已进入「'+label+'」页 '+(win&&!win.isDestroyed()?'':'(窗口已销毁)'));
   // 按所选月份填日期区间再点导出（用户 2026-11 反馈）：不填的话官方导的是页面默认区间
   // （上月~本月）的文件，不是这一行月份的；日汇总/收支明细控件都是完整日期区间。
   // v1.2.32：当月导出的结束日期用今天——官方控件拒绝未来日期（填 11-30 会被重置回默认区间）
   if(month){
    // v1.2.49：月汇总页的控件是「月份区间」（值 YYYY-MM），用 fillMonth（与抓取同一条路径，
    // 写完自动点查询）；日汇总/收支明细控件是完整日期区间，继续用 fillDates
    if(label==='月汇总'){
     await this.fillMonth(win,month);
    }else{
     const endDay=(month===nowMonth()&&nowDate()<monthEnd(month))?nowDate():monthEnd(month);
     await this.fillDates(win,month+'-01',endDay);
    }
    // v1.2.36：fillDates 点完搜索后表格要重新加载——不等就点「导出」，官方可能因结果集
    // 还在生成而忽略导出请求（13:23 诊断实锤：导出记录抽屉空、120 秒无下载任务）
    await wait(2500);this.check();this.host.assertWindow(win);
   }
   const dir=this.exportFolder();fs.mkdirSync(dir,{recursive:true});
   const prefix=sanitizeName(shop.name)+'_'+label+'_'+(month||nowDate());
   // v1.2.37（用户 2026-11-05 截图指正）：日汇总的明细必须按表格每行右侧的「下载明细」
   // 逐日下载（每行一个当日流水文件）；右上角「导出」出的只是汇总文件且从未成功排队。
   // v1.2.51（用户 11-08 德国甄选包+截图实锤）：月汇总表格行同样带「下载明细」链接（下载该月
   // 流水明细），而右上角「导出」在新版下持续 120 秒不排队——月汇总也改走行级，彻底绕开「导出」。
   // 区间填写被官方控件重置也不影响：detailRows 按目标月行首（202610）挑行，靠默认区间覆盖
   if((label==='日汇总'||label==='月汇总')&&month){
    return await this.downloadDailyRows(win,{shop,label,month,dir,prefix});
   }
   this.armDownload(win);
   const pending=this.waitForDownload(win,dir,prefix);
   let clicked=await this.clickText(win,'导出');
   // 点完「导出」官方可能先弹确认框（确 定/确定），再弹「新建下载任务」——都要接管（v1.2.30）
   for(const label of ['确 定','确定'])if(await this.clickText(win,label))break;
   // 等待条件是「下载已真正开始」（will-download 触发时 ctx.started=true），而不是 downloadCtx 存在——
   // v1.2.24 的 !this.downloadCtx 条件从创建那刻就为假，整个轮询分支一次都不会执行（实测复现）
  const deadline=Date.now()+window();let retried=false,dialogTries=0,realTries=0;
  while(Date.now()<deadline&&!(this.downloadCtx&&this.downloadCtx.started)){
   // 官方流程：点「导出」→ 弹「新建下载任务」HTML 弹窗（异步生成账单）→ 弹窗里的「下载」才真正开始传文件
   await wait(3000);this.check();this.host.assertWindow(win);
   this.phaseText='正在导出 '+shop.name+' '+label+'（等待官方生成账单文件…剩余 '+Math.max(0,Math.round((deadline-Date.now())/1000))+' 秒）';
   if(clicked&&dialogTries<10){dialogTries++;
    if(await this.clickText(win,'立即下载')||await this.clickText(win,'下 载')||await this.clickText(win,'下载'))continue;
    // 确认框可能延迟出现：每轮顺手点一次确认类按钮（没有时 clickText 是 no-op）
    if(await this.clickText(win,'确 定')||await this.clickText(win,'确定')||await this.clickText(win,'确认导出')||await this.clickText(win,'立即导出'))continue;
   }
   // v1.2.36：13:23 诊断实锤——合成 click 点完「导出」官方毫无反应（无弹窗/任务/下载）。
   // 第 4 轮起改用真实鼠标点击「导出」兜底（realMenuClick 复用：不 hover，直接按坐标 mouseDown/Up），最多 2 次；
   // 先关掉「导出记录」抽屉（retried 轮点开的，盖在表格上方会挡住「导出」按钮）
   if(clicked&&dialogTries>=3&&realTries<2&&!(this.downloadCtx&&this.downloadCtx.started)){
    realTries++;
    this.phaseText='合成点击未触发导出，改用真实鼠标点击「导出」…';
    try{await this.host.execute(win,'(()=>{const b=document.querySelector(".next-drawer-close");if(b){b.click();return 1;}return 0;})()',true);}catch(e){}
    await wait(600);
    if(await this.realMenuClick(win,'','导出')){await wait(1500);continue;}
   }
    if(!retried){await this.clickText(win,'导出记录');retried=true;await wait(1200);}
    // 弹窗/页面 DOM 里若已出现账单文件直链（OSS 预签名 URL）：主进程直接代下，绕开官方下载器
    const found=await this.probeFileUrl(win);
    if(found){
     this.phaseText='已捕获账单文件直链，正在下载到导出文件夹';
     const name=sanitizeName(decodeURIComponent((found.split('?')[0].split('/').pop()||'账单.xlsx')));
     const file=path.join(dir,prefix+'_'+(/^.*\.(xlsx|xls|csv)$/i.test(name)?name:name+'.xlsx'));
     try{this.downloadCtx=null;}catch(e){}
     return {files:[await this.fetchToFile(found,file)]};
    }
    if(!clicked)clicked=await this.clickText(win,'导出');
    // 注意：这里绝不能点「下载明细」——那是日汇总表格每一行的行级链接（下载单日流水，
    // 2026-11-04 实测误下了 _20261103_0 单日文件），整月导出只走右上角「导出」
   }
   if(!clicked&&!(this.downloadCtx&&this.downloadCtx.started))throw Error('未找到「导出」按钮，请在官方窗口手动导出');
   const done=await pending;
   return {files:done.files||[]};
  }catch(error){
   // 记下本轮失败，finally 才不会把「给用户手动补导出」的窗口销毁掉
   this.lastError=this.lastError||error.message;
   throw error;
  }finally{
   // 导出成功后直接销毁官方窗口（v1.2.55）：批量下载是逐家串行的，旧实现只 hide 不销毁，
   // 6 家下来就是 6 个千牛页面 + 6 个持久会话常驻内存，官方的 SPA 长开还会越来越卡——
   // 既拖慢后面几家（表现为「停在首页不动」），也让主进程内存压力持续升高。
   // 登录态在 persist 分区里，下一家重开新窗口仍免登录；失败了才保留窗口给用户手动补导出
   try{
    if(win&&!win.isDestroyed()&&!this.lastError)this.host.dropWindow(shop.id);
   }catch(e){}
  }
 }
 close(){this.stopped=true;}
}
module.exports={FundSummary,FUND_EARLIEST,KINDS,monthRange,monthEnd,nowMonth,nowDate,parseAmount,parseSummaryRow,fundInspect,fillMonthScript,clickTextScript,depositEntryScript,nextPageScript,menuProbeScript,menuRectScript,menuPointerScript,detailRowsScript,clickDetailScript,diagnoseScript,dumpHtmlScript,sanitizeName,fundUrlCandidates,batchJobs};
