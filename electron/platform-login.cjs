const {createHash}=require('node:crypto');
const PLATFORMS={
 taobao:{name:'淘宝',partition:'persist:selection-workbench:taobao',home:'https://www.taobao.com/',login:'https://login.taobao.com/',domains:['taobao.com','tmall.com','alibaba.com'],loginHosts:['login.taobao.com','login.tmall.com','passport.alibaba.com']},
 qianniu:{name:'千牛',partition:'persist:selection-workbench:qianniu',home:'https://myseller.taobao.com/home.htm/QnworkbenchHome/',login:'https://login.taobao.com/member/login.jhtml?redirectURL=https%3A%2F%2Fmyseller.taobao.com%2Fhome.htm%2FQnworkbenchHome%2F',domains:['taobao.com','tmall.com','alibaba.com'],loginHosts:['login.taobao.com','login.tmall.com','passport.alibaba.com']}
};
function allowed(url,platform,loginOnly=false){try{const u=new URL(url),p=PLATFORMS[platform];return !!p&&u.protocol==='https:'&&!u.username&&!u.password&&(loginOnly?p.loginHosts.includes(u.hostname):p.domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)));}catch{return false;}}
function accountFor(accounts,platform){const p=PLATFORMS[platform];if(!p)throw Error('未知平台。');const row=accounts.find(a=>String(a.name||'').trim().replace(/账号$/,'')===p.name);return row?{username:String(row.username||'').trim(),password:String(row.password||'')}:{username:'',password:''};}
// Runs only in an approved HTTPS frame; credentials never enter an AI request or a returned snapshot.
function loginPage(config,credentials){
 const trusted=location.protocol==='https:'&&config.domains.some(d=>location.hostname===d||location.hostname.endsWith('.'+d));
 if(!trusted)return {status:'untrusted'};
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden="true"]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none');
 const nativeTarget=(el,action)=>{const r=el.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);const hit=document.elementFromPoint(x,y);if(x<0||y<0||x>=innerWidth||y>=innerHeight||!(hit===el||el.contains(hit)))return {status:'manual'};return {status:'native',action,x,y};};
 const text=(document.body?.innerText||'').slice(0,16000);
 const inputs=[...document.querySelectorAll('input')].filter(visible);
 const challenge=/拖动.{0,8}滑块|按住滑块|请完成验证|请通过验证|访问受限|访问过于频繁|身份验证|安全验证/.test(text)||inputs.some(e=>/验证码/.test(e.placeholder||''))||[...document.querySelectorAll('iframe,frame,#nc_1_wrapper,[id*="captcha" i],[class*="captcha" i]')].some(e=>visible(e)&&(e.tagName==='IFRAME'||e.tagName==='FRAME'?/_____tmd_____|captcha/i.test(e.src||''):true));
 if(challenge)return {status:'verification'};
 const loginHost=config.loginHosts.includes(location.hostname);
 const password=inputs.find(e=>e.type==='password');
 // 新版千牛登录页默认「短信登录」页签：密码框已渲染但 disabled。此时必须先切「密码登录」页签，
 // 否则填写被跳过（旧逻辑只认「页面上没有密码框」，把禁用框当成可填表单直接返回 manual）。
 const usablePassword=!!password&&!password.disabled&&!password.readOnly;
 const authenticated=[...document.querySelectorAll('.site-nav-login-info-nick,.site-nav-user-name,#login-info .sn-user-nick,[class*="userInfo--"] [class*="nickName--"],a[href*="logout"],a[href*="Logout"],button[data-action="logout"]')].some(e=>visible(e)&&((e.textContent||'').trim())&&!/请登录|立即登录/.test(e.textContent))||/退出登录|安全退出/.test(text);
 // A loaded seller header identifies the signed-in shop even while business
 // cards are empty, or on an editor route. Public product shop names do not.
 const sellerPage=config.name==='千牛'&&['qn.taobao.com','myseller.taobao.com','seller.taobao.com','sell.publish.tmall.com'].includes(location.hostname);
 const sellerHome=sellerPage&&['qn.taobao.com','myseller.taobao.com'].includes(location.hostname)&&location.pathname.startsWith('/home.htm');
 const validName=value=>{const name=String(value||'').trim().replace(/^店铺(?:名称|名)?\s*[：:]\s*/,'');return name.length>=2&&name.length<=60&&!/\n|请登录|请先登录|扫码登录|密码登录|短信登录/.test(name)&&!['店铺','店铺名称','我的店铺','切换店铺','选择店铺','全部店铺','店铺管理','千牛工作台','加载中','加载中...','--','管家','协议','下载','规则','消息','反馈','客服','运营'].includes(name)?name:'';};
 const shopMarker='[class*="shop-name" i],[class*="shopName" i],[class*="shop_name" i],[class*="store-name" i],[class*="storeName" i],[data-shop-name],[aria-label^="店铺名称"],[aria-label^="店铺名："]';
 const headerMarker='header,[role="banner"],[class*="header" i],[class*="topbar" i],[class*="top-bar" i]';
 const navLabels=['商品','交易','物流','店铺'].filter(label=>text.includes(label)).length;
 const headerCandidates=sellerPage?[...document.querySelectorAll(shopMarker+',a,span,div')].filter(e=>{
  if(!visible(e))return false;const r=e.getBoundingClientRect();
  if(r.top<0||r.top>Math.min(180,innerHeight*.3)||r.right<innerWidth*.55||r.left>=innerWidth||r.bottom<=0)return false;
  const marked=e.matches(shopMarker)||!!e.closest(shopMarker),name=validName(e.innerText||e.textContent);
  let avatar=false;for(let parent=e.parentElement,depth=0;parent&&depth++<3;parent=parent.parentElement){const box=parent.getBoundingClientRect();if(box.height>180||box.width>500)break;if([...parent.querySelectorAll('img,[class*="avatar" i]')].some(visible)){
    const first=[...parent.querySelectorAll('a,span,div')].find(n=>visible(n)&&(n.innerText||n.textContent||'').trim().length>=2&&[...n.children].every(c=>!(c.textContent||'').trim()));
    avatar=!!first&&(first===e||e.contains(first))&&validName(first.innerText||first.textContent)===name;break;
   }}
  return !!name&&(marked||avatar&&(/店$/.test(name)||navLabels>=2)||!!e.closest(headerMarker)&&/店$/.test(name)&&navLabels>=2);
 }):[];
 const headerShop=headerCandidates.find(e=>e.matches(shopMarker)||e.closest(shopMarker))||headerCandidates.find(e=>/店$/.test(validName(e.innerText||e.textContent)))||headerCandidates[0];
 const shopName=sellerHome&&[...document.querySelectorAll('h1,h2,h3,h4,a,span,div')].find(e=>visible(e)&&e.children.length===0&&/^[^\n]{2,60}(?:旗舰店|专卖店|专营店|企业店)$/.test((e.textContent||'').trim()));
 const sellerCounters=sellerHome?['待发货','待处理售后','待回复评价','待处理工单','待处理投诉','违规预警'].filter(label=>new RegExp(label+'\\s*[0-9][0-9,]*').test(text)).length:0;
 const loginPrompt=/请先登录|请登录|扫码登录|密码登录|短信登录/.test(text);
 const identityNode=headerShop||shopName;
 let avatarUrl='';
 if(identityNode){for(let parent=identityNode.parentElement,depth=0;parent&&depth++<3;parent=parent.parentElement){
  const box=parent.getBoundingClientRect();if(box.width>500||box.height>180)break;
  const marked=[...parent.querySelectorAll('[class*="avatar" i],[class*="shop-logo" i],[class*="shopLogo" i],[class*="shop_logo" i]')];
  const images=[...marked.flatMap(e=>e.tagName==='IMG'?[e]:[...e.querySelectorAll('img')]),...parent.querySelectorAll('img')];
  for(const e of [...new Set([...images,...marked])]){if(!visible(e))continue;
   const background=getComputedStyle(e).backgroundImage?.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
   try{const url=new URL(e.currentSrc||e.src||background||'',location.href);if(url.protocol==='https:'&&!url.username&&!url.password&&/(^|\.)(alicdn\.com|taobaocdn\.com)$/.test(url.hostname)){avatarUrl=url.href;break;}}catch{}
  }if(avatarUrl)break;
 }}
 if(!password&&!loginPrompt&&(authenticated&&(config.name!=='千牛'||sellerPage)||headerShop||sellerHome&&shopName&&sellerCounters>=2&&navLabels===4))return {status:'logged_in',avatarUrl,...(headerShop?{shopName:validName(headerShop.innerText||headerShop.textContent)}:shopName?{shopName:validName(shopName.textContent)}:{})};
 // Embedded seller login forms are explicit authentication evidence even
 // when the top document remains on the seller domain.
 if(!loginHost)return {status:password?'form':/请登录|请先登录|扫码登录/.test(text)?'logged_out':'unknown'};
 if(/密码错误|密码不正确|账号或密码|账户或密码|登录失败|账号被锁定/.test(text))return {status:'rejected'};
 if(!usablePassword){
  // 精确匹配页签文案，允许普通文本标签（新版页签是 span/div 而非 a/button）；命中后点最内层。
  const tab=[...document.querySelectorAll('a,button,[role="tab"],.password-login-tab-item,.tabs-tab,span,div,li')].filter(visible).filter(e=>/^(密\s*码登录|账号密码登录|帐号密码登录|账号登录)$/.test((e.textContent||'').trim()));
  const clickable=tab.find(e=>!tab.some(o=>o!==e&&e.contains(o)))||tab[0];
  if(clickable){const switchTarget=clickable.closest('a,button,[role="tab"],[class*="tab" i]')||clickable;if(credentials&&credentials.nativeInput)return nativeTarget(switchTarget,'switch');if(credentials){switchTarget.click();return {status:'switched'};}}
  return {status:'logged_out'};
 }
 const form=password.closest('form')||document.body;
 if(form.tagName==='FORM'){
  let action;try{action=new URL(form.getAttribute('action')||location.href,location.href);}catch{return {status:'untrusted'};}
  if(action.protocol!=='https:'||!config.loginHosts.includes(action.hostname))return {status:'untrusted'};
 }
 const username=[...form.querySelectorAll('input')].filter(visible).find(e=>e!==password&&e.type!=='hidden'&&/^(?:fm-login-id|username|loginId|login_id|userName|account|txtUserName|email)$/i.test(e.id||e.name)||visible(e)&&e!==password&&['text','email','tel'].includes(e.type)&&/账号|帐号|用户名|邮箱|手机号码/.test(e.placeholder||''));
 const submit=[...form.querySelectorAll('button,input[type="submit"],a,[role="button"],.login-btn,.login-button,#login-sub')].find(e=>visible(e)&&!e.disabled&&/^(登录|登 录|立即登录|登\s+录)$/.test((e.textContent||e.value||'').trim()));
 if(!username||!submit)return {status:'manual'};
 if(!credentials)return {status:'form'};
 if(credentials.stage!==undefined&&!['username','password','submit'].includes(credentials.stage))return {status:'manual'};
 if(username.disabled||username.readOnly||password.disabled||password.readOnly)return {status:'manual'};
 // force：自动登录的 DOM 兜底专用（2026-11-10 财务反馈「弹窗后账号密码经常没写入」）。
 // 原生逐字输入拿不到窗口焦点时会返回 manual，此时页面里可能残留上次记住的旧账号；
 // 默认语义仍是「已有值即交回人工」（不覆盖用户手输内容），只有 force 才允许覆盖写入。
 const force=!!credentials.force;
 if(credentials.fillOnly&&!force&&(username.value||password.value))return {status:'manual'};
 const set=(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
 const stage=credentials.stage;
 if(!force&&['password','submit'].includes(stage)&&username.value!==credentials.username)return {status:'manual'};
 if(!force&&stage==='password'&&password.value&&password.value!==credentials.password)return {status:'manual'};
 if(!force&&stage==='submit'&&password.value!==credentials.password)return {status:'manual'};
 if(credentials.nativeInput){if(stage==='username'&&username.value||stage==='password'&&password.value)return {status:'manual'};if(stage==='username'||stage==='password')return nativeTarget(stage==='username'?username:password,stage);}
 if(stage!=='submit'&&!credentials.nativeInput){
  if(stage!=='password')set(username,credentials.username);
  if(stage!=='username')set(password,credentials.password);
 }
 if(['username','password'].includes(stage))return {status:'prepared'};
 // Leave unchecked agreements and all verification challenges to the user.
 const agreementPending=[...form.querySelectorAll('input[type="checkbox"],[role="checkbox"]')].some(e=>{
  if(!visible(e)||(e.matches('input')?e.checked:e.getAttribute('aria-checked')==='true'))return false;
  const labels=[...(e.labels||[])].map(x=>x.textContent||'');
  const labelled=(e.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent||'');
  let near='';for(let n=e.nextSibling,count=0;n&&count++<4;n=n.nextSibling){if(n.nodeType===1&&n.matches('input,[role="checkbox"]'))break;near+=n.textContent||'';if(n.nodeType===1&&n.matches('label,div,p'))break;}
  const caption=[...labels,...labelled,e.getAttribute('aria-label'),e.closest('label')?.textContent,near].filter(Boolean).join(' ');
  if(/记住|保持登录|自动登录|remember/i.test(caption)&&!/协议|条款|隐私/.test(caption))return false;
  return /协议|条款|隐私|我已阅读|我同意|用户授权/.test(caption)||e.required||e.getAttribute('aria-required')==='true';
 });
 if(agreementPending)return {status:'agreement'};
 if(credentials.fillOnly)return {status:'filled'};
 if(credentials.nativeInput)return nativeTarget(submit,'submit');
 submit.click();return {status:'submitted'};
}
const observedShopChanged=(prior,current)=>!!(prior?.shopName&&current?.shopName&&prior.shopName.normalize('NFKC').trim()!==current.shopName.normalize('NFKC').trim());
const messages={account_changed:'登录账号已变更，请在官方窗口确认当前账号后重试。',unconfigured:'请在官方窗口完成登录。',verification:'请在官方窗口完成验证码、扫码或身份验证后，再继续原功能。',rejected:'登录未成功，请在官方窗口检查并重新登录。',agreement:'请在官方窗口阅读并确认登录协议，再继续原功能。',manual:'请在官方窗口完成登录后，再继续原功能。',unknown:'尚未确认登录状态，请在官方窗口核对后重试。',untrusted:'当前页面不属于允许填写账号的官方登录页，已停止自动填写。',logged_out:'请在官方窗口完成登录后，再继续原功能。'};
class PlatformLogin{
 constructor({BrowserWindow,readAccounts=async()=>[],beforeCheck=async()=>{},getWindow=()=>null,identityLabel=()=>'',emit=()=>{},now=Date.now,delay=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=20000}){Object.assign(this,{BrowserWindow,readAccounts,beforeCheck,getWindow,identityLabel,emit,now,delay,timeoutMs});this.windows=new Map();this.pending=new Map();this.pendingContexts=new Map();this.attempts=new Map();this.verified=new Map();this.lastStates=new Map();this.observers=new WeakMap();}
 async frames(wc,platform,credentials){
  if(wc.isDestroyed()||!allowed(wc.getURL(),platform))return {status:'untrusted'};
  const frames=wc.mainFrame?.framesInSubtree||[wc];let best={status:'unknown'};
  const visibility=new Map();
  const visibleFrame=async frame=>{
   if(!frame.parent)return true;if(visibility.has(frame))return visibility.get(frame);
   if(!await visibleFrame(frame.parent)){visibility.set(frame,false);return false;}
   let shown=true;
   try{const slots=await frame.parent.executeJavaScript(`Array.from(document.querySelectorAll('iframe,frame'),e=>({name:e.name||'',url:e.src||'',visible:e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden="true"]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden')}))`);
    const named=frame.name?slots.filter(s=>s.name===frame.name):[],matched=named.length===1?named:slots.filter(s=>s.url===frame.url);
    if(matched.length)shown=matched.some(s=>s.visible);else if(slots.length&&slots.every(s=>!s.visible))shown=false;
   }catch{/* Ambiguous frames stay eligible so a real login challenge is never hidden. */}
   visibility.set(frame,shown);return shown;
  };
  for(const frame of frames){
   if(!await visibleFrame(frame))continue;
   const url=frame.url||wc.getURL();if(!allowed(url,platform))continue;
   if(credentials&&!allowed(url,platform,true))continue;
   try{const result=await frame.executeJavaScript('('+loginPage.toString()+')('+JSON.stringify(PLATFORMS[platform])+','+JSON.stringify(credentials||null)+')',true);
    if(credentials&&['untrusted','verification','rejected','agreement','submitted','switched','form','manual','logged_out'].includes(result.status))return result;
    const priority={verification:100,untrusted:90,rejected:80,agreement:70,form:60,manual:50,logged_in:40,logged_out:30,unknown:0};
    if((priority[result.status]||0)>(priority[best.status]||0))best=result;
   }catch{/* Navigation races must not log the injected expression or credentials. */}
  }return best;
 }
 window(platform){
  let win=this.windows.get(platform);if(win&&!win.isDestroyed())return win;
  const p=PLATFORMS[platform];
  win=new this.BrowserWindow({parent:this.getWindow()||undefined,title:p.name+(platform==='qianniu'?'店铺登录':'买家登录')+(this.identityLabel(platform)?' · '+this.identityLabel(platform):''),show:false,width:1180,height:800,webPreferences:{partition:p.partition,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  this.windows.set(platform,win);win.setMenuBarVisibility(false);
  win.webContents.on('page-title-updated',event=>event.preventDefault());
  const wc=win.webContents;this.observe(platform,wc);wc.session.setUserAgent(wc.session.getUserAgent().replace(/[^\x20-\x7e]+/g,'ShimaWorkbench'));wc.setUserAgent(wc.session.getUserAgent());
  wc.setWindowOpenHandler(({url})=>{if(allowed(url,platform))void wc.loadURL(url).catch(()=>{});return {action:'deny'};});
  for(const event of ['will-navigate','will-redirect'])wc.on(event,(e,url)=>{if(!allowed(url,platform))e.preventDefault();});
  win.on('closed',()=>{this.windows.delete(platform);});return win;
 }
 publish(platform,status,{embedded=false,shopName='',avatarUrl=''}={}){let message=status==='logged_in'?(shopName?'已登录：'+shopName:'已登录，可继续使用。'):messages[status]||messages.manual;if(embedded)message=message.replaceAll('官方窗口','右侧千牛页面').replace('再继续原功能','再点击“继续上架”');const state={platform,name:PLATFORMS[platform].name,status,message,avatarUrl:status==='logged_in'?avatarUrl:'',...(status==='logged_in'&&shopName?{shopName}:{})};this.lastStates.set(platform,state);this.emit(state);return state;}
 async load(wc,url,signal){
  signal?.throwIfAborted();
  let timer,abort;
  try{await Promise.race([wc.loadURL(url),new Promise((_,reject)=>{
   timer=setTimeout(()=>{if(!wc.isDestroyed())wc.stop();reject(Error('登录页面加载超时。'));},15000);
   abort=()=>{if(!wc.isDestroyed())wc.stop();reject(signal.reason);};signal?.addEventListener('abort',abort,{once:true});
  })]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 async ensure(platform,{interactive=false,signal,force=false,webContents}={}){
  if(!PLATFORMS[platform])throw Error('未知平台。');signal?.throwIfAborted();
  if(this.pending.has(platform)){
   const context=this.pendingContexts.get(platform),pending=this.pending.get(platform);
   if(context&&context.webContents===webContents&&context.interactive===interactive&&context.force===force&&context.signal===signal)return pending;
   // Serialize account activity, then inspect this caller's actual page. A
   // different editor or interactive request must never inherit another result.
   await pending.catch(()=>{});signal?.throwIfAborted();
   return this.ensure(platform,{interactive,signal,force,webContents});
  }
  this.pendingContexts.set(platform,{interactive,signal,force,webContents});
  const pending=this.check(platform,{interactive,signal,force,webContents}).finally(()=>{this.pending.delete(platform);this.pendingContexts.delete(platform);});this.pending.set(platform,pending);return pending;
 }
 async check(platform,{interactive,signal,force,webContents}){
  await this.beforeCheck(platform);
  let account;try{account=accountFor(await this.readAccounts(),platform);}catch{throw Object.assign(Error('平台账号读取失败，请检查设置后重试。'),{code:'PLATFORM_LOGIN_UNCONFIRMED'});}
  const configured=!!(account.username&&account.password),fingerprint=createHash('sha256').update(JSON.stringify(account)).digest('hex');
  const prior=this.verified.get(platform),p=PLATFORMS[platform];
  const candidate=platform==='qianniu'&&webContents&&!webContents.isDestroyed()&&allowed(webContents.getURL(),platform)?webContents:null;
  const existing=candidate?await this.frames(candidate,platform):null;
  if(existing?.status==='logged_in'){
   if(configured&&prior&&prior.fingerprint!==fingerprint&&this.attempts.get(platform)!==fingerprint&&!observedShopChanged(prior,existing))return this.publish(platform,'account_changed',{embedded:true});
   this.verified.set(platform,{fingerprint,at:this.now(),avatarUrl:existing.avatarUrl,shopName:existing.shopName});this.attempts.delete(platform);return this.publish(platform,'logged_in',{avatarUrl:existing.avatarUrl,shopName:existing.shopName});
  }
  if(existing?.status==='verification'){if(interactive)this.getWindow()?.show();return this.publish(platform,'verification',{embedded:true});}
  const embedded=!!candidate&&(allowed(candidate.getURL(),platform,true)||candidate.getURL().split(/[?#]/)[0]===p.home||['form','logged_out','agreement','rejected','manual'].includes(existing?.status));
  if(!embedded&&!interactive&&!force&&this.lastStates.get(platform)?.status==='logged_in'&&prior?.fingerprint===fingerprint&&this.now()-prior.at<60000)return this.publish(platform,'logged_in',{avatarUrl:prior.avatarUrl,shopName:prior.shopName});
  // Authenticate in the already visible seller page. Unknown editor/receipt
  // pages are preserved; they may use the existing separate session probe.
  const win=embedded?{webContents:candidate,isDestroyed:()=>candidate.isDestroyed(),show:()=>{if(interactive)this.getWindow()?.show();},focus:()=>{if(interactive)candidate.focus();},hide:()=>{}}:this.window(platform),wc=win.webContents;
  // Automatic checks never foreground the main window. A separate login
  // window may be shown once without activation; explicit login remains interactive.
  const reveal=()=>{if(interactive)win.show();else if(!embedded&&!win.isVisible?.())win.showInactive?.();};
  const publish=(status,observed={})=>this.publish(platform,status,{embedded,avatarUrl:observed.avatarUrl,shopName:observed.shopName});
  if(interactive){win.show();win.focus();this.attempts.delete(platform);}
  const current=wc.getURL();
  if(!current||current==='about:blank'||!embedded&&(prior||force)){try{await this.load(wc,p.home,signal);}catch{signal?.throwIfAborted();if(!win.isDestroyed())reveal();return publish('unknown');}}
  const start=this.now();let redirected=false,last='unknown';
  while(this.now()-start<this.timeoutMs&&!win.isDestroyed()){
   signal?.throwIfAborted();
   if(wc.isLoadingMainFrame()){await this.delay(250);continue;}
   const result=await this.frames(wc,platform);last=result.status;
   if(last==='logged_in'){
    const bound=this.verified.get(platform);
    if(configured&&bound&&bound.fingerprint!==fingerprint&&this.attempts.get(platform)!==fingerprint&&!observedShopChanged(bound,result)){reveal();return publish('account_changed');}
    this.verified.set(platform,{fingerprint,at:this.now(),avatarUrl:result.avatarUrl,shopName:result.shopName});this.attempts.delete(platform);if(!interactive)win.hide();return publish('logged_in',result);
   }
   reveal();
   if(last==='rejected'&&configured&&this.attempts.get(platform)!==fingerprint&&!redirected){redirected=true;await this.load(wc,p.login,signal);continue;}
   if(['form','logged_out'].includes(last))this.verified.delete(platform);
   if(['verification','rejected','agreement','untrusted'].includes(last))return publish(last);
   if(!configured){
    if(last==='logged_out'&&!allowed(wc.getURL(),platform,true)&&!redirected){redirected=true;try{await this.load(wc,p.login,signal);}catch{signal?.throwIfAborted();return publish('unknown');}continue;}
    return publish(['unknown','untrusted'].includes(last)?last:'manual');
   }
   if((last==='logged_out'||last==='unknown'&&this.now()-start>1500)&&!allowed(wc.getURL(),platform,true)&&!redirected){redirected=true;try{await this.load(wc,p.login,signal);}catch{signal?.throwIfAborted();return publish('unknown');}continue;}
   if(this.attempts.get(platform)!==fingerprint){
    const filled=await this.frames(wc,platform,account);
    if(filled.status==='submitted')this.attempts.set(platform,fingerprint);
    if(['agreement','verification','rejected','untrusted'].includes(filled.status))return publish(filled.status);
   }else if(last==='rejected')return publish(last);
   await this.delay(350);
  }
  return publish(last==='unknown'?'unknown':'manual');
 }
 observe(platform,wc){
  if(this.observers.has(wc))return;let timer;
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(async()=>{if(wc.isDestroyed())return;const pending=this.pending.get(platform);if(pending)await pending.catch(()=>{});if(wc.isDestroyed()||!['logged_in','unconfigured','logged_out','manual','unknown','agreement','verification','account_changed'].includes(this.lastStates.get(platform)?.status))return;await this.refreshObserved(platform,wc).catch(()=>{});},300);timer.unref?.();};
  for(const event of ['did-finish-load','did-navigate-in-page','did-stop-loading'])wc.on(event,schedule);
  wc.on('destroyed',()=>clearTimeout(timer));this.observers.set(wc,true);
 }
 async refreshObserved(platform,wc){
  if(this.pending.has(platform)||!wc||wc.isDestroyed()||wc.isLoadingMainFrame())return;
  const observedUrl=wc.getURL(),observedState=this.lastStates.get(platform);
  const result=await this.frames(wc,platform);
  if(this.pending.has(platform)||wc.isDestroyed()||wc.getURL()!==observedUrl||wc.isLoadingMainFrame()||this.lastStates.get(platform)!==observedState)return;
  if(result.status!=='logged_in'){
   const status=result.status==='form'?'logged_out':result.status;
   if(['verification','logged_out','rejected'].includes(status)&&observedState?.status!==status){if(status==='logged_out')this.verified.delete(platform);return this.publish(platform,status,{embedded:true});}
   return result;
  }
  const account=accountFor(await this.readAccounts(),platform),configured=!!(account.username&&account.password),fingerprint=createHash('sha256').update(JSON.stringify(account)).digest('hex'),prior=this.verified.get(platform);
  if(this.pending.has(platform)||wc.isDestroyed()||wc.getURL()!==observedUrl||wc.isLoadingMainFrame()||this.lastStates.get(platform)!==observedState)return;
  if(configured&&prior&&prior.fingerprint!==fingerprint&&!observedShopChanged(prior,result))return this.publish(platform,'account_changed',{embedded:true});
  this.verified.set(platform,{fingerprint,at:this.now(),avatarUrl:result.avatarUrl,shopName:result.shopName});this.attempts.delete(platform);
  if(observedState?.status!=='logged_in'||observedState?.shopName!==result.shopName||(observedState?.avatarUrl||'')!==(result.avatarUrl||''))return this.publish(platform,'logged_in',{avatarUrl:result.avatarUrl,shopName:result.shopName});
  return result;
 }
 async require(platform,options){const force=!!options?.webContents&&allowed(options.webContents.getURL(),platform,true);const result=await this.ensure(platform,{...options,force});options?.signal?.throwIfAborted();if(result.status!=='logged_in'){const error=Error(result.name+'：'+result.message);error.code=['unknown','untrusted'].includes(result.status)?'PLATFORM_LOGIN_UNCONFIRMED':'NEED_LOGIN';error.loginStatus=result.status;throw error;}return result;}
 close(){for(const win of this.windows.values())if(!win.isDestroyed())win.destroy();this.windows.clear();}
}
module.exports={PlatformLogin,PLATFORMS,allowed,accountFor,loginPage};
