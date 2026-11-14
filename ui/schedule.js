(()=>{'use strict';
// 每日计划（定时抓取）卡片 v1.2.63：不再是独立页签，以可折叠卡片嵌入「推广费查询」「资金月汇总」两页顶部（v1.2.63 用户要求）
// v1.2.61 事故教训：本文件曾少写 IIFE 闭合导致整段解析失败、页签空白——scripts/test-scheduler.cjs 里有语法编译兜底用例
const api=(action,...args)=>window.selectionDesktop.scheduler(action,...args);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yuan=c=>c==null?'—':(c/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const PSTATUS={queued:'排队',running:'进行中',completed:'完成',failed:'失败',paused:'暂停',missing:'无数据',none:'无','finance-only':'财务号'};
// v1.2.90：库里的 startedAt/finishedAt 是 UTC ISO 串（2026-11-11T11:40:39.283Z），
// 直接截字符串会少 8 小时显示成 11:40。统一按北京时间（UTC+8，无夏令时）格式化。
const bjStamp=(iso,withDate)=>{
  const t=Date.parse(iso||'');
  if(!t)return '';
  const d=new Date(t+28800000);
  const p=n=>String(n).padStart(2,'0');
  const md=p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate())+' '+p(d.getUTCHours())+':'+p(d.getUTCMinutes());
  return withDate?(d.getUTCFullYear()+'-'+md):md;
};
const PLATFORM={taobao:'淘宝',tmall:'天猫',jd:'京东',douyin:'抖音'};
// v1.2.91：「无/财务号」子账户两轮核对后仍无数据 → 按无数据处理（灰色徽标，不算失败不显红字）
const roundBadge=r=>!r?'':r.status==='completed'?(r.suspect?`<span class="sc-round is-none" title="存在「无/财务号」推广账户，两轮核对后仍无数据，按无数据处理（不算失败）">${r.amountCents==null?'暂无数据':'部分无数据'}</span>`:`<span class="sc-round ${r.round===1?'is-r1':'is-r2'}" title="${r.round===1?'第一轮成功':'第二轮重试成功'}">${r.round===1?'一轮成功':'二轮成功'}</span>`):`<span class="sc-round is-fail">${PSTATUS[r.status]||r.status}</span>`;
window.Scheduler={_n:0,async mount(host){
 const uid='sc'+(++this._n);
 let state,timer,acting=false,showAllHistory=false,openRecords=new Set();
 host.innerHTML=`<details class="sc-embed" id="${uid}-embed">
  <summary><span class="sc-embed-title">每日计划 · 定时抓 T-1</span><span class="sc-embed-sum" id="${uid}-sumline">加载中…</span><i class="sc-embed-arrow" aria-hidden="true">▸</i></summary>
  <div class="sc-embed-body">
   <div class="sc-controls">
    <label class="sc-switch"><input type="checkbox" id="${uid}-enabled"><span>启用每日计划</span></label>
    <label>抓取时刻<input type="time" id="${uid}-time" value="08:30"></label>
    <label class="sc-switch"><input type="checkbox" id="${uid}-auto-export"><span>自动导出 Excel</span></label>
    <label class="sc-switch" title="计划抓取结束后，自动到日汇总页逐家下载 T-1 当天的「下载明细」流水文件（淘宝/天猫，存到资金导出文件夹；单店失败不影响计划结果）"><input type="checkbox" id="${uid}-auto-detail"><span>跑完自动下载当日明细</span></label>
    <label class="sc-switch" title="开机后自动启动本软件并最小化到托盘（电脑需处于开机状态）"><input type="checkbox" id="${uid}-auto-start"><span>开机自启</span></label>
    <button id="${uid}-save" class="sc-btn">保存设置</button>
    <button id="${uid}-run-now" class="sc-btn sc-btn-primary">立即运行（抓 T-1）</button>
   </div>
   <p class="sc-note">到设定时刻自动抓<strong>昨天（T-1）</strong>一天：先跑<strong>推广费</strong>（全部账号），再跑<strong>资金日汇总</strong>（淘宝/天猫，单日）。第一轮全部店铺都跑，<strong>失败和「无/财务号」的店铺自动跑第二轮</strong>；跑完<strong>自动逐家下载当日明细流水文件</strong>（可关），最后导出 Excel 到资金导出文件夹。到点时软件必须在运行（关窗=缩到托盘）；计划运行期间尽量别动鼠标键盘。</p>
   <p class="sc-hint" id="${uid}-state-line"></p>
   <p id="${uid}-message" class="sc-message" data-error="false"></p>
   <div class="sc-embed-history"><div class="sc-heading"><span class="sc-eyebrow">运行记录</span><span id="${uid}-history-title"></span></div><div id="${uid}-history"></div><div id="${uid}-history-more" class="sc-history-more"></div></div>
  </div>
 </details>`;
 const $=s=>host.querySelector(s),message=(s,error=false)=>{$(`#${uid}-message`).textContent=s;$(`#${uid}-message`).dataset.error=String(error);};
 const sumline=()=>{
  const el=$(`#${uid}-sumline`);
  if(state.running){el.textContent='⏳ '+state.phaseText;el.className='sc-embed-sum is-running';}
  else if(state.lastRun){
   const s=state.lastRun.summary;
   el.textContent='上次（'+state.lastRun.planDate+'）：'+(s?('一轮 '+s.okRound1+' · 二轮 '+s.okRound2+' · 失败 '+s.failed):(state.lastRun.status==='failed'?'失败':''))+'';
   el.className='sc-embed-sum '+(state.lastRun.status==='failed'?'is-fail':state.lastRun.status==='partial'?'is-partial':'is-done');
  }
  else{el.textContent='未启用 · 尚无记录';el.className='sc-embed-sum';}
 };
 function render(){
  $(`#${uid}-enabled`).checked=!!state.enabled;
  $(`#${uid}-time`).value=state.time||'08:30';
  $(`#${uid}-auto-export`).checked=!!state.autoExport;
  $(`#${uid}-auto-detail`).checked=state.autoDetailDownload!==false;
  $(`#${uid}-auto-start`).checked=!!state.autoStart;
  const line=$(`#${uid}-state-line`);
  if(state.running)line.textContent='⏳ '+state.phaseText;
  else if(state.lastRun){
   const s=state.lastRun.summary;
   line.textContent='上次计划（'+state.lastRun.planDate+' 数据）：'+(s?('一轮成功 '+s.okRound1+' · 二轮成功 '+s.okRound2+' · 仍失败 '+s.failed+' · 共 '+s.total+' 家'):(state.lastRun.status==='failed'?'失败：'+(state.lastRun.error||''):''))+(state.lastRun.finishedAt?'（'+bjStamp(state.lastRun.finishedAt,false)+' 跑完）':'');
  }else line.textContent='还没有运行过计划。';
  $(`#${uid}-run-now`).disabled=acting||state.running||state.busy||state.fundBusy;
  $(`#${uid}-run-now`).title=state.running?'每日计划正在运行':(state.busy||state.fundBusy)?'推广费/资金抓取正在运行，等它结束后再试':'';
  // 只显示今天和昨天的运行记录（北京时间口径；更早的记录仍在数据文件里，只是不渲染）。
  // v1.2.89（2026-11-11 用户反馈「运行记录占屏幕、没办法折叠」）：默认只渲染最近 3 条，
  // 其余收进「显示更早」开关，点开才渲染；数据文件不动。
  const bjNow=new Date(Date.now()+28800000),bjToday=bjNow.toISOString().slice(0,10),bjYesterday=new Date(bjNow.getTime()-86400000).toISOString().slice(0,10);
  const list=(state.history||[]).filter(h=>h.date>=bjYesterday&&h.date<=bjToday);
  const visible=showAllHistory?list:list.slice(0,3);
  const hiddenCount=list.length-visible.length;
  $(`#${uid}-history-title`).textContent=list.length?`（${list.length} 条 · ${showAllHistory?'全部显示':`显示最近 ${visible.length} 条`}，点击行展开明细）`:'';
  $(`#${uid}-history`).innerHTML=visible.map(h=>{
   const s=h.summary;
   const monthlyErrors=(h.monthly||[]).filter(r=>r.status!=='completed').map(r=>((h.rows||[]).find(x=>x.shopId===r.shopId)?.shopName||'店铺')+'：'+(r.error||r.status)).join('；');
   const head=`<div class="sc-rec-head" data-rec="${h.id}"><span class="sc-rec-date" title="这一轮抓的是哪一天的数据（T-1）">${esc(h.date)} 数据</span>
    <span class="sc-rec-sum ${h.status==='failed'?'is-fail':h.status==='partial'?'is-partial':'is-done'}">${h.status==='failed'?'计划失败':s?('一轮成功 '+s.okRound1+' · 二轮成功 '+s.okRound2+' · 仍失败 '+s.failed):(h.status==='running'?'运行中…':'')}</span>
    <span class="sc-rec-time" title="这一轮实际跑完的时间（北京时间）">${bjStamp(h.finishedAt||h.startedAt,false)} 跑完</span>
    ${s&&s.monthly?`<span class="sc-rec-file" title="${esc(monthlyErrors||'本月累计查询完成')}">推广费月累计 ${s.monthly.total-s.monthly.failed}/${s.monthly.total}${s.monthly.failed?' · 失败 '+s.monthly.failed:''}</span>`:''}
    ${s&&s.detail?`<span class="sc-rec-file" title="计划跑完自动下载的当日明细流水文件">明细 ${s.detail.files} 份${s.detail.noData?' · 暂无数据 '+s.detail.noData:''}${s.detail.failed?' · 失败 '+s.detail.failed:''}</span>`:''}
    ${h.exportFile?`<span class="sc-rec-file" title="${esc(h.exportFile)}">已导出 Excel</span>`:''}</div>`;
   const rows=(h.rows||[]).map(r=>`<tr><td>${esc(r.shopName)}</td><td>${PLATFORM[r.platform]||esc(r.platform)}</td>
    <td>${r.promo?yuan(r.promo.amountCents):'—'} ${r.promo?roundBadge(r.promo):''}</td>
    <td>${r.fund?(yuan(r.fund.incomeCents)+' / '+yuan(r.fund.expenseCents)+' / 末 '+yuan(r.fund.balanceCents)):(r.fund===null?'不参与':'—')} ${r.fund&&r.fund.status?roundBadge(r.fund):''}</td>
    <td>${r.error?`<small class="sc-err" title="${esc(r.error)}">${esc(r.error)}</small>`:'<small class="sc-ok">—</small>'}</td></tr>`).join('');
   return `<div class="sc-record${openRecords.has(h.id)?' is-open':''} ${h.status==='failed'?'is-failed':''}">${head}<div class="sc-table"><table><thead><tr><th>店铺</th><th>平台</th><th>推广费（元）</th><th>资金 收入/支出/期末余额（元）</th><th>失败原因</th></tr></thead><tbody>${rows||'<tr><td colspan="5">无明细</td></tr>'}</tbody></table></div></div>`;
  }).join('')||'<p class="sc-empty">还没有运行记录。开启计划后，每天到点自动抓；也可以点「立即运行（抓 T-1）」先试一次。</p>';
  $(`#${uid}-history-more`).innerHTML=hiddenCount>0?`<button type="button" id="${uid}-show-older">显示更早的 ${hiddenCount} 条</button>`:(showAllHistory&&list.length>3?`<button type="button" id="${uid}-show-older">收起，只看最近 3 条</button>`:'');
  sumline();
 }
 async function refresh(){
  try{
   const next=await api('state');
   // v1.2.91：状态没变化就不重渲染——此前每 5 秒无条件 innerHTML 重建，
   // 会把用户刚点开的「展开明细」瞬间折叠回去（闪关）。
   const sig=JSON.stringify(next);
   if(sig===refresh._sig)return;
   refresh._sig=sig;state=next;render();
  }catch(e){/* 页面隐藏/桥异常时轮询失败忽略 */}
 }
 $(`#${uid}-save`).onclick=async()=>{
  try{
   message('保存中…');
   state=await api('configure',{enabled:$(`#${uid}-enabled`).checked,time:$(`#${uid}-time`).value,autoExport:$(`#${uid}-auto-export`).checked,autoDetailDownload:$(`#${uid}-auto-detail`).checked,autoStart:$(`#${uid}-auto-start`).checked});
   message('已保存。'+(state.enabled?'计划将在每天 '+state.time+' 自动抓 T-1'+(state.autoStart?'，开机自启已开启':''):'计划已停用（软件关闭后不再定时抓取）'));
  }catch(e){message(e.message,true);}
  await refresh();
 };
 $(`#${uid}-run-now`).onclick=async()=>{
  if(acting)return;acting=true;
  try{message('每日计划启动中（先推广费后资金，全程自动两轮）…');await api('runNow');message('每日计划执行完成。');}
  catch(e){message(e.message,true);}
  acting=false;await refresh();
 };
 $(`#${uid}-history`).addEventListener('click',event=>{
  const head=event.target.closest('.sc-rec-head');if(!head)return;
  // 展开状态记录在 openRecords 里：轮询重渲染/「显示更早」切换后仍保持展开
  const id=head.dataset.rec;
  if(openRecords.has(id))openRecords.delete(id);else openRecords.add(id);
  head.closest('.sc-record').classList.toggle('is-open');
 });
 $(`#${uid}-history-more`).addEventListener('click',event=>{
  if(event.target.id!==`${uid}-show-older`)return;
  showAllHistory=!showAllHistory;render();
 });
 timer=setInterval(refresh,5000);
 await refresh();
 return {unmount(){clearInterval(timer);}};
}};})();
