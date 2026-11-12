'use strict';
const {clickStable,pause}=require('./page-operations.cjs');
// Read-only page probes locate controls. All mutations use Chromium input events.
async function operate(host,win,frame,inspect,credentials){
 if(!credentials.stage){
  for(const [stage,delay] of [['username',0],['password',500],['submit',1000]]){
   if(stage==='submit'&&credentials.fillOnly)return {status:'filled'};
   await pause(host,win,delay);
   const result=await operate(host,win,frame,inspect,{...credentials,fillOnly:stage==='username'&&credentials.fillOnly,stage});
   if(result.status!=='prepared')return result;
  }
  return {status:'unknown'};
 }
 const input={...credentials,nativeInput:true};
 const locate=async()=>{
  host.assertWindow(win);
  const p=await inspect(input);host.assertWindow(win);
  if(p.status!=='native')return {done:true,state:p};
  // Resolve every ancestor afresh; reject ambiguous, scaled or covered frames.
  let child=frame;
  while(child.parent){
   const result=await host.execute(win,`(()=>{const es=[...document.querySelectorAll('iframe,frame')].filter(e=>${JSON.stringify(child.name||'')}?e.name===${JSON.stringify(child.name||'')}:e.src===${JSON.stringify(child.url)});if(es.length!==1)return null;const e=es[0],r=e.getBoundingClientRect();if(r.width!==e.offsetWidth||r.height!==e.offsetHeight)return null;const x=${p.x}+r.left+e.clientLeft,y=${p.y}+r.top+e.clientTop;if(document.elementFromPoint(x,y)!==e)return null;return {x:Math.round(x),y:Math.round(y)};})()`,false,child.parent);
   host.assertWindow(win);if(!result)return {done:true,state:{status:'manual'}};
   Object.assign(p,result);child=child.parent;
  }
  return p;
 };
 let stopped;
 const point=await clickStable(host,win,async()=>{const p=await locate();if(p.done)stopped=p.state;return p;},{stage:'登录控件',timeout:2500});
 if(!point)return stopped||{status:'manual'};
 if(point.action==='switch')return {status:'switched'};
 if(point.action==='submit')return {status:'submitted'};
 const value=point.action==='username'?credentials.username:credentials.password;
 // Focus must come from the mouse click. Never redirect input with DOM focus().
 const focused=await host.execute(win,`(()=>{const e=document.activeElement;return !!e&&e.tagName==='INPUT'&&e.value===''&&${point.action==='password'?"e.type==='password'":"['text','email','tel'].includes(e.type)"};})()`,false,frame);
 host.assertWindow(win);if(!focused)return {status:'manual'};
 let prefix='';
 for(const character of value){
  const ready=await host.execute(win,`(()=>{const e=document.activeElement;return !!e&&e.tagName==='INPUT'&&e.value===${JSON.stringify(prefix)}&&${point.action==='password'?"e.type==='password'":"['text','email','tel'].includes(e.type)"};})()`,false,frame);
  host.assertWindow(win);if(!ready)return {status:'manual'};
  const wc=host.assertWindow(win);
  wc.sendInputEvent({type:'keyDown',keyCode:character,modifiers:[]});
  host.assertWindow(win).sendInputEvent({type:'char',keyCode:character,modifiers:[]});
  host.assertWindow(win).sendInputEvent({type:'keyUp',keyCode:character,modifiers:[]});
  prefix+=character;await pause(host,win,20);
 }
 return {status:'prepared'};
}
module.exports={operate};
