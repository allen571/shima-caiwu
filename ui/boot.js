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
// v1.2.83：打开随主程序一起内置的「财务工作台」（FinanceHub，本机 8765 端口的数据服务）
(()=>{
 const button=document.getElementById('finance-workbench');
 const api=window.selectionDesktop&&window.selectionDesktop.app;
 if(!button)return;
 if(!api){button.disabled=true;button.title='当前环境不支持启动工作台';return;}
 const clean=message=>String(message&&message.message||message||'未知错误').replace(/^Error invoking remote method '[^']+':\s*/,'').replace(/^Error:\s*/,'');
 const reset=label=>setTimeout(()=>{button.textContent=label;},6000);
 api('workbenchStatus').then(info=>{
  if(!info||!info.available){button.disabled=true;button.textContent='无内置工作台';button.title='当前运行的是开发模式（或该版本未内置工作台）';return;}
  if(info.running){button.textContent='工作台已运行';button.title='财务工作台已在 127.0.0.1:'+info.port+' 运行，点一下可以再唤起一次';}
  else button.title='启动内置的财务工作台（'+info.size/1048576+' MB，首次启动约几秒）';
 }).catch(()=>{});
 button.onclick=async()=>{
  if(!api||button.disabled)return;
  const previous=button.textContent;button.disabled=true;button.textContent='启动中…';
  try{
   const result=await api('workbenchLaunch');
   if(result&&result.already)button.textContent='工作台已在运行';
   else if(result&&result.running)button.textContent='工作台已启动';
   else if(result&&result.note)button.textContent='已启动（端口未就绪）';
   else button.textContent=previous||'打开工作台';
   reset('打开工作台');
  }catch(error){button.textContent=clean(error).slice(0,40);reset('打开工作台');}
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
