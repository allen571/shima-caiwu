'use strict';
// Only locators are polled. A click is dispatched once, after hover and fresh hit tests.
// Callers must confirm the business postcondition; this helper never retries a submission.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function pause(host,win,ms){for(let left=ms;left>0;left-=50){host.assertWindow(win);await sleep(Math.min(50,left));}host.assertWindow(win);}
function pressPoint(host,win,point,move=true){
 host.assertWindow(win);if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0)throw Error('页面控件位置未确认');
 for(const type of move?['mouseMove','mouseDown','mouseUp']:['mouseDown','mouseUp'])host.assertWindow(win).sendInputEvent({type,x:point.x,y:point.y,...(type==='mouseMove'?{}:{button:'left',clickCount:1})});
}
async function clickStable(host,win,locate,{stage='页面控件',action,timeout=6000}={}){
 const until=Date.now()+timeout;let reason='尚未就绪';
 const usable=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0&&(!action||p.action===action);
 while(Date.now()<until){
  host.assertWindow(win);const before=await locate();host.assertWindow(win);if(before?.done)return null;
  if(!usable(before)){reason=before?.reason||'尚未就绪或被遮挡';await pause(host,win,100);continue;}
  host.assertWindow(win).sendInputEvent({type:'mouseMove',x:before.x,y:before.y});
  await pause(host,win,120);const hovered=await locate();host.assertWindow(win);if(hovered?.done)return null;
  if(!usable(hovered)||hovered.x!==before.x||hovered.y!==before.y||hovered.action!==before.action){reason='悬停后位置或目标变化';continue;}
  await pause(host,win,80);const final=await locate();host.assertWindow(win);if(final?.done)return null;
  if(!usable(final)||final.x!==hovered.x||final.y!==hovered.y||final.action!==hovered.action){reason='点击前位置或命中变化';continue;}
  if(Date.now()>=until)break;
  pressPoint(host,win,final,false);return final;
 }
 const error=Error(stage+'未稳定：'+reason+'，未继续点击');error.code='PAGE_TARGET_NOT_READY';throw error;
}
module.exports={clickStable,pressPoint,pause};
