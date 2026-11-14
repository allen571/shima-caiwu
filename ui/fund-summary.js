(()=>{'use strict';const api=(action,...args)=>window.selectionDesktop.fundSummary(action,...args);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yuan=c=>c==null?'—':(c/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const needsLogin=s=>!!s.loginNeedsAttention||(['expired','verification','rejected'].includes(s.checkStatus)&&(!s.loginConfirmedAt||!s.checkAt||!Number.isFinite(Date.parse(s.checkAt))||!Number.isFinite(Date.parse(s.loginConfirmedAt))||Date.parse(s.checkAt)>Date.parse(s.loginConfirmedAt)));
const STATUS={queued:'排队中',running:'抓取中',completed:'完成',failed:'失败',paused:'已暂停'};

window.FundSummary={async mount(host){
 let state,selected=new Set(),timer,acting=false,actingSeq=0,shopsOpen=false,retrying=false,batching=false,showAll=false;
 const now=new Date(Date.now()+28800000).toISOString().slice(0,7);
 host.innerHTML=`<div class="fund-summary">
  <section class="fs-card">
   <div class="fs-heading"><div><span class="fs-eyebrow">资金管理</span><h2>资金月汇总</h2></div>
    <div class="fs-actions"><button id="fs-start">一键抓取所选</button><button id="fs-start-retry" title="备选入口：「一键抓取所选」点了没反应/按钮灰着不恢复时用——强制重置上一轮的抓取/导出状态，再按当前勾选重新抓取">备选抓取</button><button id="fs-start-manual">手动接管抓取</button><button id="fs-select-failed">勾选失败</button><button id="fs-pause">暂停</button><button id="fs-diagnose" class="fs-ghost">诊断导出</button></div></div>
   <p>抓取「财务 → 资金管理 → 聚合结算账户 → 月汇总」，按月读取收入、支出笔数与金额、期末余额。官方月汇总只在整月结束后出账，<strong>当月缺数据时会自动改抓「日汇总」并按天累加</strong>（结果标注「日汇总累计 N天」，期末余额取当月末一条）。账号与推广费页共用，登录一次两边可用；需要人工验证时会弹出官方窗口。京东/抖音账号不参与本页。<strong>抓取按勾选顺序逐个店铺串行执行（同一时刻只开一个店铺窗口），某家需要人工登录/验证时会停下等它完成，再继续下一家</strong>。</p>
   <div class="fs-controls">
    <label>开始月份<input type="month" id="fs-month-start"></label>
    <label>结束月份<input type="month" id="fs-month-end"></label>
    <span class="fs-folder" title="日汇总/收支明细导出文件的保存位置">导出文件夹：<code id="fs-folder"></code><button type="button" id="fs-folder-open">打开</button><button type="button" id="fs-folder-change">更改</button></span>
    <button type="button" id="fs-download-batch" title="按最近一轮抓取结果逐家下载（每家约 1~3 分钟）：历史满月走「月汇总」导出总计文件，当月未满月走「日汇总」逐日点「下载明细」；中途可点「暂停」中止，本轮已成功下载的店铺会自动跳过，失败的不影响后面的">批量下载明细</button>
    <label class="fs-auto" title="打开后：每次「一键抓取所选」抓完会自动接着逐家下载明细，不用再手点「批量下载明细」（每日计划抓的是单日数据，不触发自动下载）"><input type="checkbox" id="fs-auto-download">抓取后自动下载明细</label>
   </div>
   <div id="fs-manual" class="fs-manual" hidden><span id="fs-manual-text"></span><span class="fs-manual-actions"><button type="button" id="fs-manual-confirm">我已到页面</button><button type="button" id="fs-manual-skip">跳过这家</button></span></div>
   <div class="fs-shops-bar"><button type="button" id="fs-shops-toggle" aria-expanded="false"></button><span class="fs-shops-quick"><button type="button" id="fs-shops-all">全选</button><button type="button" id="fs-shops-none">清空</button></span></div>
   <div class="fs-shops" id="fs-shops" hidden></div>
   <p id="fs-message" class="fs-message" data-error="false"></p>
  </section>
  <section class="fs-card">
   <div class="fs-heading"><div><span class="fs-eyebrow">抓取结果</span><h2 id="fs-progress"></h2></div><label class="fs-show-all" title="显示其他日期或较早的记录（灰显，不计入完成数）"><input type="checkbox" id="fs-show-all">显示历史记录</label></div>
   <div class="fs-table"><table><thead><tr><th>店铺</th><th>日期 / 月份</th><th>状态</th><th>明细笔数</th><th>收入笔数</th><th>收入金额（元）</th><th>支出笔数</th><th>支出金额（元）</th><th>期末余额（元）</th><th>导出</th></tr></thead><tbody id="fs-results"></tbody></table></div>
  </section>
 </div>`;
 const $=s=>host.querySelector(s),message=(s,error=false)=>{$('#fs-message').textContent=s;$('#fs-message').dataset.error=String(error);};
 function render(){
  // 店铺顺序与推广费页表格完全一致（同一数组顺序，仅滤掉京东/抖音），不做额外排序
  const shops=(state.shops||[]).filter(s=>['taobao','tmall'].includes(s.platform));
  selected=new Set([...selected].filter(id=>shops.some(s=>s.id===id)));
  if(!selected.size&&!$('#fs-shops').dataset.touched)selected=new Set(shops.map(s=>s.id));
  $('#fs-folder').textContent=state.exportFolder||'';
  const toggle=$('#fs-shops-toggle');
  if(!shops.length){toggle.textContent='推广费页还没有淘宝/天猫账号，请先在「推广费查询」页导入';toggle.disabled=true;$('#fs-shops').hidden=true;}
  else{
   toggle.disabled=false;
   toggle.textContent=`${shopsOpen?'▾':'▸'} 店铺选择：已选 ${selected.size} / 共 ${shops.length} 家（与推广费页列表同序，${shopsOpen?'点击收起':'点击展开'}）`;
   toggle.setAttribute('aria-expanded',String(shopsOpen));
   $('#fs-shops').hidden=!shopsOpen;
   $('#fs-shops').innerHTML=shops.map(s=>`<label class="fs-shop ${selected.has(s.id)?'is-selected':''}"><input type="checkbox" data-fund-select="${s.id}" ${selected.has(s.id)?'checked':''} aria-label="选择${esc(s.name)}"><small class="fs-tag">${s.platform==='tmall'?'天猫':'淘宝'}</small><span>${esc(s.name)}</span>${s.loginNeedsAttention?'<small>需重新登录</small>':''}</label>`).join('');
  }
  const rows=state.results||[],current=rows.filter(r=>!r.carriedOver),done=current.filter(r=>r.status==='completed').length,failed=current.filter(r=>['failed','paused'].includes(r.status)).length;
  // v1.2.87：历史记录默认不显示（避免 11-04/11-06 的旧失败行堆在表里像「全失败」），勾选后灰显追加
  const histRows=showAll?(state.stale||[]).map(r=>({...r,isHistory:true})):[],shown=[...histRows,...rows];
  $('#fs-progress').textContent=rows.length?`完成 ${done}/${current.length} 项${failed?` · 待处理 ${failed}`:''}${state.phase?' · '+state.phase:''}`:'还没有抓取记录';
  $('#fs-results').innerHTML=shown.map(r=>`<tr class="is-${r.status}${r.carriedOver?' is-carried':''}${r.isHistory?' is-history':''}"><td>${esc(r.shopName)}${r.isHistory?'<small class="fs-note">历史记录 · 不计入合计</small>':''}${r.carriedOver?'<small class="fs-note" title="该店本轮重抓未成功，此处显示上一轮已获取的结果，金额仍计入合计">上一轮结果</small>':''}</td><td>${esc(r.day||r.month)}${r.source?`<small class="fs-src" title="${esc(r.source)}${r.days?'：'+r.days+' 天':''}">${esc(r.source)}${r.days?' '+r.days+'天':''}</small>`:''}</td><td>${STATUS[r.status]||r.status}${r.error?`<small title="${esc(r.error)}">${esc(r.error.length>26?r.error.slice(0,26)+'…':r.error)}</small>`:''}${r.note?`<small class="fs-note" title="${esc(r.note)}">备注</small>`:''}</td><td>${r.detailCount??'—'}</td><td>${r.incomeCount??'—'}</td><td>${yuan(r.incomeCents)}</td><td>${r.expenseCount??'—'}</td><td>${yuan(r.expenseCents)}</td><td>${yuan(r.balanceCents)}</td><td>${r.month<now?`<button data-monthly="${r.shopId}" data-month="${esc(r.month)}" title="历史满月：到月汇总页填该月月份区间后点官方「导出」，下载该月的月汇总总计文件（月汇总只在整月结束后出账）" ${state.downloadBusy?'disabled':''}>月汇总</button> `:''}<button data-daily="${r.shopId}" data-month="${esc(r.month)}" title="按整月下载日汇总明细" ${state.downloadBusy?'disabled':''}>${r.day?'下载整月明细':'下载明细'}</button> <button data-detail="${r.shopId}" data-month="${esc(r.month)}" title="按整月下载收支明细" ${state.downloadBusy?'disabled':''}>${r.day?'整月收支明细':'收支明细'}</button></td></tr>`).join('')||'<tr><td colspan="10">选择月份并勾选店铺后，点「一键抓取所选」。</td></tr>';
  const locked=acting||state.busy||state.downloadBusy||state.diagnosing;
  $('#fs-start').disabled=locked;
  $('#fs-start-manual').disabled=locked;$('#fs-diagnose').disabled=locked;
  // 备选抓取（v1.2.38）：专为「一键抓取所选失灵」准备的强制入口——不受 acting/busy 锁限制，
  // 只在自身重入或导出/诊断真在跑时禁用（这两种情况有「暂停」逃生门）
  $('#fs-start-retry').disabled=retrying;
  $('#fs-start-retry').title=retrying?'备选抓取启动中…':(state.downloadBusy||state.diagnosing)?'导出/诊断正在运行，可先点「暂停」中止再备选抓取':'强制重置上一轮抓取/导出状态并按当前勾选重新抓取（一键抓取所选失灵时用）';
  // 批量下载明细（v1.2.39）：逐家走行级「下载明细」通道；批量进行中或本页有导出任务时禁用
  $('#fs-download-batch').disabled=batching||state.downloadBusy;
  // v1.2.80：抓取后自动下载开关（真值来源在主进程，勾选状态随状态轮询同步）
  const autoBox=$('#fs-auto-download');
  if(autoBox){autoBox.checked=state.autoDownload!==false;autoBox.disabled=state.busy||state.downloadBusy;}
  // v1.2.87：历史记录开关（默认隐藏更早日期的旧记录）
  const showAllBox=$('#fs-show-all');
  if(showAllBox){showAllBox.checked=showAll;showAllBox.onchange=e=>{showAll=e.target.checked;render();};}
  // 打开/更改导出文件夹是轻量操作，不参与主任务锁（v1.2.33）：主任务卡住时它们必须仍可用
  // 暂停在抓取/导出/诊断期间都要可点（v1.2.31）：导出卡住时它是唯一逃生门，此前灰死只能重开软件
  $('#fs-pause').disabled=!(state.busy||state.downloadBusy||state.diagnosing);
  $('#fs-start').title=locked?'上一批抓取或导出仍在进行'+(state.downloadBusy?'（正在导出明细）':'')+'，等它结束或点「暂停」后再抓':'';
  $('#fs-pause').title=state.downloadBusy?'正在导出明细——点此中止导出':'';
  // 手动接管等待提示：软件已打开官方窗口，等用户自己点到资金页
  const pending=state.manualPending,bar=$('#fs-manual');
  if(bar){
   bar.hidden=!pending;
   if(pending)$('#fs-manual-text').textContent='等待手动接管：请在弹窗里点到「财务 → 资金管理 → 月汇总」（店铺：'+pending.name+'），到位后点右侧按钮';
  }
 }
 async function refresh(){state=await api('state');render();}
 // act 带「无响应兜底超时」（v1.2.33）：此前 acting 一旦挂死（如目录选择框没弹出来、IPC 永不返回），
 // 全页按钮永久灰死只能重开软件；现在超时自动解锁，后台任务若还在可点「暂停」中止
 async function act(work,timeoutMs){if(acting)return;const seq=++actingSeq;acting=true;render();let done=false;
  const unlock=()=>{if(done)return;done=true;if(actingSeq===seq){acting=false;render();message('操作 '+Math.round((timeoutMs||45))+' 秒无响应，已解锁按钮（后台任务可能仍在进行，可点「暂停」中止）',true);}};
  const timer=setTimeout(unlock,(timeoutMs||45)*1000);
  try{await work();}catch(e){if(!done)message(String(e.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''),true);}
  finally{done=true;clearTimeout(timer);if(actingSeq===seq)acting=false;try{await refresh();}catch(e){message('读取状态失败：'+e.message);}}}
 $('#fs-month-start').value=now;$('#fs-month-end').value=now;
 $('#fs-shops').addEventListener('change',e=>{const box=e.target.closest('[data-fund-select]');if(!box)return;$('#fs-shops').dataset.touched='1';box.checked?selected.add(box.dataset.fundSelect):selected.delete(box.dataset.fundSelect);render();});
 $('#fs-shops-toggle').onclick=()=>{shopsOpen=!shopsOpen;render();};
 $('#fs-shops-all').onclick=()=>{selected=new Set((state.shops||[]).filter(s=>['taobao','tmall'].includes(s.platform)).map(s=>s.id));$('#fs-shops').dataset.touched='1';render();message('已全选淘宝/天猫店铺');};
 $('#fs-shops-none').onclick=()=>{selected=new Set();$('#fs-shops').dataset.touched='1';render();message('已清空店铺勾选');};
 $('#fs-start').onclick=()=>act(async()=>{const start=$('#fs-month-start').value,end=$('#fs-month-end').value;if(!start||!end)return message('请选择开始、结束月份',true);await api('start',{shopIds:[...selected],months:{start,end}});// 当月没有月汇总账单，程序会自动改抓日汇总累加（v1.2.23 提示口径）
message(start<=now&&now<=end?'已开始抓取：'+now+' 是当前月、官方还没出月汇总账单，将自动改抓「日汇总」逐日累加（结束月份列显示的是目标月，数据到今天为止）；其余月份按月汇总抓取':'正在按月抓取资金月汇总');});
$('#fs-start-manual').onclick=()=>act(async()=>{const start=$('#fs-month-start').value,end=$('#fs-month-end').value;if(!start||!end)return message('请选择开始、结束月份',true);await api('start',{shopIds:[...selected],months:{start,end},manual:true});message('手动接管：逐个店铺会弹出官方窗口，点到「财务 → 资金管理 → 月汇总」后点上面的「我已到页面」');});
// 备选抓取（v1.2.38）：刻意不走 act()——acting 锁正是「一键抓取所选失灵」的常见元凶之一
$('#fs-start-retry').onclick=async()=>{if(retrying)return;retrying=true;render();
 const start=$('#fs-month-start').value,end=$('#fs-month-end').value;
 try{
  if(!start||!end)return message('请选择开始、结束月份',true);
  if(!selected.size)return message('备选抓取也要先勾选店铺：可点「勾选失败」快速选中上次失败的店铺',true);
  state=await api('restart',{shopIds:[...selected],months:{start,end}});render();
  message('备选抓取已启动：已强制重置上一轮的抓取/导出状态，按当前勾选重新抓取');
 }catch(e){message(String(e.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''),true);}
 finally{retrying=false;try{await refresh();}catch(e){message('读取状态失败：'+e.message);}}
};
$('#fs-diagnose').onclick=()=>act(async()=>{const shopId=(state.manualPending&&state.manualPending.shopId)||[...selected][0]||((state.shops||[]).find(s=>['taobao','tmall'].includes(s.platform))||{}).id;if(!shopId)return message('请先勾选一个淘宝/天猫店铺再做诊断',true);message('诊断中：窗口会弹出来。若没自动打开月汇总页，请在里面手动点「财务 → 资金管理 → 月汇总」，到位后会自动结束（最多等 2 分钟）…');const r=await api('diagnose',shopId);message((r.reached?'诊断完成，已识别到月汇总页（'+r.url+'）。':'诊断完成，自动导航仍未到位。')+'文件夹：'+r.dir+'（导航事件 '+r.events+' 条、页面快照 '+r.htmlFiles+' 个），请把这个文件夹发回');},210);
$('#fs-manual-confirm').onclick=()=>act(async()=>{const pending=state.manualPending;if(!pending)return message('当前没有等待中的店铺');await api('confirmManual',pending.shopId);message('已确认，继续读取「'+pending.name+'」');},150);
$('#fs-manual-skip').onclick=()=>act(async()=>{const pending=state.manualPending;if(!pending)return message('当前没有等待中的店铺');await api('skipManual',pending.shopId);message('已跳过「'+pending.name+'」，继续下一家');},150);
 $('#fs-select-failed').onclick=()=>{const ids=new Set((state.results||[]).filter(r=>!r.carriedOver&&['failed','paused','manual'].includes(r.status)).map(r=>r.shopId));selected=new Set((state.shops||[]).filter(s=>['taobao','tmall'].includes(s.platform)&&(ids.has(s.id)||needsLogin(s))).map(s=>s.id));$('#fs-shops').dataset.touched='1';render();message(selected.size?'已勾选 '+selected.size+' 个失败或需要重新登录的店铺':'没有失败或需要重新登录的店铺');};
 $('#fs-pause').onclick=()=>act(async()=>{await api('pause');message('已请求暂停，保留已抓取结果');});
// 批量下载明细（v1.2.80）：任务表与逐家 download() 收敛到主进程（API downloadBatch），
// 与「抓取后自动下载」共用同一条逻辑，进度靠 state.phase 轮询显示。
// 去重键改为 店铺|月份|runId：重新抓取后同一店铺同月可以再下载——此前只按店铺|月份去重，
// 上一批下载成功后就永久跳过，用户看到的就是「批量下载明细按钮用不了了」
$('#fs-download-batch').onclick=async()=>{
 if(batching)return;
 batching=true;render();
 try{
  const r=await api('downloadBatch');
  if(r.skipped){message(r.message||'没有待下载的结果行',true);return;}
  const failures=r.failures||[],notes=r.notes||[];
  message('批量下载明细结束：成功 '+r.ok+'/'+r.jobs+' 家、共 '+(r.files||[]).length+' 个文件 → '+(state.exportFolder||'导出文件夹')
   +(r.paused?'\n已中止：再点「批量下载明细」会从没下载的店铺继续':'')
   +(failures.length?'\n失败 '+failures.length+' 家（可在结果行单独点按钮重试）：\n'+failures.join('\n'):'')
   +(notes.length?'\n需留意：\n'+notes.join('\n'):''),failures.length>0);
 }catch(e){message(String(e.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''),true);}
 finally{batching=false;try{await refresh();}catch(e){}}
};
// v1.2.80 抓取后自动下载开关（持久化在主进程 fund-summary.json，默认开）
$('#fs-auto-download').onchange=async e=>{
 const on=e.target.checked;
 try{
  await api('setAutoDownload',on);
  message(on?'已打开「抓取后自动下载明细」：以后每次抓取完成会自动接着逐家下载':'已关闭「抓取后自动下载明细」：需要时点「批量下载明细」');
 }catch(err){message(String(err.message||err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''),true);}
 try{await refresh();}catch(err){}
};
 $('#fs-folder-change').onclick=async()=>{try{const result=await api('setExportFolder');if(!result.cancelled)message('导出文件夹：'+result.exportFolder);await refresh();}catch(e){message(String(e.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''),true);}};
 $('#fs-folder-open').onclick=async()=>{try{await api('openExportFolder');message('已在资源管理器打开导出文件夹');}catch(e){message(String(e.message||e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''),true);}};
 host.addEventListener('click',e=>{
  const daily=e.target.closest('[data-daily]'),detail=e.target.closest('[data-detail]'),monthly=e.target.closest('[data-monthly]');if(!daily&&!detail&&!monthly)return;
  const button=daily||detail||monthly;const kind=monthly?'month':daily?'daily':'detail';act(async()=>{const result=await api('download',{shopId:button.dataset[monthly?'monthly':daily?'daily':'detail'],kind,month:button.dataset.month});  // 整月导出按天/分片出多个文件（v1.2.27）：全部列出，附保存位置
  const files=(result&&result.files)||(result&&result.file?[result.file]:[]);
  const note=(result&&result.note)||'';
  message(files.length===1?'已导出：'+files[0]:files.length>1?'已导出 '+files.length+' 个文件到 '+ (state.exportFolder||'导出文件夹')+'：\n'+files.map(f=>f.split(/[\\/]/).pop()).join('\n'):'导出完成，但没有产出文件');
  if(note)setTimeout(()=>message(note,true),600);},540);
 });
 await refresh();
 timer=setInterval(()=>{if(!host.isConnected){clearInterval(timer);return;}if(!acting)void refresh().catch(()=>{});},1200);
}};
})();
