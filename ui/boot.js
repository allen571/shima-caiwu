// v1.2.72：版本角标改为动态读取真实版本（旧实现写死 'v1.2.5'，导致界面一直显示旧版本号骗人）。
// 版本由 main.cjs loadFile 的 query 注入（?v=1.2.71），兜底 '未知'
window.FUND_VERSION='v'+(new URLSearchParams(location.search).get('v')||'未知');
document.getElementById('finance-version').textContent=window.FUND_VERSION;
// v1.2.82：导出内置源码包——安装包本身带着完整工程，点一下存到桌面（导出后自动在资源管理器里选中）
(()=>{
 const button=document.getElementById('finance-source');
 const api=window.selectionDesktop&&window.selectionDesktop.app;
 if(!button)return;
 if(!api){button.disabled=true;button.title='当前环境不支持导出';return;}
 const reset=label=>setTimeout(()=>{button.textContent=label;},6000);
 const clean=message=>String(message&&message.message||message||'未知错误').replace(/^Error invoking remote method '[^']+':\s*/,'').replace(/^Error:\s*/,'');
 const base='导出源码包';
 api('sourceInfo').then(info=>{
  if(!info||!info.available){button.textContent='无内置源码';button.disabled=true;button.title='当前运行的是开发模式（或该版本未内置源码），请直接使用工程目录';return;}
  button.title='导出内置源码包（'+info.name+'，'+(info.size/1048576).toFixed(2)+' MB）到桌面';
 }).catch(()=>{});
 button.onclick=async()=>{
  if(!api||button.disabled)return;
  const previous=button.textContent;button.disabled=true;
  try{
   const result=await api('exportSource');
   if(result&&!result.cancelled){button.textContent='已导出 '+(result.name||'源码包');reset(base);}
   else button.textContent=previous||base;
  }catch(error){button.textContent=clean(error).slice(0,40);reset(base);}
  finally{button.disabled=false;}
 };
})();
const tabs=document.getElementById('finance-tabs'),views={promotion:document.getElementById('app'),fund:document.getElementById('fund-app')};
tabs.addEventListener('click',event=>{
 const button=event.target.closest('[data-tab]');if(!button)return;
 for(const b of tabs.querySelectorAll('[data-tab]')){const active=b===button;b.classList.toggle('is-active',active);b.setAttribute('aria-pressed',String(active));}
 for(const [key,view] of Object.entries(views))view.hidden=key!==button.dataset.tab;
});
window.PromotionFee.mount(document.getElementById('promo-root')).catch(e=>{document.getElementById('promo-root').textContent='启动失败：'+e.message;});
window.FundSummary.mount(document.getElementById('fund-root')).catch(e=>{document.getElementById('fund-root').textContent='资金月汇总加载失败：'+e.message;});
// v1.2.63：每日计划不再是独立页签，可折叠卡片嵌入两个页面顶部（schedule.js 若语法失败这里会抛错而非静默空白）
if(window.Scheduler){
 window.Scheduler.mount(document.getElementById('schedule-slot-promo')).catch(e=>{document.getElementById('schedule-slot-promo').textContent='每日计划加载失败：'+e.message;});
 window.Scheduler.mount(document.getElementById('schedule-slot-fund')).catch(e=>{document.getElementById('schedule-slot-fund').textContent='每日计划加载失败：'+e.message;});
}
