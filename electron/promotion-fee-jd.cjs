'use strict';
const {clickStable,pressPoint}=require('./page-operations.cjs');
const MERCHANT_HOME='https://shop.jd.com/';
const HOME='https://jzt.jd.com/msa/#/lite';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function jdPage(input={}){
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0'&&getComputedStyle(e).opacity!=='0';
 const nativeTarget=(el,action)=>{const r=el.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);const hit=document.elementFromPoint(x,y);if(x<0||y<0||x>=innerWidth||y>=innerHeight||!(hit===el||el.contains(hit)))return {status:'manual'};return {status:'native',action,x,y};};
 const text=e=>(e?.innerText||e?.textContent||'').replace(/\s+/g,' ').trim(),body=document.body?.innerText||'';
 if(location.protocol!=='https:'||!(location.hostname==='jd.com'||location.hostname.endsWith('.jd.com')))return {status:'untrusted'};
 const challenge=[...document.querySelectorAll('[class*=JDJRV],[id*=captcha],[class*=captcha],iframe')].some(e=>visible(e)&&(/验证码|安全验证|拖动|滑块|拼图/.test(text(e))||/captcha|verify|jcap/i.test(e.src||'')))||/请完成验证|拖动.*滑块|安全验证|请依次点击/.test(body);
 if(challenge||location.hostname==='aq.jd.com'&&/身份认证|短信验证码|确认是您本人/.test(body))return {status:'verification'};
 if(['passport.jd.com','passport.shop.jd.com'].includes(location.hostname)&&/登录异常，请联系客服解除|账号被锁|账号被限制/.test(body))return {status:'blocked',message:'京麦提示登录异常，请在官方窗口处理后再查询'};
 const merchant=location.hostname==='passport.shop.jd.com';
 const usable=e=>visible(e)&&!e.disabled&&!e.readOnly;
 const unique=list=>list.length===1?list[0]:null;
 const pwd=merchant?unique([...document.querySelectorAll('input[type=password]')].filter(usable)):document.querySelector('#nloginpwd');
 // 京麦新版不再保证 loginname ID；仅在密码所在表单内识别唯一的账号与登录控件。
 const scope=pwd?.closest('form')||document;
 const users=merchant?[...scope.querySelectorAll('input')].filter(e=>usable(e)&&['text','email','tel'].includes(e.type)&&(/^(?:loginname|username|loginId|login_id|account|email)$/i.test(e.id||'')||/^(?:loginname|username|loginId|login_id|account|email)$/i.test(e.name||'')||/账号|帐号|用户名|邮箱/.test([e.placeholder,e.getAttribute('aria-label')].join(' ')))):[];
 const user=merchant?unique(users):document.querySelector('#loginname');
 const submit=merchant?unique([...scope.querySelectorAll('button,[role=button],input[type=submit],a')].filter(e=>usable(e)&&/^(立即登录|登\s*录)$/.test(e.tagName==='INPUT'?e.value:text(e)))):document.querySelector('#paipaiLoginSubmit');
 // 新版京东登录页默认停在「扫码登录／短信登录」页签：账号密码框已渲染但不可见。
 // 旧逻辑把它判成「不是登录表单」，窗口就空着等人工；这里先点「账号密码登录」页签再填写。
 const loginHost=location.hostname;
 if(['passport.jd.com','passport.shop.jd.com'].includes(loginHost)&&!visible(pwd)&&!visible(user)){
  const tabs=[...document.querySelectorAll('a,button,li,span,div,[role=tab]')].filter(visible).filter(e=>/^(账号密码登录|账户密码登录|密码登录|账号登录|帐号登录|密码登陆)$/.test(text(e)));
  const tab=tabs.find(e=>!tabs.some(o=>o!==e&&e.contains(o)))||tabs[0];
  if(tab){
   // 只探测不点击：让调用方知道「这是登录页，只是停在别的页签」。
   if(!input.credentials)return {status:'form',loginHost};
   // 只在第一段（账号）阶段切页签，避免重复点击把页面切走。
   if(input.credentials.stage===undefined||input.credentials.stage==='username'){tab.click();return {status:'switched'};}
  }
 }
 if(['passport.jd.com','passport.shop.jd.com'].includes(location.hostname)&&visible(pwd)&&visible(user)&&visible(submit)){
  if(/密码错误|账户名与密码不匹配|账户名和密码不匹配|账号或密码错误|账号被锁/.test(body))return {status:'rejected'};
  if(!input.credentials)return {status:'form',loginHost:location.hostname};
  if(input.credentials.stage!==undefined&&!['username','password','submit'].includes(input.credentials.stage))return {status:'manual'};
  const form=pwd.closest('form');if(form){const action=new URL(form.action||location.href,location.href);if(action.protocol!=='https:'||!action.hostname.endsWith('.jd.com'))return {status:'untrusted'};}
  if([...document.querySelectorAll('input[type=checkbox],[role=checkbox]')].some(e=>visible(e)&&!(e.checked||e.getAttribute('aria-checked')==='true')&&/协议|条款|我同意/.test(text(e.closest('label')||e.parentElement))))return {status:'agreement'};
  if(input.fillOnly&&(user.value||pwd.value))return {status:'manual'};
  const stage=input.credentials.stage;
  if(['password','submit'].includes(stage)&&user.value!==input.credentials.username)return {status:'manual'};
  if(stage==='password'&&pwd.value&&pwd.value!==input.credentials.password)return {status:'manual'};
  if(stage==='submit'&&pwd.value!==input.credentials.password)return {status:'manual'};
  if(input.credentials.nativeInput){if(stage==='username'&&user.value||stage==='password'&&pwd.value)return {status:'manual'};return nativeTarget(stage==='username'?user:stage==='password'?pwd:submit,stage);}
  if(stage!=='submit')for(const [e,value]of [[user,input.credentials.username],[pwd,input.credentials.password]]){
   if(stage==='username'&&e===pwd||stage==='password'&&e===user)continue;
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
  }
  if(['username','password'].includes(stage))return {status:'prepared'};
  if(input.fillOnly)return {status:'filled'};
  submit.click();return {status:'submitted'};
 }
 if(location.hostname==='shop.jd.com'&&/商品|订单/.test(body)&&body.length>250)return {status:'merchant',links:[...document.querySelectorAll('a[href]')].filter(visible).filter(e=>text(e)==='京准通').map(e=>({url:e.href}))};
 const accountId=body.match(/账[户号]\s*ID\s*[:：]\s*(\d+)/i)?.[1];
 if(accountId&&['jzt.jd.com','xnjzt.jd.com'].includes(location.hostname)){
  const marker=[...document.querySelectorAll('span,div,p')].filter(visible).filter(e=>/账[户号]\s*ID\s*[:：]/i.test(text(e))&&text(e).length<180).sort((a,b)=>text(a).length-text(b).length)[0];
  const accountArea=marker?.parentElement;const name=text(accountArea).replace(/账[户号]\s*ID\s*[:：]\s*\d+/i,'').replace(/主账号|子账号|POP|\s+/g,' ').trim();
  const links=[...document.querySelectorAll('a[href]')].filter(visible).filter(e=>/财务管理|财务记录/.test(text(e))).map(e=>({text:text(e),url:e.href}));
  return {status:'logged_in',isSub:body.slice(0,200).includes('子账号'),accountId,name,links,url:location.href,text:body.slice(0,18000)};
 }
 return {status:'unknown',url:location.origin+location.pathname};
}
function jdNavigation(label,defer=false){const visible=e=>e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&getComputedStyle(e).visibility!=='hidden';const list=[...document.querySelectorAll('a,button,[role=tab],[role=menuitem],span,div')].filter(visible).filter(e=>(e.innerText||'').trim()===label).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);if(!list.length)return false;if(defer)setTimeout(()=>list[0].click(),0);else list[0].click();return true;}
function jdNavTarget(label){
 const visible=e=>e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0';
 const selector='a,button,[role=tab],[role=menuitem],[class*=menu-item],[class*=menuItem],[class*=submenu-title]';
 const candidates=[...new Set([...document.querySelectorAll('a,button,span,div,[role=tab],[role=menuitem]')].filter(e=>visible(e)&&e.innerText.trim()===label).map(e=>e.closest(selector)).filter(e=>e&&visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'))];
 if(candidates.length!==1)return {action:'waiting',reason:candidates.length?'导航入口不唯一':'导航入口尚未就绪'};
 const e=candidates[0],r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);
 return hit&&e.contains(hit)?{action:'ready',x,y}:{action:'waiting',reason:'导航入口被遮挡'};
}
// 新版 xnjzt 首页把主体内容放进子 iframe：在单个 frame 内找唯一可点的入口文本并直接点击
function jdFrameClick(label){
 const visible=e=>e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const key=e=>(e?.innerText||'').replace(/\s+/g,' ').trim();
 let cand=[...document.querySelectorAll('a,button,[role=button],[role=tab],[class*=btn],[class*=button],[onclick]')].filter(visible).filter(e=>key(e)===label);
 cand=cand.filter(e=>!cand.some(o=>o!==e&&e.contains(o)));
 if(cand.length!==1)return false;cand[0].click();return true;
}
// 新版账户中心「收支汇总」页签带图标、可能不是标准 a/button 结构：按包含匹配并清洗图标字符后点最内层
function jdSummaryTab(){
 const visible=e=>e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const key=e=>(e?.innerText||'').replace(/[^\u4e00-\u9fa5a-zA-Z0-9（）()]/g,'');
 let cand=[...document.querySelectorAll('a,button,span,div,li,h1,h2,h3,h4,h5,[role=tab],[role=button],[role=menuitem]')].filter(visible).filter(e=>key(e).includes('收支汇总')&&key(e).length<=12);
 cand=cand.filter(e=>!cand.some(o=>o!==e&&e.contains(o)));
 if(!cand.length)return false;cand[0].click();return true;
}
// 判「财务号/无」前的最后探测：入口可能改名（如「推广费汇总」「收支汇总(新)」）或懒加载稍慢。
// 放宽为可见文本含「汇总」且含「收支/推广」，命中即点击并返回文本；完全找不到才允许负向判定
function jdWidenedSummary(){
 const visible=e=>e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const key=e=>(e?.innerText||'').replace(/[^\u4e00-\u9fa5a-zA-Z0-9（）()]/g,'');
 let cand=[...document.querySelectorAll('a,button,span,div,li,h1,h2,h3,h4,h5,[role=tab],[role=button],[role=menuitem]')].filter(visible).filter(e=>{const k=key(e);return k.length<=16&&k.includes('汇总')&&(/收支/.test(k)||/推广/.test(k));});
 cand=cand.filter(e=>!cand.some(o=>o!==e&&e.contains(o)));
 if(!cand.length)return '';cand[0].click();return key(cand[0]).slice(0,20);
}
function jdFinanceReady(label,locate){
 const next={'财务管理':'财务记录','财务记录':'收支汇总'}[label];if(next)return locate(next).action==='ready';
 const visible=e=>e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0';
 return label==='收支汇总'&&[...document.querySelectorAll('input[placeholder="请选择日期"]')].filter(visible).length===1&&/推广费(?:消费金额|总额[（(]可开票[）)])/.test(document.body.innerText);
}
function jdAccountTrigger(){const e=document.querySelector('#user-pin-id');if(!e||!e.getClientRects().length||getComputedStyle(e).visibility==='hidden')return null;const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};}
// 新版京准通首页：账户卡里「账号授权」只是标题，可点入口是卡内「前往」链接（老版菜单仍是「账号授权」文字项）
function jdAuthorizeGo(){
 const visible=e=>e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const key=e=>(e?.innerText||'').replace(/[\s\uE000-\uF8FF?？ⓘ•●]/g,'');
 const cards=[...document.querySelectorAll('div,section,li,a')].filter(visible).filter(e=>key(e).includes('账号授权')&&key(e)!=='账号授权');
 const card=cards.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
 if(!card)return {action:'waiting',reason:'京东账号授权入口尚未就绪'};
 const go=[...card.querySelectorAll('a,button,[role=button],[class*=link],[class*=btn],span,div')].filter(visible).filter(e=>e!==card&&(/^(前往|进入|立即前往|查看|开通)$/.test(key(e))||e.tagName==='A')).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
 const at=e=>{if(!e)return null;const r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);return hit&&(e===hit||e.contains(hit))?{x,y}:null;};
 const p=at(go)||at(card);
 return p?{action:'ready',...p}:{action:'waiting',reason:'京东账号授权入口被遮挡'};
}
function jdDateInput(){
 const inputs=[...document.querySelectorAll('input[placeholder="请选择日期"]')].filter(e=>e.getClientRects().length&&!e.closest('[hidden],[aria-hidden=true]')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0');
 if(inputs.length>1)throw Error('京东日期输入框不唯一，未点击');
 const e=inputs[0];if(e?.disabled||e?.getAttribute?.('aria-disabled')==='true')return {action:'waiting',reason:'日期筛选暂不可用'};
 if(!e)return {action:'waiting',reason:'日期筛选尚未就绪'};
 const r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);
 if(hit!==e){const blocker=hit?.closest?.('[role=alert],.jad-message-notice,.jad-message,.jad-notification')||hit,text=(blocker?.innerText||'').replace(/\s+/g,' ').trim();return {action:'waiting',reason:'日期筛选被遮挡，未点击'+(text&&text.length<=180?'：'+text:'')};}
 return {action:'ready',x,y};
}
// 京小通/站内消息气泡（jad-message 系、role=alert）可能悬浮在日期筛选正上方，导致日期框永远
// 「被遮挡」超时失败。此处只处理通知类遮挡：优先点气泡自带关闭钮，找不到才移除该节点；
// 非通知类的遮挡（业务弹层、跨PIN提示等）一律不碰，返回 null 交给原有重试逻辑。
function jdDismissNotice(){
 const visible=e=>e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0';
 const inputs=[...document.querySelectorAll('input[placeholder="请选择日期"]')].filter(visible);
 const e=inputs[0];if(!e)return null;
 const r=e.getBoundingClientRect(),hit=document.elementFromPoint(Math.round(r.x+r.width/2),Math.round(r.y+r.height/2));
 if(!hit||hit===e||e.contains(hit))return null;
 const blocker=hit.closest?.('[role=alert],.jad-message-notice,.jad-message,.jad-notification')||hit;
 const text=(blocker.innerText||'').replace(/\s+/g,' ');
 const isNotice=/京小通|新消息|站内信|消息通知/.test(text)||/jad-message|jad-notification/.test(String(blocker.className||''))||blocker.getAttribute?.('role')==='alert';
 if(!isNotice)return null;
 const close=[...blocker.querySelectorAll('[class*=close],[aria-label*=关闭]')].filter(visible)[0];
 if(close){close.click();return 'closed';}
 if(blocker!==document.body&&blocker.parentElement){blocker.remove();return 'removed';}
 return null;
}
function jdCalendar(date){const visible=e=>{if(!e.getClientRects().length||e.closest('[hidden],[aria-hidden="true"]'))return false;if(typeof e.checkVisibility==='function')return e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});const s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&s.visibility!=='collapse'&&s.opacity!=='0';};const point=(e,container,action)=>{const popup=container.closest('.jad-dropdown-popper');if(popup&&(/(?:^|\s)jad-[\w-]+-(?:enter|leave)(?:-active|-to)?(?:\s|$)/.test(popup.className)||popup.getAnimations?.().some(a=>a.playState==='running'||a.pending)))return 'waiting';const r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);return hit&&container.contains(hit)?{action,x,y}:'waiting';};const parts=date.split('-').map(Number),target=parts[0]*12+parts[1];const panels=[...document.querySelectorAll('.jad-date-picker-content-left,.jad-date-picker-content-right')].filter(visible);if(panels.length>2||panels.filter(p=>p.classList?.contains('jad-date-picker-content-left')).length>1||panels.filter(p=>p.classList?.contains('jad-date-picker-content-right')).length>1)throw Error('京东可见日期面板不唯一，未点击');for(const p of panels){const labels=[...p.querySelectorAll('.jad-date-picker-header-label')].map(e=>e.innerText.trim());const y=parseInt(labels[0]),m=parseInt(labels[1]);if(y*12+m===target){const cell=[...p.querySelectorAll('.jad-date-picker-cell')].find(e=>visible(e)&&!/(prev-month|next-month|disabled)/.test(e.className)&&parseInt(e.innerText)===parts[2]);if(!cell)return 'missing';return point(cell.querySelector('em')||cell,cell,'selected');}}const p=panels[0];if(!p)return 'waiting';const labels=[...p.querySelectorAll('.jad-date-picker-header-label')].map(e=>parseInt(e.innerText));const before=target<labels[0]*12+labels[1],side=before?p:panels[panels.length-1];const arrow=[...side.querySelectorAll(before?'.jad-date-picker-prev-btn-arrow':'.jad-date-picker-next-btn-arrow')].find(visible);if(!arrow)return 'missing';return point(arrow,arrow.parentElement,'moved');}
// 只读取控件已提交的选中状态；悬停预览不能作为点击成功的证据。
function jdDateState(){
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0';
 const inputs=[...document.querySelectorAll('input[placeholder="请选择日期"]')].filter(visible);if(inputs.length>1)throw Error('京东日期输入框不唯一，未读取');const input=inputs[0];
 const panels=[...document.querySelectorAll('.jad-date-picker-content-left,.jad-date-picker-content-right')].filter(visible);
 if(panels.length>2||panels.filter(p=>p.classList.contains('jad-date-picker-content-left')).length>1||panels.filter(p=>p.classList.contains('jad-date-picker-content-right')).length>1)throw Error('京东可见日期面板不唯一，未读取');
 const headers=panels.map(p=>[...p.querySelectorAll('.jad-date-picker-header-label')].map(e=>e.innerText.trim()).join('-')).join('|');
 const selected=panels.map(p=>[...p.querySelectorAll('.jad-date-picker-cell')].map(e=>{const marks=String(e.className).split(/\s+/).filter(c=>/selected|range-start|range-end/.test(c)&&!/hover/.test(c));return marks.length||e.getAttribute('aria-selected')==='true'?e.innerText.trim()+':'+marks.sort().join(','):'';}).filter(Boolean).join('|')).join(';');
 const layers=[...new Set(panels.map(p=>p.closest('.jad-dropdown-popper')||p.parentElement))];
 if(layers.length>1)throw Error('京东日期面板所属弹层不唯一，未读取');
 const selector='button,[role=button],.jad-date-picker-confirm';
 const buttons=layers[0]?[...layers[0].querySelectorAll(selector)].filter(e=>visible(e)&&!e.disabled&&!e.closest('[disabled],[aria-disabled=true]')&&e.getAttribute('aria-disabled')!=='true'&&!e.querySelector(selector)&&/^(确定|确认)$/.test(e.innerText.trim())):[];
 if(buttons.length>1)throw Error('京东日期确认按钮不唯一，未点击');const button=buttons[0];
 let confirm=null;if(button){const r=button.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);if(button.contains(document.elementFromPoint(x,y)))confirm={x,y};}
 // 单元格签名：不依赖具体选中类名约定，点击后任何日格类名/文本变化都可作为「已选中」证据；hover 类随鼠标产生，剔除以免悬停误判。
 const cells=panels.map(p=>[...p.querySelectorAll('.jad-date-picker-cell')].map(e=>e.innerText.trim()+':'+String(e.className).replace(/[^\s]*hover[^\s]*/gi,'').replace(/\s+/g,' ').trim()).join('|')).join(';');
 return {open:panels.length>0,headers,selection:selected,value:input?.value||'',confirm,cells};
}
// 不依赖 Escape 支持；只在弹层外的静态账单标题上派发原生点击。
function jdCalendarDismiss(){
 const visible=e=>e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0';
 const panels=[...document.querySelectorAll('.jad-date-picker-content-left,.jad-date-picker-content-right')].filter(visible);
 if(!panels.length)return null;
 const layers=[...new Set(panels.map(e=>e.closest('.jad-dropdown-popper')||e))];
 const interactive='a,button,input,select,textarea,label,[role=button],[role=tab],[role=menuitem],[onclick],[contenteditable=true]';
 const nodes=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,div')].filter(e=>visible(e)&&/^(入账明细|出账明细|收支汇总)$/.test(e.innerText.trim())&&!e.closest(interactive)&&!e.querySelector(interactive));
 nodes.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);
 for(const e of nodes){
  if(layers.some(layer=>layer.contains(e)))continue;
  const r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);
  if(!hit||!e.contains(hit)||hit.closest(interactive)||layers.some(layer=>{const b=layer.getBoundingClientRect();return layer.contains(hit)||x>=b.left&&x<=b.right&&y>=b.top&&y<=b.bottom;}))continue;
  return {x,y};
 }
 return null;
}
function jdLedger(){const visible=e=>{if(!e.getClientRects().length||e.closest('[hidden],[aria-hidden="true"]'))return false;if(typeof e.checkVisibility==='function')return e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});const s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&s.visibility!=='collapse'&&s.opacity!=='0';};const body=document.body.innerText;const inputs=[...document.querySelectorAll('input[placeholder="请选择日期"]')].filter(visible);if(inputs.length!==1)throw Error('京东账单日期控件未唯一确认，未读取金额');const input=inputs[0];const dates=input?.value.match(/(\d{4}-\d{2}-\d{2})/g)||[];const matches=[...body.matchAll(/推广费(?:消费金额|总额[（(]可开票[）)])\s*[¥￥]?\s*([\d,]+\.\d{2})/g)];const cash=[...document.querySelectorAll('button')].some(e=>visible(e)&&e.innerText.trim()==='现金'&&e.classList.contains('jad-btn-checked'));return {accountId:body.match(/账户ID\s*[:：]\s*(\d+)/)?.[1],start:dates[0],end:dates[1],amountCents:cash&&matches.length===1?Math.round(Number(matches[0][1].replace(/,/g,''))*100):null,loading:[...document.querySelectorAll('.jad-loading,.jad-spin')].some(visible)};}
function jdAuthorizationPage(input={}){
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none');
 const text=e=>(e?.innerText||'').replace(/\s+/g,' ').trim(),key=e=>text(e).replace(/[\s\uE000-\uF8FF?？ⓘ•●]/g,'');
 const disabled=e=>!!e.disabled||!!e.closest('[disabled],[aria-disabled=true],.disabled,.jad-disabled,.jad-btn-disabled,.jad-page-disabled,.jad-pagination-disabled')||!!e.querySelector('[disabled],[aria-disabled=true]');
 const candidates=[...document.querySelectorAll('.jad-table')];
 const scopes=(candidates.length?candidates:[...document.querySelectorAll('table,[role=table]')]).filter(visible).map(scope=>({scope,headers:[...scope.querySelectorAll('thead th,[role=columnheader]')].map(key)})).filter(v=>v.headers.some(h=>h.includes('授权账户'))&&v.headers.includes('授权状态'));
 if(scopes.length!==1)return {ready:false,reason:scopes.length?'授权列表不唯一':'授权列表表头尚未就绪',rows:[],loading:false,empty:false};
 const {scope,headers}=scopes[0],index=name=>headers.indexOf(name);
 if(headers.filter(h=>h==='授权状态').length!==1)return {ready:false,error:'京东授权列表表头不唯一，未选择账户'};
 // 2026 改版兼容：列表出现两列同名「被授权账户」（第一列是登录方自己，第二列才是免密登录目标），
 // 账户列优先取唯一「授权账户」，否则在含「授权账户」的列里用行内容排除当前登录账号那一列
 const selfId=(document.body.innerText.match(/账[户号]\s*ID\s*[:：]\s*(\d+)/i)||[])[1]||'';
 const looseAts=headers.map((h,i)=>[h,i]).filter(([h])=>h.includes('授权账户')).map(([,i])=>i);
 let accountAt=looseAts.length===1?looseAts[0]:-1;
 if(accountAt<0){
  const rowsAll=[...scope.querySelectorAll('tbody tr,[role=row]')].filter(visible);
  const targetCells=at=>rowsAll.reduce((n,row)=>{const cell=row.querySelectorAll('td,[role=cell]')[at];const id=cell?(text(cell).match(/ID\s*[:：]\s*(\d+)/i)||[])[1]||'':'';return n+(id&&id!==selfId?1:0);},0);
  const scored=looseAts.map(at=>[targetCells(at),at]).filter(([n])=>n>0).sort((a,b)=>b[0]-a[0]);
  if(scored.length===1||scored.length>1&&scored[0][0]>scored[1][0])accountAt=scored[0][1];
  else return {ready:false,reason:'授权列表账户列尚未确认',rows:[],loading:false,empty:false};
 }
 const loading=[...document.querySelectorAll('.jad-loading,.jad-spin,[aria-busy=true]')].some(visible);
 const readRows=[...scope.querySelectorAll('tbody tr,[role=row]')].filter(visible).map(row=>{
  const cells=[...row.querySelectorAll('td,[role=cell]')];if(!cells.length)return null;
  const account=cells[accountAt],accountId=text(account).match(/ID\s*[:：]\s*(\d+)/i)?.[1];if(!accountId){if(loading||!text(row)||/暂无数据|暂无授权/.test(text(row)))return null;throw Error('京东授权账户ID未识别，未跳过该记录');}
  const status=key(cells[index('授权状态')]),period=text(cells[index('授权有效期')]),dates=period.match(/\d{4}-\d{2}-\d{2}/g)||[];
  const control=[...row.querySelectorAll('a,button,span,[role=button]')].filter(visible).find(e=>/^免密登录授权账[户号]$/.test(key(e))&&!disabled(e));
  // 2026-11 京东状态词改版（实测出现「授权取消」）：过期/生效按包含匹配判断；状态陌生但提供「免密登录」控件的行视为可登录，交给后续认证流程把关
  const expired=/过期|取消|撤销|失效|终止|拒绝/.test(status);
  return {row,control,accountId,name:text(account).replace(/ID\s*[:：]\s*\d+/i,'').trim(),status,active:!expired&&(/生效中|已生效|正常|授权有效/.test(status)||!!control),expired,validFrom:dates[0]||'',validUntil:dates[1]||'',canLogin:!!control};
 }).filter(Boolean);

 // 未知状态且无免密登录控件才拒绝判定（有控件的行已按可登录处理），报错带状态原文便于继续适配
 const unknown=readRows.find(r=>!r.expired&&!/生效中|已生效|正常|授权有效/.test(r.status)&&!r.canLogin);
 if(unknown&&!loading)return {ready:false,rows:[],loading:false,empty:false,reason:'授权状态未识别：「'+(unknown.status||'空白')+'」，未判为过期；该行无免密登录控件，若账户实际可用请截图反馈'};
 const rows=readRows.map(({row,control,...r})=>r);
 const nexts=[...new Set([...document.querySelectorAll('button[title="下一页"],button[aria-label="下一页"],.jad-pagination-next,.jad-page-next')].filter(visible).map(e=>e.closest('.jad-pagination-next,.jad-page-next')||e))];
 if(nexts.length>1)return {ready:false,error:'京东授权列表分页入口不唯一，未跳过账户'};
 const next=nexts[0],total=text(document.body).match(/共\s*(\d+)\s*条/);
 if(!next&&(!total||Number(total[1])>rows.length))return {ready:false,rows:[],loading,empty:false,reason:'授权列表分页尚未就绪'};
 const page=[...document.querySelectorAll('[aria-current=page],.jad-pagination-item-active,.jad-page-item-active')].find(visible);
 const point=e=>{if(!e||disabled(e))return {action:'waiting',reason:'授权控件暂不可用'};const r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);return hit&&e.contains(hit)?{action:'ready',x,y}:{action:'waiting',reason:'授权控件被遮挡'};};
 if(input.action==='next')return point(next);
 if(input.action==='login'){
  const target=readRows.find(r=>r.accountId===input.accountId&&r.active&&r.control);
  if(!target||loading)return false;target.control.click();return true;
 }
 return {ready:true,rows,loading,empty:/暂无数据|暂无授权/.test(text(scope)),hasNext:!!next&&!disabled(next),total:total?Number(total[1]):null,pageNumber:Number(key(page))||null,signature:JSON.stringify(rows)};
}
function authorizationSummary(rows){
 const active=new Map();for(const row of rows)if(row.active&&!active.has(row.accountId))active.set(row.accountId,row);
 const seen=new Set(),notices=[];for(const row of rows)if(row.expired){const key=JSON.stringify([row.accountId,row.validFrom,row.validUntil]);if(seen.has(key))continue;seen.add(key);notices.push({accountId:row.accountId,name:row.name,validFrom:row.validFrom,validUntil:row.validUntil,stillActive:active.has(row.accountId),checkedAt:new Date().toISOString()});}
 return {targets:[...active.values()],notices};
}
class JdLedgerReceipt{
 constructor({host,win,dates}){Object.assign(this,{host,win,dates});this.debug=win.webContents.debugger;this.requests=new Map();this.sequence=0;this.closed=false;this.owned=false;}
 command(method,params){return this.host.execute(this.win,method,false,{executeJavaScript:()=>this.debug.sendCommand(method,params)});}
 async open(){this.host.assertWindow(this.win);if(this.debug.isAttached())throw Error('账单刷新观察器已被占用，未读取金额');this.debug.attach('1.3');this.owned=true;this.listener=(_event,method,p)=>this.observe(method,p);this.detached=()=>{this.owned=false;this.invalid=true;};this.debug.on('message',this.listener);this.debug.on('detach',this.detached);try{await this.command('Network.enable');}catch(error){this.close();throw error;}}
 endpoint(url){try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='atoms-api.jd.com'&&u.pathname==='/financecore/account/month/bill/list';}catch{return false;}}
 observe(method,p){if(this.closed||this.invalid)return;if(method==='Network.requestWillBeSent'){
   if(!this.endpoint(p.request.url)||p.request.method!=='POST')return;let input;try{input=JSON.parse(p.request.postData);}catch{this.latest=null;this.requests.clear();return;}
   if(!input||typeof input!=='object'||Array.isArray(input)){this.latest=null;this.requests.clear();return;}
   if(Number(input.inOutType)===1)return;this.latest=null;this.requests.clear();
   if(input.beginDate!==this.dates.start||input.endDate!==this.dates.end||Number(input.inOutType)!==2||Number(input.timeFilterType)!==1)return;
   const entry={sequence:++this.sequence,requestId:p.requestId,status:0};this.requests.set(p.requestId,entry);this.latest=entry;
  }else if(method==='Network.responseReceived'){const entry=this.requests.get(p.requestId);if(entry)entry.status=this.endpoint(p.response.url)?p.response.status:0;
  }else if(method==='Network.loadingFailed'){const entry=this.requests.get(p.requestId);if(entry)entry.failed=true;
  }else if(method==='Network.loadingFinished'){
   const entry=this.requests.get(p.requestId);if(!entry||entry!==this.latest||entry.status<200||entry.status>=300)return;
   void this.command('Network.getResponseBody',{requestId:p.requestId}).then(result=>{if(this.closed||this.invalid||entry!==this.latest)return;let body;try{const raw=result.base64Encoded?Buffer.from(result.body,'base64').toString('utf8'):result.body;body=JSON.parse(raw);}catch{entry.failed=true;return;}
    const rows=Array.isArray(body.data)?body.data.filter(r=>Number(r.orderType)===1&&r.orderTypeName==='推广费消费金额'):[];
    if(Number(body.code)!==1||rows.length!==1){entry.failed=true;return;}const match=String(rows[0].amount).match(/^(\d+)(?:\.(\d{1,2}))?$/);if(!match){entry.failed=true;return;}const amount=Number(match[1])*100+Number((match[2]||'').padEnd(2,'0'));if(!Number.isSafeInteger(amount)){entry.failed=true;return;}entry.amountCents=amount;entry.finishedAt=new Date().toISOString();
   }).catch(()=>{entry.failed=true;});
  }
 }
 reset(){this.latest=null;this.requests.clear();}
 proof(){const e=this.latest;return !this.closed&&!this.invalid&&e&&!e.failed&&e.finishedAt?{sequence:e.sequence,start:this.dates.start,end:this.dates.end,amountCents:e.amountCents,finishedAt:e.finishedAt,basis:'官方页面本轮现金支出分类响应·记账时间·推广费消费金额'}:null;}
 close(){if(this.closed)return;this.closed=true;if(this.listener)this.debug.removeListener('message',this.listener);if(this.detached)this.debug.removeListener('detach',this.detached);if(this.owned&&this.debug.isAttached()){try{this.debug.detach();}catch{}}this.requests.clear();}
}
// 财务号（finance-only）账户视为已处理：不参与金额合计，也不把店铺状态拖成部分获取
function jdQuerySummary(accounts){const done=accounts.filter(a=>a.status==='completed');const resolved=accounts.filter(a=>['completed','finance-only','none'].includes(a.status));return {status:resolved.length===accounts.length?'completed':resolved.length?'partial':'failed',amountCents:done.length?done.reduce((n,a)=>n+a.amountCents,0):null,error:resolved.length===accounts.length?'':'部分推广账户未获取，请补查'};}
// 落在财务记录页而非收支汇总时的用户口径：账户名带「财务」是纯财务授权号（财务号），否则按无推广
function jdRecordPageStatus(accountName){return /财务/.test(String(accountName||''))?'finance-only':'none';}
// 负向判定（财务号/无）落库前核对：该账户上次查到过推广费却本次判负向 → 按失败处理（页面疑似未加载完成），绝不静默降级
function judgeNegativeAccount(prior,kind,note){
 const money=prior&&prior.status==='completed'&&Number.isSafeInteger(prior.amountCents)&&prior.amountCents>0?prior.amountCents:null;
 if(money)return {status:'failed',error:'上次查到推广费 '+(money/100).toFixed(2)+' 元，本次页面未见「收支汇总」入口，疑似页面未加载完成，请补查'};
 return {status:kind,error:String(note||'').slice(0,160)};
}
// 整店负向（授权列表/财务管理入口缺失）同样核对历史金额，有历史金额就抛错补查而非整店判无
function assertNegativeShopAllowed(priorAccounts){
 const money=(priorAccounts||[]).filter(r=>r.status==='completed'&&Number.isSafeInteger(r.amountCents)&&r.amountCents>0).reduce((n,r)=>n+r.amountCents,0);
 if(money>0)throw Error('京东当前未见推广授权或财务管理入口，但上次查到推广费 '+(money/100).toFixed(2)+' 元，疑似页面未加载完成，请补查');
}
class JdPromotionFee{
 constructor({host}){this.host=host;this.attempted=new Set();this.recordPageNote='';}
 showAuth(win){this.host.assertWindow(win);if(this.host.backgroundOnly)throw Error('该店需要京东人工登录或验证，请切换到该店认证后补查');if(this.host.hidden)return;this.host.showProblem(win);}
 async observe(win,input={}){const wc=this.host.assertWindow(win);let best={status:'unknown'};const seen=new Map();const shown=async f=>{if(!f.parent)return true;if(seen.has(f))return seen.get(f);if(!await shown(f.parent))return false;const slots=await this.host.execute(win,`Array.from(document.querySelectorAll('iframe,frame'),e=>({name:e.name,url:e.src,visible:e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden="true"]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0'&&getComputedStyle(e).opacity!=='0')}))`,false,f.parent);const named=f.name?slots.filter(s=>s.name===f.name):[],match=named.length===1?named:slots.filter(s=>s.url===f.url);const yes=match.length===1?match[0].visible:!match.length&&slots.length===1?slots[0].visible:false;seen.set(f,yes);return yes;};for(const f of wc.mainFrame.framesInSubtree){try{const u=new URL(f.url);if(u.protocol!=='https:'||!u.hostname.endsWith('.jd.com')||input.credentials&&u.hostname!=='passport.shop.jd.com')continue;if(!await shown(f))continue;this.host.assertWindow(win);const inspect=credentials=>this.host.execute(win,'('+jdPage.toString()+')('+JSON.stringify({...input,credentials,fillOnly:credentials?.fillOnly??input.fillOnly})+')',true,f);const state=input.credentials?await require('./native-login.cjs').operate(this.host,win,f,inspect,{...input.credentials,fillOnly:input.fillOnly}):await inspect(undefined);if(['verification','agreement','blocked','rejected','submitted','prepared','filled','manual','untrusted'].includes(state.status))return state;if(['logged_in','merchant'].includes(state.status))best=state;else if(state.status==='form'&&!['logged_in','merchant'].includes(best.status))best=state;}catch{this.host.assertWindow(win);}}return best;}
 async login(shop,win,{revalidate=false}={}){
  if(win.promotionKeepAlive&&shop.jdLoginAccountId){
   const current=await this.observe(win);
   if(current.status==='logged_in'){if(current.accountId!==shop.jdLoginAccountId){this.host.markLoginRequired(shop);throw Error('京东登录账户身份已变化，请核对账号');}if(!revalidate){win.hide();return current;}}
   if(['verification','agreement'].includes(current.status)){this.host.markLoginRequired(shop);this.showAuth(win);return this.waitForAuth(shop,win);}
   if(['blocked','rejected'].includes(current.status)){this.host.markLoginRequired(shop);if(current.status==='blocked')this.showAuth(win);throw Error(current.message||'京东账号或密码错误，请编辑该账号');}
  }
  const resumeUnknown=this.host.hasLoginAttempt(shop)||this.attempted.has(shop.sessionKey);let merchantOpened=!(shop.loginConfirmedAt||shop.jdLoginAccountId),merchantForwarded=false,switchTabs=0;await this.host.load(win,merchantOpened?MERCHANT_HOME:HOME);for(let n=0;n<100;n++){this.host.assertWindow(win);const s=await this.observe(win);if(['form','verification','agreement','blocked','rejected'].includes(s.status))this.host.markLoginRequired(shop);if(s.status==='logged_in'){win.hide();return s;}if(s.status==='merchant'){if(!merchantForwarded){for(let i=0;i<50;i++){if(await this.host.execute(win,'('+jdNavigation.toString()+')("京准通",true)',true)){merchantForwarded=true;break;}await wait(200);}if(!merchantForwarded)throw Error('京麦未显示京准通入口');}await wait(300);continue;}if(s.status==='blocked'){this.showAuth(win);throw Error(s.message);}if(s.status==='rejected')throw Error('京东账号或密码错误，请编辑该账号');if(['verification','agreement'].includes(s.status)){this.showAuth(win);this.host.phase='等待 '+(shop.name||'该账号')+' 完成京东认证';return this.waitForAuth(shop,win);}if((s.status==='form'&&s.loginHost!=='passport.shop.jd.com'||s.status==='unknown'&&n>=10)&&!merchantOpened){merchantOpened=true;await this.host.load(win,MERCHANT_HOME);continue;}if(s.status==='form'&&s.loginHost&&resumeUnknown){this.showAuth(win);const password=this.host.safeStorage.decryptString(Buffer.from(shop.secret,'base64'));for(let t=0;t<3;t++){const prefilled=await this.observe(win,{credentials:{username:shop.username,password},fillOnly:true});if(prefilled.status!=='switched')break;await wait(400);}return this.waitForAuth(shop,win,'上次京东登录结果未确认：空白账号密码框仅自动填入，请在官方窗口手动确认并点击立即登录');}
 if(s.status==='form'&&s.loginHost&&!this.attempted.has(shop.sessionKey)&&!this.host.hasLoginAttempt(shop)){this.host.beginLoginAttempt(shop);this.attempted.add(shop.sessionKey);const password=this.host.safeStorage.decryptString(Buffer.from(shop.secret,'base64'));const filled=await this.host.submitLogin(win,credentials=>this.observe(win,{credentials}),{username:shop.username,password});
   // 停在扫码/短信页签时第一段只会切页签，没有提交：撤销检查点，下一轮再正常填写。
   if(filled.status==='switched'){this.host.finishLoginAttempt(shop);this.attempted.delete(shop.sessionKey);switchTabs+=1;if(switchTabs>4){this.showAuth(win);return this.waitForAuth(shop,win,'请在京东官方窗口手动切换到账号密码登录并完成登录');}await wait(400);continue;}
   // 页面结构与预期不符（找不到提交按钮或字段被改写）：打开窗口交人工，不空转 30 秒也不拖住整批。
   if(filled.status==='manual'){this.showAuth(win);throw Error('京东登录页需要手动填写：官方窗口已打开，请完成登录后补查该账号');}
   if(['verification','agreement'].includes(filled.status)){this.showAuth(win);return this.waitForAuth(shop,win);}if(filled.status==='rejected')throw Error('京东账号或密码错误，请编辑该账号');}await wait(300);}throw Error('京东京准通登录未完成，未重复提交账号');}
 async waitForAuth(shop,win,reason=''){this.host.phase=reason||'等待 '+(shop.name||'该账号')+' 完成京东认证';const deadline=Date.now()+15*60*1000;while(Date.now()<deadline){this.host.assertWindow(win);const s=await this.observe(win);if(s.status==='logged_in'){win.promotionKeepAlive=true;win.hide();return s;}if(s.status==='merchant'){await this.host.load(win,s.links[0]?.url||HOME);continue;}if(s.status==='blocked'){this.showAuth(win);throw Error(s.message);}if(s.status==='rejected')throw Error('京东账号或密码错误');await wait(350);}throw Error('京东人工认证等待超时，请补查');}
 async navigate(win,label){
  const locate=()=>this.readPage(win,'('+jdNavTarget.toString()+')('+JSON.stringify(label)+')');
  const point=await locate();this.host.assertWindow(win);if(point?.action!=='ready')return false;
  await this.stableClick(win,locate,{stage:'京东导航 '+label,action:'ready'});return true;
 }
 async financePage(win){this.recordPageNote='';for(const label of ['财务管理','财务记录'])await this.navigateReady(win,label);return await this.navigateReady(win,'收支汇总');}
 // 判财务号/无之前的最后探测：遍历所有 frame 找放宽匹配的汇总入口
 async widenedSummaryProbe(win){
  for(const frame of this.jdFrames(win)){
   try{const hit=await this.host.execute(win,'('+jdWidenedSummary.toString()+')()',true,frame);if(hit)return hit;}catch(e){}
  }
  return null;
 }
 // 新版 xnjzt 页面主体在子 iframe 里：就绪判定、入口点击、诊断都要遍历所有可信 frame
 jdFrames(win){
  const wc=this.host.assertWindow(win);
  let list=[wc];try{list=wc&&wc.mainFrame&&wc.mainFrame.framesInSubtree?wc.mainFrame.framesInSubtree:[wc];}catch{return [wc];}
  return list.filter(frame=>{const url=(frame&&frame.url)||(wc&&wc.url)||'';if(!url||url.startsWith('data:'))return true;try{return new URL(url).hostname.endsWith('.jd.com');}catch{return true;}});
 }
 // 财务入口一直不就绪时读取各 frame 实际状态：入口改名、藏进卡片还是页面换了
 async financeDiagnostics(win){
  const frames=[];
  for(const frame of this.jdFrames(win)){
   try{
    const d=await this.host.execute(win,'(()=>{const clean=s=>String(s||"").replace(/\\s+/g," ").trim();const visible=e=>e.getClientRects().length>0&&!e.closest("[hidden],[aria-hidden=true]")&&getComputedStyle(e).visibility!=="hidden"&&getComputedStyle(e).display!=="none";const text=e=>clean(e.innerText||"");const uniq=list=>[...new Set(list)];const financeTexts=uniq([...document.querySelectorAll("a,button,span,div")].filter(visible).map(text).filter(t=>t&&t.length<=12&&/财务/.test(t))).slice(0,8);const tabs=uniq([...document.querySelectorAll("a,button,span,div,li,[role=tab]")].filter(visible).map(text).filter(t=>t&&t.length<=10&&/记录|汇总|余额|充值|消费|分配|冻结|发票/.test(t)&&!/财务/.test(t))).slice(0,10);const moneyTexts=uniq([...document.querySelectorAll("span,div,p,td,th,label")].filter(visible).map(text).filter(t=>t&&t.length<=16&&/合计|金额|余额|消费|推广费/.test(t)&&!tabs.includes(t)&&!financeTexts.includes(t))).slice(0,8);const placeholders=uniq([...document.querySelectorAll("input")].map(i=>clean(i.placeholder)).filter(Boolean)).slice(0,6);const summaryHits=uniq([...document.querySelectorAll("a,button,span,div,li,h1,h2,h3,h4,h5,[role=tab]")].filter(e=>text(e).includes("收支汇总")).slice(0,5).map(e=>e.tagName+"."+String(e.className).slice(0,30)+(visible(e)?"":"(隐藏)")));return {frame:location.href.slice(0,100),financeTexts,tabs,moneyTexts,placeholders,summaryHits,body:clean(document.body.innerText).slice(0,120)};})()',false,frame);
    if(d)frames.push(d);
   }catch{}
  }
  return {frames:frames.slice(0,4)};
 }
 // 「无/财务号」属于超时启发式负向判定：先重载页面复判一次，两次一致才接受，避免页面渲染慢误伤有数据的账户
 async navigateReady(win,label){
  const attempt=async()=>{try{return {value:await this.navigateReadyOnce(win,label)};}catch(error){if(error.promotionNone)return {none:error};return {error};}};
  const first=await attempt();
  if(first.error)throw first.error;
  if(!first.none&&first.value!=='financeOnly')return first.value;
  try{await this.reloadAndWait(win);}catch{}
  const second=await attempt();
  if(second.error)throw second.error;
  if(second.none)throw second.none;
  return second.value;
 }
 async reloadAndWait(win){const wc=this.host.assertWindow(win).webContents;try{wc.reload();}catch{}const until=Date.now()+4000;while(Date.now()<until){await wait(150);try{if(!wc.isLoading())break;}catch{break;}}await wait(300);}
 async navigateReadyOnce(win,label){
  const until=Date.now()+(this.host.pageReadyTimeoutMs||45000);
  const readyScript='('+jdFinanceReady.toString()+')('+JSON.stringify(label)+','+jdNavTarget.toString()+')';
  const clickScript='('+jdFrameClick.toString()+')('+JSON.stringify(label)+')';
  // 新版账户中心「收支汇总」页签结构非标准：精确匹配失败后用容错匹配点它
  const summaryScript=label==='收支汇总'?'('+jdSummaryTab.toString()+')()':null;
  // 新版账户中心用 URL hash 表达进度（财务管理→#/financial，财务记录→#/financialRecord），同名入口重复无法用唯一性判定就绪
  const progress=label==='财务管理'?/#\/financial/:label==='财务记录'?/#\/financialRecord/:null;
  let clicked=false,clickedSummary=false;
  while(Date.now()<until){
   this.host.assertWindow(win);
   for(const frame of this.jdFrames(win)){
    try{if(await this.host.execute(win,readyScript,false,frame))return;}catch{}
   }
   if(progress){
    for(const frame of this.jdFrames(win)){
     try{if(progress.test(frame.url||''))return;}catch{}
    }
   }
   if(!clicked){
    clicked=await this.navigate(win,label);
    for(const frame of this.jdFrames(win)){
     try{if(!clicked&&await this.host.execute(win,clickScript,false,frame))clicked=true;}catch{}
    }
    if(!clicked&&summaryScript){
     for(const frame of this.jdFrames(win)){
      try{if(await this.host.execute(win,summaryScript,false,frame)){clicked=true;clickedSummary=true;break;}}catch{}
     }
    }
   }
   await wait(200);
  }
  const diag=await this.financeDiagnostics(win);
  const frames=diag&&diag.frames||[];
  const parts=frames.map(d=>'页面['+d.frame+']'+(d.financeTexts&&d.financeTexts.length?'含「财务」文本['+d.financeTexts.slice(0,5).join(' / ')+']':'无「财务」入口文本')+(d.tabs&&d.tabs.length?' 栏目['+d.tabs.slice(0,6).join(' / ')+']':'')+(d.moneyTexts&&d.moneyTexts.length?' 金额字段['+d.moneyTexts.slice(0,6).join(' / ')+']':'')+(d.placeholders&&d.placeholders.length?' 输入框['+d.placeholders.slice(0,4).join(' / ')+']':'')+(d.summaryHits&&d.summaryHits.length?' 汇总入口['+d.summaryHits.slice(0,4).join(' / ')+']':''));
  if(clickedSummary)throw Error('京东已点中「收支汇总」入口，但金额字段未识别，未继续读取'+(parts.length?'；诊断：'+parts.join('；'):''));
  // 以前推广、现在没推广的账户：页面已加载（京东域）但任何 frame 都没有「财务」入口——按「无」处理而非报错
  if(label==='财务管理'&&frames.length&&frames.every(d=>!(d.financeTexts&&d.financeTexts.length))&&frames.some(d=>/\.jd\.com/.test(d.frame||''))){const e=Error('京东该账户当前无财务管理入口（当前无推广）');e.promotionNone=true;throw e;}
  // 用户口径：进入财务记录后页面没有「收支汇总」页签的账户是纯财务授权号（财务号），不报错，由上层直接输出「财务号」；页签存在只是点不中时仍报错并附诊断，避免把可查账户误判成财务号
  if(label==='收支汇总'){
   const summaryVisible=frames.some(d=>(d.summaryHits||[]).some(h=>!h.includes('(隐藏)')));
   const recordEvidence=frames.some(d=>/#\/financialRecord/.test(d.frame||'')||(d.tabs||[]).some(t=>/充值记录|消费记录|分配记录|冻结记录/.test(t)));
   if(!summaryVisible&&recordEvidence){
    // 实测有推广费的账户也会落在财务记录页（页签懒加载/入口改名）：放宽匹配做最后探测，
    // 找到疑似汇总入口就按失败补查处理，绝不静默判成财务号/无
    const widened=await this.widenedSummaryProbe(win);
    if(widened)throw Error('京东「收支汇总」入口疑似存在但未就绪（候选「'+widened+'」），请补查');
    this.recordPageNote='判定依据：财务记录页未见「收支汇总」入口（栏目['+frames.flatMap(d=>d.tabs||[]).slice(0,4).join('/')||'无'+']）';
    return 'financeOnly';
   }
   // 页面连财务记录证据都没有：多半是网络卡顿没渲染出来，按可重新抓取的失败处理，不误判成财务号/无
   if(!summaryVisible&&!recordEvidence)throw Error('京东财务页面未加载完成（可能网络卡顿），请重新抓取'+(parts.length?'；诊断：'+parts.join('；'):''));
  }
  throw Error('京东'+label+(clicked?'导航后目标页面未就绪':'可操作入口未就绪')+'，未继续读取'+(parts.length?'；诊断：'+parts.join('；'):''));
 }
 async waitBody(win,needle,timeout=45000){const words=Array.isArray(needle)?needle:[needle];const until=Date.now()+timeout;while(Date.now()<until){this.host.assertWindow(win);for(const frame of this.jdFrames(win)){try{const body=await this.host.execute(win,'document.body.innerText',false,frame);if(words.some(w=>body&&body.includes(w)))return;}catch{}}await wait(200);}throw Error('京东页面未显示'+words.join(' 或 '));}
 async authorizationState(win){return this.readPage(win,'('+jdAuthorizationPage.toString()+')()');}
 // 授权列表一直不就绪时，读取页面实际状态帮助定位：入口变了、表头改名还是页面结构换了
 async authorizationDiagnostics(win){
  try{return await this.readPage(win,'(()=>{const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest("[hidden],[aria-hidden=true]")&&getComputedStyle(e).visibility!=="hidden"&&getComputedStyle(e).display!=="none";const clean=s=>String(s||"").replace(/\\s+/g," ").trim();const headers=[...document.querySelectorAll(".jad-table,table,[role=table]")].filter(visible).map(t=>[...t.querySelectorAll("thead th,[role=columnheader]")].map(th=>clean(th.innerText)).filter(Boolean).join("|")).filter(Boolean).slice(0,6);return {url:location.origin+location.pathname,headers,body:clean(document.body.innerText).slice(0,140)};})()');
  }catch{return null;}
 }
 async waitAuthorizations(win,previous=null){
  try{return await this.waitAuthorizationsOnce(win,previous);}catch(error){
   // 仅首次列表加载的「无推广」判定复判（重载后列表可能只是加载慢）；翻页场景不复判，避免丢分页状态
   if(!error.promotionNone||previous)throw error;
  }
  try{await this.reloadAndWait(win);}catch{}
  return this.waitAuthorizationsOnce(win,null);
 }
 async waitAuthorizationsOnce(win,previous=null){
  const until=Date.now()+(this.host.pageReadyTimeoutMs||45000);let last='',stable=0,reason='授权列表尚未就绪';
  while(Date.now()<until){
   this.host.assertWindow(win);const state=await this.authorizationState(win);if(state.error)throw Error(state.error);reason=state.reason||reason;
   const changed=!previous||state.pageNumber&&previous.pageNumber&&state.pageNumber!==previous.pageNumber||state.signature!==previous.signature;
   if(state.ready&&!state.loading&&(state.rows.length||state.empty)&&changed){const key=state.pageNumber+':'+state.signature;stable=key===last?stable+1:1;last=key;if(stable>=3)return state;}else{last='';stable=0;}
   await wait(200);
  }
  const diag=await this.authorizationDiagnostics(win);
  // 子账号无推广授权：页面已加载但始终没有授权列表表格，正文是子账号信息卡（子账号类型/主账号）而非列表——按「无」处理而非报错
  if(diag&&!diag.headers.length&&diag.body&&/子账号类型|主账号：/.test(diag.body)){const e=Error('京东该账户当前无推广授权（授权页只有账户信息，无授权列表）');e.promotionNone=true;throw e;}
  const extra=diag?'；诊断：页面位于 '+diag.url+(diag.headers.length?'，可见表头['+diag.headers.slice(0,4).join(' / ')+']':'，无可见表格')+'，页面开头「'+diag.body+'」':'';
  throw Error('京东授权列表未就绪：'+reason+'，尚未判定授权是否过期'+extra);
 }
 async nextAuthorizationPage(win,state,seenCount=0){
  const until=Date.now()+(this.host.pageReadyTimeoutMs||45000),previous=state;
  while((!state.ready||state.loading||!state.hasNext)&&Date.now()<until){
   this.host.assertWindow(win);if(state.ready&&!state.loading&&state.total!==null&&state.total<=seenCount)return null;
   await wait(200);state=await this.authorizationState(win);if(state.error)throw Error(state.error);
   if(!state.ready||state.loading)continue;
   if(state.signature!==previous.signature||state.pageNumber!==previous.pageNumber)throw Error('京东授权列表在翻页前变化，未跳过账户');
  }
  if(!state.ready||state.loading||!state.hasNext)throw Error('京东授权分页尚未就绪，未确认末页，未遗漏后续账户');
  await this.stableClick(win,()=>this.readPage(win,'('+jdAuthorizationPage.toString()+')({action:"next"})'),{stage:'京东授权列表下一页',action:'ready'});
  return this.waitAuthorizations(win,state);
 }
 async openAuthorizationList(win){
  const current=await this.authorizationState(win);if(current.error)throw Error(current.error);if(current.ready)return this.waitAuthorizations(win);
  let opened=false,lastUrl=await this.host.execute(win,'location.href').catch(()=>'');
  for(let n=0;n<60;n++){
   this.host.assertWindow(win);
   if(await this.authorizationState(win).then(s=>s.ready).catch(()=>false))break;
   const url=await this.host.execute(win,'location.href').catch(()=>lastUrl);
   if(url!==lastUrl){lastUrl=url;await wait(400);continue;}
   let clicked=false;
   if(n%2===1){const entry=await this.host.execute(win,'('+jdAuthorizeGo.toString()+')()').catch(()=>null);if(entry&&entry.action==='ready'){await this.stableClick(win,()=>this.host.execute(win,'('+jdAuthorizeGo.toString()+')()'),{stage:'京东账号授权入口',action:'ready'});clicked=true;}}
   if(!clicked&&await this.navigate(win,'账号授权'))clicked=true;
   if(clicked)opened=true;
   else if(n%6===0){const point=await this.host.execute(win,'('+jdAccountTrigger.toString()+')()');if(point){win.webContents.sendInputEvent({type:'mouseMove',x:10,y:100});win.webContents.sendInputEvent({type:'mouseMove',...point});}}
   await wait(250);
  }
  if(!opened){const url=await this.host.execute(win,'location.origin+location.pathname').catch(()=>'');throw Error('京东账号授权入口未找到（页面位于 '+url+'），尚未确认主账户权限，请补查');}
  return this.waitAuthorizations(win);
 }
 async listAuthorizations(win){
  const rows=[];let state=await this.waitAuthorizations(win);
  if(state.pageNumber&&state.pageNumber!==1)throw Error('京东授权列表未从第一页开始，未遗漏前页账户');
  for(let page=0;page<100;page++){
   rows.push(...state.rows.map(row=>({...row,page})));
   if(state.total!==null&&rows.length>=state.total){if(rows.length!==state.total)throw Error('京东授权记录数与总数不符，未遗漏账户');return authorizationSummary(rows);}
   state=await this.nextAuthorizationPage(win,state,rows.length);if(!state)return authorizationSummary(rows);
  }throw Error('京东授权列表翻页未完成');
 }
 async authorizationPageAt(win,target){
  await this.host.load(win,target.listURL);let state=await this.waitAuthorizations(win);
  if(state.pageNumber&&state.pageNumber!==1)throw Error('京东授权列表未回到第一页，未打开错误账户');
  for(let page=0;page<target.page;page++){const next=await this.nextAuthorizationPage(win,state,0);if(!next)throw Error('京东目标授权页未确认');state=next;}
  const until=Date.now()+(this.host.pageReadyTimeoutMs||45000);
  while(Date.now()<until){
   this.host.assertWindow(win);if(state.error)throw Error(state.error);
   if(state.ready&&!state.loading){const rows=state.rows.filter(r=>r.accountId===target.accountId);if(!rows.some(r=>r.active))throw Error('京东目标账户当前没有生效授权，已跳过过期记录');if(rows.some(r=>r.active&&r.canLogin))return state;}
   await wait(200);state=await this.authorizationState(win);
  }
  throw Error('京东生效授权的登录入口尚未可用，未点击过期记录');
 }
 async authorizedAccount(shop,win,target){
  let child;const trusted=url=>{try{const u=new URL(url);return u.protocol==='https:'&&u.hostname.endsWith('.jd.com');}catch{return false;}};
  if(!win.webContents.session.__shimaShopReady)win.webContents.session.webRequest.onBeforeRequest({urls:['http://xnjzt.jd.com/*']},(details,callback)=>callback({redirectURL:details.url.replace('http:','https:')}));
  await win.webContents.session.__shimaShopReady;this.host.assertWindow(win);
  win.webContents.setWindowOpenHandler(({url})=>url==='http://xnjzt.jd.com/'||url===''||url==='about:blank'||trusted(url)?{action:'allow',overrideBrowserWindowOptions:{show:false,webPreferences:{partition:'persist:promotion-fee:'+shop.sessionKey,nodeIntegration:false,contextIsolation:true,sandbox:true}}}:{action:'deny'});
  const created=w=>{if(this.host.stopped||this.host.writeFailure){w.destroy();return;}child=w;w.promotionPlatform='jd';for(const event of ['will-navigate','will-redirect'])w.webContents.on(event,(e,url)=>{if(url.startsWith('http://xnjzt.jd.com/')){e.preventDefault();void this.host.load(w,url.replace('http:','https:')).catch(()=>{});}else if(!trusted(url))e.preventDefault();});w.webContents.setWindowOpenHandler(({url})=>{if(trusted(url))void this.host.load(w,url).catch(()=>{});return {action:'deny'};});w.on('closed',()=>{if(this.host.stopped&&!win.isDestroyed())win.destroy();});this.host.windows.set(shop.id,w);};win.webContents.once('did-create-window',created);
  try{const clicked=await this.host.execute(win,'('+jdAuthorizationPage.toString()+')('+JSON.stringify({action:'login',accountId:target.accountId})+')',true);if(!clicked)throw Error('京东目标账户当前无生效且可登录的授权记录，未打开过期记录');for(let n=0;n<100;n++){this.host.assertWindow(child||win);if(child){let s=await this.observe(child);if(['verification','agreement'].includes(s.status)){this.showAuth(child);s=await this.waitForAuth(shop,child);}if(s.status==='blocked')throw Error(s.message);if(s.status==='logged_in'){if(s.accountId!==target.accountId)throw Error('京东免密登录账户不匹配，未读取金额');return child;}}await wait(200);}throw Error('京东已授权账户登录未完成');}catch(e){if(child&&!child.isDestroyed())child.destroy();throw e;}finally{win.webContents.removeListener('did-create-window',created);}
 }
 async readAccount(shop,win,dates,accountId,accountName=''){
  const receipt=new JdLedgerReceipt({host:this.host,win,dates});await receipt.open();try{this.host.phase='正在读取京东推广账户 '+accountId;const nav=await this.financePage(win);if(nav==='financeOnly'){if(jdRecordPageStatus(accountName)==='finance-only')return {financeOnly:true,note:this.recordPageNote};const e=Error('京东该账户落在财务记录页且账户名不含「财务」（无推广）'+(this.recordPageNote?'；'+this.recordPageNote:''));e.promotionNone=true;throw e;}await this.waitBody(win,['推广费消费金额','推广费总额']);await this.setDates(win,dates);return await this.ledger(win,dates,accountId,receipt,accountName);}finally{receipt.close();}
 }
 clickPoint(win,point){return pressPoint(this.host,win,point);}
 async stableClick(win,locate,options){return clickStable(this.host,win,locate,options);}
 async readPage(win,script){
  // Electron may replace renderer exceptions with a generic message. Preserve read failures explicitly.
  const wrapped='(()=>{try{return {__shimaRead:true,value:('+script+')}}catch(error){return {__shimaRead:true,error:String(error.message||error)}}})()';
  const result=await (this.host.readPage?this.host.readPage(win,wrapped):this.host.execute(win,wrapped));this.host.assertWindow(win);
  if(result?.__shimaRead){if(result.error)throw Error(result.error);return result.value;}return result;
 }
 async dateState(win){const state=await this.readPage(win,'('+jdDateState.toString()+')()');this.host.assertWindow(win);return state;}
 async waitDate(win,test,timeout=4000){const until=Date.now()+timeout;while(Date.now()<until){this.host.assertWindow(win);const state=await this.dateState(win);if(test(state))return state;await wait(100);}return null;}
 async closeCalendar(win){
  if(!(await this.dateState(win)).open)return;
  for(const type of ['keyDown','keyUp'])this.host.assertWindow(win).sendInputEvent({type,keyCode:'ESC'});
  if(await this.waitDate(win,s=>!s.open,1000))return;
  const code='('+jdCalendarDismiss.toString()+')()';
  const point=await this.readPage(win,code);this.host.assertWindow(win);
  if(point){
   await this.stableClick(win,async()=>!(await this.dateState(win)).open?{done:true}:this.readPage(win,code),{stage:'关闭日期面板的静态标题'});
   if(await this.waitDate(win,s=>!s.open,2000))return;
  }
  if(!(await this.dateState(win)).open)return;
  throw Error('京东日期面板未关闭（Esc及面板外安全点击未确认生效），未继续选择日期');
 }
 async setDates(win,dates){
  let reason='京东日期选择未生效';
  // 仅日期筛选允许重置后重试一次；认证、授权和提交检查点不在此重试。
  for(let attempt=0;attempt<2;attempt++){
   this.host.assertWindow(win);try{await this.closeCalendar(win);}catch(error){this.host.assertWindow(win);if(attempt)throw Error(reason+'；'+error.message);throw error;}
   let input;for(let n=0;n<60;n++){input=await this.readPage(win,'('+jdDateInput.toString()+')()');this.host.assertWindow(win);if(input?.action==='ready')break;if(input?.action==='waiting'&&/被遮挡/.test(input.reason||'')){await this.readPage(win,'('+jdDismissNotice.toString()+')()');this.host.assertWindow(win);}await wait(100);}
   if(input?.action!=='ready')throw Error(input?.reason||'日期筛选不可读，未点击');
   await this.stableClick(win,()=>this.readPage(win,'('+jdDateInput.toString()+')()'),{stage:'京东日期输入框',action:'ready'});
   if(!await this.waitDate(win,s=>s.open)){reason='京东日期面板未展开';continue;}
   let accepted=true;
   for(const [endpoint,date] of [dates.start,dates.end].entries()){
    let selected=false;
    for(let n=0;n<60;n++){
     const before=await this.dateState(win);this.host.assertWindow(win);
     const code='('+jdCalendar.toString()+')('+JSON.stringify(date)+')';
     const point=await this.readPage(win,code),action=point?.action||point;
     if(action==='waiting'){await wait(150);continue;}
     if(!['selected','moved'].includes(action))throw Error('京东日期不可选：'+date);
     await this.stableClick(win,()=>this.readPage(win,code),{stage:'京东日期 '+date,action});
     const changed=await this.waitDate(win,after=>action==='moved'?after.headers!==before.headers:after.selection!==before.selection||after.value!==before.value||after.cells!==before.cells||!after.open||endpoint===1&&!before.confirm&&!!after.confirm);
     if(!changed){let detail;try{const last=await this.dateState(win);detail='（点后面板'+(last.open?'仍开启':'已关闭')+'，输入值「'+(last.value||'空')+'」，选中标记['+String(last.selection||'无').slice(0,100)+']，单元格['+String(last.cells||'无').slice(0,150)+']）';}catch(error){detail='（点后控件状态不可读：'+error.message+'）';}reason='京东日期点击后控件未确认：'+date+detail;break;}
     if(action==='selected'){selected=true;break;}
    }
    if(!selected){accepted=false;break;}
   }
   if(!accepted)continue;
   const state=await this.dateState(win);if(state.open&&state.confirm)await this.stableClick(win,async()=>{const current=await this.dateState(win);return !current.open?{done:true}:current.confirm;},{stage:'京东日期确认按钮'});
   const matches=s=>{const pair=s.value.match(/\d{4}-\d{2}-\d{2}/g)||[];return !s.open&&pair[0]===dates.start&&pair[1]===dates.end;};
   let committed=await this.waitDate(win,matches);
   if(!committed&&state.open&&state.confirm){
    const current=await this.dateState(win);
    if(current.open&&(current.headers!==state.headers||current.selection!==state.selection||current.value!==state.value))throw Error('京东日期状态已变化，请重新选择');
    if(current.open&&current.confirm){
     await this.stableClick(win,async()=>{const next=await this.dateState(win);if(!next.open)return {done:true};if(next.headers!==current.headers||next.selection!==current.selection||next.value!==current.value)throw Error('京东日期状态已变化，请重新选择');return next.confirm;},{stage:'京东日期确认按钮'});
     committed=await this.waitDate(win,matches);
    }
   }
   if(committed)return;
   reason='京东日期选择未生效（控件未提交目标范围）';
  }
  throw Error(reason+'，未读取金额，请补查');
 }
 async ledger(win,dates,accountId,receipt,accountName=''){
  if(!receipt)throw Error('本轮账单刷新未确认，未读取金额');
  let last=null,count=0,recovered=false,financeOnly=false,financeNote='';
  const checkAuth=async()=>{
   const auth=await this.observe(win);
   if(['verification','agreement'].includes(auth.status)){
    receipt.reset();last=null;count=0;
    if(recovered)throw Error('京东账单再次要求验证，请人工确认后重新查询');
    recovered=true;this.showAuth(win);
    const confirmed=await this.waitForAuth({},win);
    if(confirmed.accountId!==accountId)throw Error('京东验证后账户身份不一致，未读取金额');
    const nav=await this.financePage(win);
    if(nav==='financeOnly'){financeOnly=jdRecordPageStatus(accountName)==='finance-only'?'financeOnly':'none';financeNote=this.recordPageNote;return false;}
    await this.waitBody(win,['推广费消费金额','推广费总额']);await this.setDates(win,dates);
    return false;
   }
   if(['form','logged_out','manual','blocked','rejected','untrusted','submitted','prepared','filled'].includes(auth.status)){
    receipt.reset();throw Error('京东账单认证未完成，未读取金额：'+(auth.reason||auth.message||auth.status));
   }
   if(auth.status==='logged_in'&&auth.accountId!==accountId){receipt.reset();throw Error('京东账单账户身份不一致，未读取金额');}
   return true;
  };
  for(let n=0;n<100;n++){
   if(!await checkAuth())continue;
   if(financeOnly)return financeOnly==='none'?{none:true,note:financeNote}:{financeOnly:true,note:financeNote};
   const value=await this.readPage(win,'('+jdLedger.toString()+')()');
   if(!await checkAuth())continue;
   const proof=receipt.proof();
   if(proof&&proof.amountCents===value.amountCents&&value.accountId===accountId&&value.start===dates.start&&value.end===dates.end&&value.amountCents!==null&&!value.loading){
    const key=proof.sequence+':'+value.amountCents;count=last===key?count+1:1;last=key;
    if(count>=3)return {...value,refreshProof:proof};
   }else{count=0;last=null;}
   await wait(300);
  }
  throw Error('未确认京东账户、记账时间和推广费金额，未返回数值');
 }
 async query(shop,dates,context={}){const host=this.host,parent=host.window(shop);const login=await host.authenticate(shop,parent);host.assertWindow(parent);const name=host.shop(shop.id).name;
 let targets,authorizationNotices=[];if(login.isSub){try{await this.openAuthorizationList(parent);const listURL=parent.webContents.getURL(),listed=await this.listAuthorizations(parent);authorizationNotices=listed.notices;host.check();context.onAuthorizationNotices?.(authorizationNotices);targets=listed.targets.map(t=>({...t,listURL}));}catch(e){if(e&&e.promotionNone){assertNegativeShopAllowed(context.priorAccounts);const noneAccounts=(context.priorAccounts||[]).map(r=>({...r,status:'none',amountCents:null,error:'',updatedAt:new Date().toISOString()}));if(!noneAccounts.length)noneAccounts.push({accountId:login.accountId||'',name:login.name||name,status:'none',amountCents:null,updatedAt:new Date().toISOString()});return {shopName:name,authorizationNotices,status:'completed',amountCents:null,error:'',accounts:noneAccounts,basis:'京东现金收支汇总·记账时间·推广费消费金额'};}throw e;}}else targets=[{accountId:login.accountId,name:login.name,direct:true}];
 const old=context.priorAccounts||[];if(old.length){const found=new Map(targets.map(t=>[t.accountId,t]));targets=old.map(r=>found.get(r.accountId)||{accountId:r.accountId,name:r.name,missing:true});}if(!targets.length)return {shopName:name,authorizationNotices,status:'failed',amountCents:null,error:'京东没有当前生效的授权推广账户，未查询过期记录',accounts:[]};
 const accounts=targets.map(t=>old.find(r=>r.accountId===t.accountId&&['completed','finance-only','none'].includes(r.status))||{accountId:t.accountId,name:t.name,status:'queued',amountCents:null}),publish=()=>context.onAccounts?.(accounts.map(a=>({...a})));publish();
 for(let i=0;i<targets.length;i++){host.check();const target=targets[i];if(accounts[i].status==='completed'||accounts[i].status==='finance-only'||accounts[i].status==='none')continue;let win=parent;const priorRow=old.find(r=>r.accountId===target.accountId);try{if(target.missing)throw Error('原目标账户授权已失效或不再可见');if(!target.direct){await this.authorizationPageAt(parent,target);win=await this.authorizedAccount(shop,parent,target);}const value=await this.readAccount(shop,win,dates,target.accountId,target.name||login.name||'');host.check();if(value.financeOnly||value.none){const kind=value.financeOnly?'finance-only':'none',judged=judgeNegativeAccount(priorRow,kind,value.note);accounts[i]={...accounts[i],name:target.name||target.accountId,status:judged.status,error:judged.error,amountCents:null,updatedAt:new Date().toISOString()};}else accounts[i]={...accounts[i],name:target.name||target.accountId,status:'completed',amountCents:value.amountCents,refreshProof:value.refreshProof,updatedAt:new Date().toISOString(),sourceUrl:win.webContents.getURL(),basis:'京东现金收支汇总·记账时间·推广费消费金额'};}catch(e){host.check();if(e&&e.promotionNone){const judged=judgeNegativeAccount(priorRow,'none',e.message);accounts[i]={...accounts[i],name:target.name||target.accountId,status:judged.status,error:judged.error,amountCents:null,updatedAt:new Date().toISOString()};}else{host.showProblem(e.promotionProblemWindow||win);accounts[i]={...accounts[i],status:'failed',error:e.message,amountCents:null,updatedAt:new Date().toISOString()};}}finally{if(win!==parent&&!win.isDestroyed())win.destroy();host.windows.set(shop.id,parent);}publish();}
 const summary=jdQuerySummary(accounts);return {shopName:name,authorizationNotices,status:summary.status,amountCents:summary.amountCents,accounts,error:summary.error,basis:'京东现金收支汇总·记账时间·推广费消费金额'};
 }

}
module.exports={JdPromotionFee,JdLedgerReceipt,jdPage,jdNavigation,jdNavTarget,jdFinanceReady,jdDateInput,jdDismissNotice,jdCalendar,jdDateState,jdCalendarDismiss,jdLedger,jdAccountTrigger,jdAuthorizationPage,authorizationSummary,HOME,jdQuerySummary,jdRecordPageStatus,judgeNegativeAccount,jdWidenedSummary};

