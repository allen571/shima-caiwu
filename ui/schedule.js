(()=>{'use strict';
// 每日计划（定时抓取）卡片 v1.2.63：不再是独立页签，以可折叠卡片嵌入「推广费查询」「资金月汇总」两页顶部（v1.2.63 用户要求）
// v1.2.61 事故教训：本文件曾少写 IIFE 闭合导致整段解析失败、页签空白——scripts/test-scheduler.cjs 里有语法编译兜底用例
const api=(action,...args)=>window.selectionDesktop.scheduler(action,...args);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yuan=c=>c==null?'—':(c/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const PSTATUS={queued:'排队',running:'进行中',completed:'完成',failed:'失败',paused:'暂停',missing:'无数据',none:'无','finance-only':'财务号'};
const PLATFORM={taobao:'淘宝',tmall:'天猫',jd:'京东',douyin:'抖音'};
const roundBadge=r=>!r?'':r.status==='completed'?(r.suspect?`<span class="sc-round is-warn" title="存在「无/财务号」推广账户，两轮后仍需人工核对">待核对</span>`:`<span class="sc-round ${r.round===1?'is-r1':'is-r2'}" title="${r.round===1?'第一轮成功':'第二轮重试成功'}">${r.round===1?'一轮成功':'二轮成功'}</span>`):`<span class="sc-round is-fail">${PSTATUS[r.status]||r.status}</span>`;
window.Scheduler={_n:0,async mount(host){
 const uid='sc'+(++this._n);
 let state,timer,acting=false;
 host.innerHTML=`<details class="sc-embed" id="${uid}-embed">
  <summary><span class="sc-embed-title">每日计划 · 定时抓 T-1</span><span class="sc-embed-sum" id="${uid}-sumline">加载中…</span><i class="sc-embed-arrow" aria-hidden="true">▸</i></summary>
  <div class="sc-embed-body">
   <div class="sc-controls">
    <label class="sc-switch"><input type="checkbox" id="${uid}-enabled"><span>启用每日计划</span></label>
    <label>抓取时刻<input type="time" id="${uid}-time" value="08:30"></label>
    <label class="sc-switch"><input type="checkbox" id="${uid}-auto-export"><span>自动导出 Excel</span></label>
    <label class="sc-switch" title="开机后自动启动本软件并最小化到托盘（电脑需处于开机状态）"><input type="checkbox" id="${uid}-auto-start"><span>开机自启</span></label>
    <button id="${uid}-save" class="sc-btn">保存设置</button>
    <button id="${uid}-run-now" class="sc-btn sc-btn-primary">立即运行（抓 T-1）</button>
   </div>
   <p class="sc-note">到设定时刻自动抓<strong>昨天（T-1）</strong>一天：先跑<strong>推广费</strong>（全部账号），再跑<strong>资金日汇总</strong>（淘宝/天猫，单日）。第一轮全部店铺都跑，<strong>失败和「无/财务号」的店铺自动跑第二轮</strong>；结果全部一起展示，跑完自动导出 Excel 到资金导出文件夹。到点时软件必须在运行（关窗=缩到托盘）；计划运行期间尽量别动鼠标键盘。</p>
   <p class="sc-hint" id="${uid}-state-line"></p>
   <p id="${uid}-message" class="sc-message" data-error="false"></p>
   <div class="sc-embed-history"><div class="sc-heading"><span class="sc-eyebrow">运行记录</span><span id="${uid}-history-title"></span></div><div id="${uid}-history"></div></div>
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
  $(`#${uid}-auto-start`).checked=!!state.autoStart;
  const line=$(`#${uid}-state-line`);
  if(state.running)line.textContent='⏳ '+state.phaseText;
  else if(state.lastRun){
   const s=state.lastRun.summary;
   line.textContent='上次计划（'+state.lastRun.planDate+'）：'+(s?('一轮成功 '+s.okRound1+' · 二轮成功 '+s.okRound2+' · 仍失败 '+s.failed+' · 共 '+s.total+' 家'):(state.lastRun.status==='failed'?'失败：'+(state.lastRun.error||''):''))+'（'+String(state.lastRun.finishedAt||'').replace('T',' ').slice(0,16)+'）';
  }else line.textContent='还没有运行过计划。';
  $(`#${uid}-run-now`).disabled=acting||state.running||state.busy||state.fundBusy;
  $(`#${uid}-run-now`).title=state.running?'每日计划正在运行':(state.busy||state.fundBusy)?'推广费/资金抓取正在运行，等它结束后再试':'';
  $(`#${uid}-history-title`).textContent=state.history&&state.history.length?'（'+state.history.length+' 条，点击展开明细）':'';
  const list=state.history||[];
  $(`#${uid}-history`).innerHTML=list.map(h=>{
   const s=h.summary;
   const head=`<div class="sc-rec-head" data-rec="${h.id}"><span class="sc-rec-date">${esc(h.date)}</span>
    <span class="sc-rec-sum ${h.status==='failed'?'is-fail':h.status==='partial'?'is-partial':'is-done'}">${h.status==='failed'?'计划失败':s?('一轮成功 '+s.okRound1+' · 二轮成功 '+s.okRound2+' · 仍失败 '+s.failed):(h.status==='running'?'运行中…':'')}</span>
    <span class="sc-rec-time">${String(h.finishedAt||h.startedAt||'').replace('T',' ').slice(5,16)}</span>
    ${h.exportFile?`<span class="sc-rec-file" title="${esc(h.exportFile)}">已导出 Excel</span>`:''}</div>`;
   const rows=(h.rows||[]).map(r=>`<tr><td>${esc(r.shopName)}</td><td>${PLATFORM[r.platform]||esc(r.platform)}</td>
    <td>${r.promo?yuan(r.promo.amountCents):'—'} ${r.promo?roundBadge(r.promo):''}</td>
    <td>${r.fund?(yuan(r.fund.incomeCents)+' / '+yuan(r.fund.expenseCents)+' / 末 '+yuan(r.fund.balanceCents)):(r.fund===null?'不参与':'—')} ${r.fund&&r.fund.status?roundBadge(r.fund):''}</td>
    <td>${r.error?`<small class="sc-err" title="${esc(r.error)}">${esc(r.error)}</small>`:'<small class="sc-ok">—</small>'}</td></tr>`).join('');
   return `<div class="sc-record ${h.status==='failed'?'is-failed':''}">${head}<div class="sc-table"><table><thead><tr><th>店铺</th><th>平台</th><th>推广费（元）</th><th>资金 收入/支出/期末余额（元）</th><th>失败原因</th></tr></thead><tbody>${rows||'<tr><td colspan="5">无明细</td></tr>'}</tbody></table></div></div>`;
  }).join('')||'<p class="sc-empty">还没有运行记录。开启计划后，每天到点自动抓；也可以点「立即运行（抓 T-1）」先试一次。</p>';
  sumline();
 }
 async function refresh(){try{state=await api('state');render();}catch(e){/* 页面隐藏/桥异常时轮询失败忽略 */}}
 $(`#${uid}-save`).onclick=async()=>{
  try{
   message('保存中…');
   state=await api('configure',{enabled:$(`#${uid}-enabled`).checked,time:$(`#${uid}-time`).value,autoExport:$(`#${uid}-auto-export`).checked,autoStart:$(`#${uid}-auto-start`).checked});
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
  head.closest('.sc-record').classList.toggle('is-open');
 });
 timer=setInterval(refresh,5000);
 await refresh();
 return {unmount(){clearInterval(timer);}};
}};})();
