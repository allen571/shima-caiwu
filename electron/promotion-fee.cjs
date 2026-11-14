'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {AsyncLocalStorage}=require('node:async_hooks');
const HOME='https://myseller.taobao.com/home.htm/QnworkbenchHome/';
const SELLER_LOGIN='https://loginmyseller.taobao.com/';
const ACCOUNT='https://one.alimama.com/index.html#!/account/detail';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// v1.2.81（2026-11-10 财务反馈）：批量抓取遇到滑块/协议/密码错时不再原地等 15 分钟。
// 这个错误码表示「该店只能人工处理」，批量流程立即跳过它继续跑后面的店，跑完由 UI 集中处理。
// v1.2.87：结果表默认只显示「今天/昨天」的记录。此前每店历史最新一行（含 10-27 的失败、几周前的「已暂停」）
// 全部堆在表里，财务看到一整片失败以为刚跑的批次全挂了（2026-11-11 反馈实锤：今天 10 家全成功，
// 表里 16 行红/灰全是 10-27、11-04 的旧记录）。判定：updatedAt 换算北京时间是否在昨今两天内；
// 老记录没有 updatedAt 时退回查询日期 end/day。历史行不删、随 state().stale 返回给「显示历史记录」开关。
const BJS_OFFSET=8*3600000;
function rowRecent(row,now){
 const t=now||Date.now(),yesterday=new Date(t+BJS_OFFSET-86400000).toISOString().slice(0,10);
 if(row.updatedAt){const parsed=Date.parse(row.updatedAt);if(Number.isFinite(parsed)){const day=new Date(parsed+BJS_OFFSET).toISOString().slice(0,10);if(day>=yesterday)return true;}}
 const settled=row.end||row.day||'';
 // 完全没有时间信息（老版本写入的行）不做判断，保留显示——宁可多显示也不要误藏当前数据
 if(!row.updatedAt&&!settled)return true;
 return !!settled&&settled>=yesterday;
}
function manualError(message,reason){
 const error=Error(message);error.code='NEEDS_MANUAL';error.reason=reason||'manual';return error;}
// 登录表单探测：只回布尔（绝不回传输入值），用于判断「能不能自动补填/补提交」。
// usernameMatches 在页面内比较，只把结果带出来——这样既能区分「淘宝记住的是本店账号」和
// 「框里是别人的账号」，又不会把值带离页面。
const probeInputs=username=>`(()=>{const seen=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden="true"]');const pw=[...document.querySelectorAll('input[type=password]')].filter(e=>seen(e)&&!e.disabled&&!e.readOnly);const us=[...document.querySelectorAll('input')].filter(e=>seen(e)&&['text','email','tel'].includes(e.type)&&!e.disabled&&!e.readOnly);const p=pw[0],u=us[0];return {hasPassword:!!p,hasUsername:!!u,passwordFilled:!!(p&&p.value),usernameFilled:!!(u&&u.value),usernameMatches:!!(u&&u.value===${JSON.stringify(String(username||''))})};})()`;
const PLATFORM_NAMES={taobao:'淘宝',tmall:'天猫',douyin:'抖音',jd:'京东'};
function trusted(url,platform='taobao'){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&(platform==='jd'?['jd.com']:['taobao.com','tmall.com','alimama.com']).some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}catch{return false;}}
function dateBounds(now=Date.now()){const today=new Date(now+28800000).toISOString().slice(0,10),[y,m,d]=today.split('-').map(Number),target=new Date(Date.UTC(y,m-4,1)),last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();target.setUTCDate(Math.min(d,last));return {today,earliest:target.toISOString().slice(0,10)};}
function shiftDate(date,days){const t=Date.parse(date+'T00:00:00+08:00');if(!Number.isFinite(t)||new Date(t+28800000).toISOString().slice(0,10)!==date)throw Error('日期格式无效：'+date);return new Date(t+days*86400000+28800000).toISOString().slice(0,10);}
// 北京时间的“今天”（YYYY-MM-DD）：京东记账日期钳制上界用，不能依赖本机时区（本机会有 UTC 机器）
const bjToday=()=>new Date(Date.now()+28800000).toISOString().slice(0,10);
function range(input){const valid=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;const t=Date.parse(s+'T00:00:00+08:00');return Number.isFinite(t)&&new Date(t+28800000).toISOString().slice(0,10)===s;};if(!valid(input?.start)||!valid(input?.end)||input.end<input.start)throw Error('请填写有效的开始、结束日期');const {today,earliest}=dateBounds();if(input.start<earliest)throw Error('仅支持最近3个月内的日期，最早可选'+earliest);if(input.end>today)throw Error('结束日期不能晚于今天');return {start:input.start,end:input.end};}
function displayedRange(values,now=Date.now()){
 const today=new Date(now+28800000).toISOString().slice(0,10),date=t=>new Date(t+28800000).toISOString().slice(0,10),mid=Date.parse(today+'T00:00:00+08:00');
 for(const raw of values||[]){const v=String(raw).replace(/\s+/g,' ').trim().replace(/今日|今天/g,today).replace(/昨日|昨天/g,date(mid-86400000)),pair=v.match(/^(\d{4}-\d{2}-\d{2})\s*[~～至—–-]\s*(\d{4}-\d{2}-\d{2})$/);if(pair)return {start:pair[1],end:pair[2]};if(v===today)return {start:today,end:today};if(v===date(mid-86400000))return {start:date(mid-86400000),end:date(mid-86400000)};if(v==='本月')return {start:today.slice(0,8)+'01',end:today};if(v==='上月'){const previous=date(Date.parse(today.slice(0,8)+'01T00:00:00+08:00')-86400000);return {start:previous.slice(0,8)+'01',end:previous};}const recent=v.match(/^最近?\s*(7|15|30|90|180)\s*天$/);if(recent)return {start:date(mid-(Number(recent[1])-1)*86400000),end:today};}
 // v1.2.94：万相台起止日期常是两个独立输入框（如 11-01 单日显示为 "2026-11-01","2026-11-01"），
 // 旧解析只认 "X ~ Y" 合并串和今/昨特例 → 历史日期查询全部误判。取第一对相邻 ISO 日期作起止；
 // 必须成对才确认（单个不认，宁可失败不误判），页面真实显示优先，不引入任何猜测。
 const vs=(values||[]).map(x=>String(x).replace(/\s+/g,' ').trim());
 for(let i=0;i+1<vs.length;i++)if(/^\d{4}-\d{2}-\d{2}$/.test(vs[i])&&/^\d{4}-\d{2}-\d{2}$/.test(vs[i+1]))return {start:vs[i],end:vs[i+1]};
 return null;
}
function cents(value){const s=String(value).replace(/[¥￥,\s]/g,'');if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw Error('推广费金额不可读');const [a,b='']=s.split('.'),n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n))throw Error('推广费金额超出可用范围');return n;}
// Read only rendered cash-ledger controls and totals. No network response or hidden application state.
function inspect(){
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden=true]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0');
 const text=e=>(e?.innerText||e?.textContent||'').replace(/[\uE000-\uF8FF]/g,'').replace(/\s+/g,' ').trim();
 const ownText=e=>[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\s+/g,' ').trim();
 const body=document.body?.innerText||'',u=new URL(location.href),q=new URLSearchParams(u.hash.split('?')[1]||'');
 if(/请完成验证|安全验证|拖动.{0,8}滑块|按住滑块/.test(body)||[...document.querySelectorAll('iframe,frame,[id*=captcha i],[class*=captcha i]')].some(e=>visible(e)&&(/captcha|verify|jcap|_____tmd_____/i.test(e.src||'')||!['IFRAME','FRAME'].includes(e.tagName))))return {error:'请在官方窗口完成人工验证',code:'verification'};
 if(/抱歉！页面无法访问|页面无法访问|无权限|没有权限/.test(body))return {error:'推广账户页面无法访问，请核对该账号的万相台权限与登录状态',code:'unavailable'};
 if(/login\./.test(location.hostname)||document.querySelector('input[type=password]'))return {error:'请先登录该店铺',code:'need_login'};
 const tabs=[...document.querySelectorAll('[role=tab],a,span,div')].filter(visible).filter(e=>text(e)==='现金收支明细');
 const heading=tabs.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
 if(!heading)return {loading:true};
 let scope=heading;for(let i=0;i<8&&scope;i++,scope=scope.parentElement){if(/支出\s*[（(]元[）)]/.test(text(scope))&&scope.querySelector('table,[role=table]'))break;}
 if(!scope)return {loading:true};
 const content=text(scope),nodes=[...scope.querySelectorAll('*')].filter(visible);
 const labels=nodes.filter(e=>/^支出\s*[（(]元[）)]$/.test(ownText(e))).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);
 let amount=null;if(labels.length){let p=labels[0].parentElement;for(let i=0;i<3&&p;i++,p=p.parentElement){const matches=text(p).match(/[¥￥]\s*\d[\d,]*(?:\.\d{1,2})?/g)||[];if(matches.length===1){amount=matches[0];break;}if(matches.length>1)break;}}
 const loading=!![...scope.querySelectorAll('[aria-busy=true],.next-loading-mask,.ant-spin-spinning')].find(visible);
 const controls=[...scope.querySelectorAll('input,[role=combobox],.next-select,.ant-select,.mx-trigger-label,[mx-view*=\"mx-calendar\"],[class*=date-picker],[class*=DatePicker],[class*=datePicker]')].filter(visible).map(e=>(e.matches('input')?e.value:text(e)).trim());
 return {url:u.origin+u.pathname+u.hash,start:q.get('cashStart'),end:q.get('cashEnd'),trade:q.get('trade'),amount,loading,content:content.slice(0,1400),controls,accountLabels:[...document.querySelectorAll('a,span,div')].filter(e=>visible(e)&&!scope.contains(e)&&text(e).length<150).map(text).filter(Boolean),identityLabels:[...document.querySelectorAll('[class*=shopName],[class*=shop-name],[class*=nickName],[class*=nick-name],[data-shop-name]')].filter(visible).map(text).filter(Boolean),dateType:controls.some(v=>v==='交易日期')?'交易日期':null};
}
class PromotionFee{
 constructor({root,BrowserWindow,safeStorage,hidden=false,adapter=null,singleShop=false,backgroundOnly=false,desktop=null}){Object.assign(this,{root,BrowserWindow,safeStorage,hidden,adapter,singleShop,backgroundOnly,desktop});this.queryContext=new AsyncLocalStorage();this.activeQueries=new Map();this.file=path.join(root,'promotion-fee.json');this.logFile=path.join(root,'promotion-fee.log');this.manualWaitMs=300000;this.interactive=false;this.windows=new Map();this.manualLoginWatchers=new Map();this.authAttempts=new Set();this.busy=false;this.stopped=false;this.writeFailure=false;this.data={version:1,shops:[],results:[]};try{this.data=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('推广费记录无法读取，未覆盖原文件');}if(this.data.loginAttempts!==undefined&&(!this.data.loginAttempts||typeof this.data.loginAttempts!=='object'||Array.isArray(this.data.loginAttempts)))throw Error('登录尝试检查点无法读取，未覆盖原记录');
// v1.2.81：并行账号数默认 4→8（用户 2026-11-10 确认：160+ 店铺，4 路要跑两小时以上）。
// 只做一次性迁移，且不覆盖用户手动调低的值（≥6 视为主动设置）。
this.checkBusy=false;this.data.loginChecks=this.data.loginChecks||{};
if(!this.data.concurrencyMigrated){const legacy=Number(this.data.concurrency);if(!Number.isInteger(legacy)||legacy<6){this.data.concurrency=8;this.concurrencyMigratedNow=true;}this.data.concurrencyMigrated=true;}const sessionKey=s=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s||'');const counts=new Map();for(const shop of this.data.shops)if(sessionKey(shop.sessionKey))counts.set(shop.sessionKey.toLowerCase(),(counts.get(shop.sessionKey.toLowerCase())||0)+1);let isolationChanged=false;this.data.shops=this.data.shops.map(s=>{let key=s.sessionKey;if(!sessionKey(key)||(counts.get(String(key).toLowerCase())||0)>1){key=randomUUID();isolationChanged=true;}return {...s,sessionKey:key,platform:s.platform||'taobao'};});this.data.results=this.data.results.map(r=>['running','queued'].includes(r.status)?{...r,status:'paused',error:'上次查询已中断，未自动重新查询',amountCents:null}:r);if(isolationChanged||this.concurrencyMigratedNow)this.save(this.data);}
 // v1.2.81：推广费抓取一直没有日志，160 家店出问题只能靠猜（资金侧有 fund.log）。
 // 这里补一份轻量轨迹：登录填充结果、需人工原因、单店耗时、失败原因。512KB 自动轮转。
 log(event,detail){try{const line=new Date(Date.now()+28800000).toISOString().replace('T',' ').slice(0,19)+' | '+event+(detail?' | '+String(detail).replace(/\s+/g,' ').slice(0,300):'')+'\n';if(fs.existsSync(this.logFile)&&fs.statSync(this.logFile).size>524288)fs.writeFileSync(this.logFile,'');fs.appendFileSync(this.logFile,line);}catch(error){}}
 hasLoginAttempt(shop){return this.authAttempts.has(shop.sessionKey)||Object.hasOwn(this.data.loginAttempts||{},shop.sessionKey);}
 beginLoginAttempt(shop){this.check();if(this.hasLoginAttempt(shop))return false;this.save({...this.data,loginAttempts:{...this.data.loginAttempts,[shop.sessionKey]:{platform:shop.platform||'taobao',startedAt:new Date().toISOString()}}});this.authAttempts.add(shop.sessionKey);return true;}
 finishLoginAttempt(shop){this.check();if(Object.hasOwn(this.data.loginAttempts||{},shop.sessionKey)){const attempts={...this.data.loginAttempts};delete attempts[shop.sessionKey];this.save({...this.data,loginAttempts:attempts});}this.authAttempts.delete(shop.sessionKey);}
 get concurrency(){return Number.isInteger(this.data.concurrency)&&this.data.concurrency>=1&&this.data.concurrency<=20?this.data.concurrency:8;}
 setConcurrency(value){if(this.busy||this.loginBusy)throw Error('查询或登录期间不能修改并行账号数');if(!Number.isInteger(value)||value<1||value>20)throw Error('并行账号数必须为1至20的整数');this.save({...this.data,concurrency:value});return this.state();}
 get phase(){return this.activeQueries.size?[...this.activeQueries.values()].map(v=>v.phase).filter(Boolean).join('；'):this.idlePhase||'';}
 set phase(value){const id=this.queryContext.getStore(),active=this.activeQueries.get(id);if(active)active.phase=value;else this.idlePhase=value;}
 state(){
  // v1.2.85 显示合并（2026-11-11 财务反馈「重抓后第一轮的数据看不到」）：重抓（计划二轮/手动补查）
  // 会创建新 runId，旧实现只显示最新一轮的行，第一轮已获取的店铺就从界面和 CSV 导出里消失。
  // 改为：每店显示最新一行；若最新一行是失败/需人工/已暂停，且该店历史上最近一次已获取（completed），
  // 把那条一并显示（carriedOver 标注「上一轮结果」），金额继续计入合计。落盘数据不改动。
  const all=this.data.results;
  const last=all.at(-1)?.runId;
  // 兼容旧记录/测试：无 shopId 的行按旧口径（最新 runId）保留；有 shopId 的行每店取最后一行，
  // 输出顺序 = 该店首次出现顺序（Map 按首次 set 的位置迭代）
  const noShopLast=all.filter(r=>!r.shopId&&r.runId===last);
  const lastIdx=new Map();
  for(let i=0;i<all.length;i++){const r=all[i];if(!r.shopId)continue;lastIdx.set(JSON.stringify([r.shopId,r.start||null,r.end||null]),i);}
  const latest=[...lastIdx.values()].map(i=>all[i]);
  const now=Date.now(),carried=[];const carriedSeen=new Set();
  for(const r of latest){
   // 只有「最新一行本身是近期（今昨两天）」时才回显上一轮成功，避免历史失败行带出一条孤立的旧成功行
   if(!r.shopId||!['failed','manual','paused'].includes(r.status)||!rowRecent(r,now))continue;
   for(let i=all.length-1;i>=0;i--){const o=all[i];if(o.shopId===r.shopId&&o.status==='completed'&&o.start===r.start&&o.end===r.end&&!carriedSeen.has(JSON.stringify([r.shopId,r.start||null,r.end||null]))){carriedSeen.add(JSON.stringify([r.shopId,r.start||null,r.end||null]));carried.push({...o,carriedOver:true});break;}}
  }
  const rows=[...carried,...noShopLast,...latest].map(r=>this.writeFailure&&['running','queued'].includes(r.status)?{...r,status:'paused',error:this.lastError,amountCents:null}:r);
  // v1.2.87：近期行进表，历史行单独放 stale（默认不显示，供 UI「显示历史记录」开关）
  // v1.2.87：近期行进表，历史行单独放 stale（默认不显示，供 UI「显示历史记录」开关）。
  // 最新一轮的行一律保留（用户可能故意查很早的自定义区间），其余按今昨两天判定。
  const latestRange=all.at(-1);
  const keep=r=>(!latestRange||r.start===latestRange.start&&r.end===latestRange.end)&&(r.carriedOver||(!!last&&r.runId===last)||rowRecent(r,now));
  const recent=rows.filter(keep),stale=rows.filter(r=>!keep(r));
  const manual=recent.filter(r=>r.status==='manual');const loginChecks=this.data.loginChecks||{};return {shops:this.data.shops.map(({secret,...s})=>({...s,hasPassword:!!secret,loginStatus:this.loginShopId===s.id?'登录中':s.loginNeedsAttention?'需确认登录':s.loginConfirmedAt?'已保存登录':'未确认登录',checkStatus:(loginChecks[s.id]&&loginChecks[s.id].status)||'',checkAt:(loginChecks[s.id]&&loginChecks[s.id].at)||''})),results:recent,stale,concurrency:this.concurrency,activeCount:this.activeQueries.size,busy:this.busy,checkBusy:!!this.checkBusy,loginBusy:!!this.loginBusy,manualWatchCount:this.manualLoginWatchers.size,error:this.lastError||'',phase:this.phase||'',current:this.current||null,manual:{count:manual.length,shops:manual.map(r=>({shopId:r.shopId,shopName:r.shopName,reason:r.manualReason||r.error||''}))}};}
 save(data){
  const write=()=>{fs.mkdirSync(this.root,{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(data),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);this.data=data;};
  const fail=e=>{this.writeFailure=true;this.lastError='推广费记录保存失败，已停止后续查询';this.log('save-fail','熔断：'+(e&&e.code||'')+' '+(e&&e.message||e));throw Error('本机保存失败，已停止后续查询（推广费记录保存失败：'+(e&&e.message||e)+'，原因已记入 promotion-fee.log）');};
  if(this.writeFailure){try{write();this.writeFailure=false;this.lastError='';this.log('save-recovered','记录保存已恢复，解除熔断');}catch(e){fail(e);}return;}
  for(let attempt=1;attempt<=3;attempt++){
   try{write();return;}catch(e){
    this.log('save-retry','第 '+attempt+'/3 次保存失败 '+(e&&e.code||'')+' '+(e&&e.message||e));
    if(attempt===3)fail(e);
    const until=Date.now()+300;while(Date.now()<until)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
   }
  }
 }
 shop(id){const s=this.data.shops.find(s=>s.id===id);if(!s)throw Error('店铺不存在');return s;}
 putShop(input){if(this.singleShop&&!input.id&&this.data.shops.length)throw Error('当前为独立店铺环境；其他店铺请在顶部新建环境，不能共用登录');if(this.busy||this.loginBusy)throw Error('查询或登录期间不能修改账号');const old=input.id?this.shop(input.id):null;const name=String(input.name||old?.name||input.username||'').trim(),username=String(input.username||'').trim(),password=String(input.password||'');if(!name||!username||name.length>120||username.length>120)throw Error('请填写有效登录账号');if(!old?.secret&&!password)throw Error('请填写密码');let secret=old?.secret;if(password){if(!this.safeStorage?.isEncryptionAvailable())throw Error('系统密码加密不可用，未保存密码');secret=this.safeStorage.encryptString(password).toString('base64');}const platform=input.platform||old?.platform||'taobao';if(!Object.hasOwn(PLATFORM_NAMES,platform))throw Error('平台选项无效');const changed=!!old&&(username!==old.username||password.length>0||platform!==old.platform);const shop={loginNeedsAttention:changed?false:!!old?.loginNeedsAttention,loginConfirmedAt:changed?null:old?.loginConfirmedAt||null,id:old?.id||randomUUID(),platform,name:changed?username:name,username,secret,sessionKey:changed?randomUUID():old?.sessionKey||randomUUID(),boundShop:changed?null:old?.boundShop||null,boundAccountId:changed?null:old?.boundAccountId||null,jdLoginAccountId:changed?null:old?.jdLoginAccountId||null};const shops=this.data.shops.filter(s=>s.id!==shop.id).concat(shop);this.save({...this.data,shops,results:changed?this.data.results.map(r=>r.shopId===shop.id&&r.status!=='completed'?{...r,accountChanged:true,error:'账号配置已变更，请重新获取推广费'}:r):this.data.results});if(changed){const oldWindow=this.windows.get(shop.id);if(oldWindow&&!oldWindow.isDestroyed())oldWindow.destroy();this.windows.delete(shop.id);}return this.state();}
 removeShop(id){if(this.busy||this.loginBusy)throw Error('查询或登录期间不能删除账号');const shop=this.shop(id);this.save({...this.data,shops:this.data.shops.filter(s=>s.id!==id)});this.authAttempts.delete(shop.sessionKey);const win=this.windows.get(id);if(win&&!win.isDestroyed())win.destroy();this.windows.delete(id);return this.state();}
 // 批量删除所选账号：与单删同语义（保留历史结果），一次落库、统一清理会话检查点与窗口；不存在的 id 直接忽略
 removeShops(ids){if(this.busy||this.loginBusy)throw Error('查询或登录期间不能删除账号');const set=new Set(Array.isArray(ids)?ids:[]);const removing=this.data.shops.filter(s=>set.has(s.id));if(!removing.length)return this.state();this.save({...this.data,shops:this.data.shops.filter(s=>!set.has(s.id))});for(const s of removing){this.authAttempts.delete(s.sessionKey);const win=this.windows.get(s.id);if(win&&!win.isDestroyed())win.destroy();this.windows.delete(s.id);}return this.state();}
 check(){if(this.stopped)throw Error('查询已暂停');if(this.writeFailure)throw Error('本机保存失败，已停止后续查询');}
 window(shop){let win=this.windows.get(shop.id);if(win&&!win.isDestroyed())return win;win=new this.BrowserWindow({show:false,width:1280,height:850,title:PLATFORM_NAMES[shop.platform]+'推广费 · '+shop.name,webPreferences:{partition:'persist:promotion-fee:'+shop.sessionKey,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});win.webContents.session.setUserAgent(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`);win.webContents.setUserAgent(win.webContents.session.getUserAgent());for(const evt of ['will-navigate','will-redirect'])win.webContents.on(evt,(e,url)=>{if(!trusted(url,shop.platform))e.preventDefault();});win.webContents.setWindowOpenHandler(({url})=>{if(trusted(url,shop.platform)&&!win.isDestroyed())void this.load(win,url).catch(()=>{});return {action:'deny'};});win.on('closed',()=>{if(this.windows.get(shop.id)===win)this.windows.delete(shop.id);});win.promotionPlatform=shop.platform;this.windows.set(shop.id,win);return win;}
 // v1.2.81：逐字输入必须窗口有焦点。原实现全程 show:false → 原生输入静默失败 → 直接转人工弹窗，
 // 用户看到的现象就是「弹窗了但账号密码是空的」。需要填表的店铺先亮一下窗口拿到焦点。
 async focusForInput(win){
  if(this.hidden||this.backgroundOnly||!win||win.isDestroyed())return false;
  try{if(win.isMinimized?.())win.restore();if(!win.isVisible())win.show();win.focus();}catch(error){return false;}
  await wait(250);
  return true;
 }
 releaseCompletedWindow(shopId,runId){const row=this.data.results.find(r=>r.runId===runId&&r.shopId===shopId);if(row?.status!=='completed')return;const win=this.windows.get(shopId);if(!win)return;try{if(win.isDestroyed()){this.windows.delete(shopId);return;}if(!win.promotionKeepAlive&&!win.isVisible())win.destroy();}catch(error){this.windowCleanupError='已获取金额，后台窗口释放失败：'+error.message;}}
 // v1.2.50 资金页二轮重试用：彻底销毁某店铺的官方窗口并从映射移除，下次 window(shop) 会开全新窗口
 // （登录态在 persist 分区里，新窗口通常免登录——等价于用户手动「关掉窗口重新打开」）
 dropWindow(shopId){const win=this.windows.get(shopId);if(!win)return;try{if(!win.isDestroyed())win.destroy();}catch(e){}this.windows.delete(shopId);}
 assertWindow(win){this.check();if(!win||win.isDestroyed()||win.webContents.isDestroyed())throw Error(win?.promotionFailure||'该店铺的千牛窗口已关闭，请补查该店铺');return win.webContents;}
 async execute(win,script,userGesture=false,target){
  const wc=this.assertWindow(win);target ||= wc;let timer,poll,settled=false;const listeners=[];
  return new Promise((resolve,reject)=>{
   const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(poll);for(const [emitter,event,fn] of listeners)emitter.removeListener(event,fn);error?reject(error):resolve(value);};
   const abort=(message,destroy=false)=>{if(destroy)win.promotionFailure=message;const error=Error(message);finish(error);if(destroy&&!win.isDestroyed()){try{win.destroy();}catch{}}};
   const listen=(emitter,event,fn)=>{emitter.once(event,fn);listeners.push([emitter,event,fn]);};
   listen(win,'closed',()=>abort('该账号查询窗口已关闭，未重复执行页面操作'));
   listen(wc,'destroyed',()=>abort('该账号页面已关闭，未重复执行页面操作'));
   listen(wc,'render-process-gone',()=>abort('该账号浏览器进程异常退出，请补查；未重复执行页面操作',true));
   poll=setInterval(()=>{try{this.assertWindow(win);}catch(error){abort(error.message,true);}},100);
  // 京东双11等大促期间官方页面明显变慢，京东窗口的脚本看门狗放宽到45秒；千牛/淘宝保持20秒不变
  // v1.2.43：超时不再销毁窗口（2026-11-06 MUJU/德国甄选诊断实锤：登录页跳转/人工操作期间
  // 脚本偶发 >20s，旧逻辑直接 destroy 窗口 → 该店铺「打不开界面」整轮失败）。改为软超时：
  // 本次脚本判定失败，窗口保留，外层 authState/identity 轮询下一轮自然重试
  timer=setTimeout(()=>abort('该账号页面脚本执行超时，请补查'),win.promotionPlatform==='jd'?(this.jdScriptTimeoutMs||45000):(this.scriptTimeoutMs||20000));
   try{this.assertWindow(win);Promise.resolve(target.executeJavaScript(script,userGesture)).then(value=>{try{this.assertWindow(win);finish(null,value);}catch(error){abort(error.message,true);}},error=>finish(error));}catch(error){finish(error);}
  });
 }
 // 仅无副作用的页面读取可重试；登录填入/提交及点击绝不自动重放。
 async readPage(win,script,target){
  for(let attempt=0;;attempt++){
   this.assertWindow(win);
   try{return await this.execute(win,script,false,target);}
   catch(error){this.assertWindow(win);if(attempt>=2||!/Execution context was destroyed|Cannot find context|frame was detached|Render frame was disposed|navigation/i.test(error.message))throw error;await wait(150);}
  }
 }
 async load(win,url){
  const wc=this.assertWindow(win);let timer,poll;const listeners=[];
  try{
   await new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(poll);for(const [emitter,event,fn] of listeners)emitter.removeListener(event,fn);error?reject(error):resolve();};
    const stop=(error)=>{finish(error);try{if(!wc.isDestroyed())wc.stop();}catch{}};
    const listen=(emitter,event,fn)=>{emitter.once(event,fn);listeners.push([emitter,event,fn]);};
    listen(win,'closed',()=>finish(Error('该账号查询窗口已关闭，未重复执行页面操作')));
    listen(wc,'destroyed',()=>finish(Error('该账号页面已关闭，未重复执行页面操作')));
    listen(wc,'render-process-gone',()=>finish(Error('该账号浏览器进程异常退出，请补查')));
    poll=setInterval(()=>{try{this.assertWindow(win);}catch(error){stop(error);}},100);
    // 京东窗口加载看门狗同样放宽到45秒，淘宝/千牛维持20秒
   timer=setTimeout(()=>stop(Error('官方页面加载超时，请补查该账号')),win.promotionPlatform==='jd'?(this.jdNavigationTimeoutMs||45000):(this.navigationTimeoutMs||20000));
    try{Promise.resolve(win.loadURL(url)).then(()=>finish(),error=>finish(error));}catch(error){finish(error);}
   });
   this.assertWindow(win);
  }catch(error){
   this.check();
   if(win.isDestroyed()||wc.isDestroyed())throw Error(win.promotionFailure||'该账号查询窗口已关闭，请补查');
   if(error.errno===-3||error.code==='ERR_ABORTED'){
    for(let i=0;i<50;i++){this.assertWindow(win);if(!wc.isLoadingMainFrame?.()&&trusted(wc.getURL(),win.promotionPlatform))return;await wait(100);}
    throw Error('官方页面仍在跳转，请补查该账号');
   }
   throw error;
  }finally{clearTimeout(timer);clearInterval(poll);for(const [emitter,event,fn] of listeners)emitter.removeListener(event,fn);}
 }
 // 真实鼠标事件（isTrusted=true）：合成 DOM 事件点不动的官方菜单（如千牛侧边栏）用它兜底。
 // 坐标为窗口 webContents 视图的 CSS 像素，仅对主 frame 元素有效
 async sendMouse(win,type,x,y){
  const wc=this.assertWindow(win);
  try{wc.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});return true;}catch(e){return false;}
 }
 // 分阶段等待页面处理输入；所有等待都在主进程检查取消，页面不挂延迟点击。
 async submitLogin(win,observe,credentials){
  for(const [stage,delay] of [['username',0],['password',500],['submit',1000]]){
   for(let elapsed=0;elapsed<delay;elapsed+=100){this.assertWindow(win);await wait(100);}
   this.assertWindow(win);
   const state=await observe({...credentials,stage});this.assertWindow(win);
   if(state.status!=='prepared')return {...state,stage};
  }
  return {status:'unknown'};
 }
 async authState(win,credentials){
  const wc=this.assertWindow(win),{PLATFORMS,loginPage}=require('./platform-login.cjs');
  const config={...PLATFORMS.qianniu,loginHosts:[...PLATFORMS.qianniu.loginHosts,'loginmyseller.taobao.com','havanalogin.taobao.com']};
  const visible=new Map();const shown=async f=>{if(!f.parent)return true;if(visible.has(f))return visible.get(f);if(!await shown(f.parent))return false;const slots=await this.execute(win,`Array.from(document.querySelectorAll('iframe,frame'),e=>({name:e.name,url:e.src,visible:e.getClientRects().length>0&&!e.closest('[hidden],[aria-hidden="true"]')&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0')}))`,false,f.parent);const named=f.name?slots.filter(s=>s.name===f.name):[],match=named.length===1?named:slots.filter(s=>s.url===f.url);const result=match.length===1?match[0].visible:!match.length&&slots.length===1?slots[0].visible:false;visible.set(f,result);return result;};
  let best={status:'unknown'};const priority={verification:100,agreement:90,rejected:80,form:70,logged_in:60,manual:50,logged_out:40};
  let frames;
  try{frames=wc.mainFrame?.framesInSubtree||[wc];}catch(error){this.assertWindow(win);if(/Render frame was disposed|frame was detached|Execution context was destroyed/i.test(error.message))return best;throw error;}
  for(const frame of frames){
   this.assertWindow(win);let url,host;
   try{url=frame.url||wc.getURL();host=new URL(url).hostname;}catch(error){this.assertWindow(win);if(/Render frame was disposed|frame was detached|Execution context was destroyed/i.test(error.message))return {status:'unknown'};continue;}
   if(!trusted(url)||credentials&&!config.loginHosts.includes(host))continue;
   try{if(!await shown(frame))continue;this.assertWindow(win);const script='('+loginPage.toString()+')('+JSON.stringify(config)+','+JSON.stringify(credentials||null)+')';const inspect=input=>this.execute(win,'('+loginPage.toString()+')('+JSON.stringify(config)+','+JSON.stringify(input)+')',true,frame);const attempt=credentials?require('./native-login.cjs').operate(this,win,frame,inspect,credentials):this.readPage(win,script,frame);let result=await attempt;
   // v1.2.81（2026-11-10 财务反馈「弹窗后账号密码经常没写入」）：旧条件要求「页面上恰好 1 个
   // 密码框、且账号框与密码框都还空着」才兜底。淘宝把上次账号记住、或新版登录页出现第二个
   // password 输入时，兜底被整体跳过 → 弹窗里框是空的。改为：
   // ① 有可用密码框且密码未填 → force 覆盖写入（不动已填好的密码）；
   // 写完回读校验，最多 3 轮，避免 React 重渲染把值清掉。
   if(credentials&&result.status==='manual'){
    const probe=await this.execute(win,probeInputs(credentials.username),false,frame).catch(()=>null);
    const stage=credentials.stage;
    // 只在「密码空 + 账号框不是别人账号」时补填，避免覆盖用户手输的其他账号
    const needFill=stage!=='submit'&&!!probe&&probe.hasPassword&&!probe.passwordFilled&&(!probe.usernameFilled||probe.usernameMatches);
    if(needFill){
     const forced={...credentials,force:true,nativeInput:false};
     for(let attempt=0;attempt<3;attempt++){
      const written=await this.execute(win,'('+loginPage.toString()+')('+JSON.stringify(config)+','+JSON.stringify(forced)+')',true,frame).catch(()=>null);
      if(!written)break;
      if(['submitted','switched','agreement','verification','rejected','untrusted','form','logged_out'].includes(written.status)){result=written;break;}
      const after=await this.execute(win,probeInputs(credentials.username),false,frame).catch(()=>null);
      const done=!!after&&(stage==='username'?after.usernameFilled:after.passwordFilled&&after.usernameFilled);
      if(done){result={status:credentials.fillOnly?'filled':'prepared'};break;}
      await wait(200);
     }
    }
   }
   if(credentials&&['submitted','prepared','filled','switched','verification','agreement','rejected','manual','untrusted'].includes(result.status))return result;if((priority[result.status]||0)>(priority[best.status]||0))best=result;}catch(error){this.assertWindow(win);if(credentials||/Render frame was disposed|frame was detached|Execution context was destroyed/i.test(error.message))return {status:'unknown'};}
  }return best;
 }
 showProblem(win){if(this.hidden||this.backgroundOnly||this.stopped||this.writeFailure||!win||win.isDestroyed())return false;try{return require('./promotion-fee-front.cjs').bringToFront(win);}catch(error){this.windowAttentionError=error.message;return false;}}
 stopManualLoginWatch(shopId){
  const watch=this.manualLoginWatchers?.get(shopId);
  if(!watch)return;
  clearTimeout(watch.timer);this.manualLoginWatchers.delete(shopId);
 }
 watchManualLogin(shop,win){
  if(this.hidden||this.backgroundOnly||this.stopped||this.writeFailure||!['taobao','tmall'].includes(shop.platform||'taobao'))return;
  this.stopManualLoginWatch(shop.id);
  const watch={win,timer:null};this.manualLoginWatchers.set(shop.id,watch);
  const valid=()=>{
   const current=this.data.shops.find(s=>s.id===shop.id);
   return this.manualLoginWatchers.get(shop.id)===watch&&!this.hidden&&!this.backgroundOnly&&!this.stopped&&!this.writeFailure&&!this.checkBusy&&this.loginShopId!==shop.id&&!this.activeQueries.has(shop.id)&&this.windows.get(shop.id)===win&&!win.isDestroyed()&&!win.webContents.isDestroyed()&&current?.sessionKey===shop.sessionKey&&current.username===shop.username&&!!current.boundShop;
  };
  const schedule=()=>{watch.timer=setTimeout(poll,this.manualWatchIntervalMs||1000);watch.timer.unref?.();};
  const poll=async()=>{
   if(!valid()){if(this.manualLoginWatchers.get(shop.id)===watch)this.stopManualLoginWatch(shop.id);return;}
   try{
    const state=await this.authState(win);
    if(!valid()){if(this.manualLoginWatchers.get(shop.id)===watch)this.stopManualLoginWatch(shop.id);return;}
    const current=this.data.shops.find(s=>s.id===shop.id);
    if(state.status==='logged_in'&&state.shopName&&state.shopName.normalize('NFKC').trim()===current.boundShop.normalize('NFKC').trim()){
     await this.saveLoginSession(current,win,()=>{if(!valid())throw Error('账号或窗口状态已变化');});
     if(!valid()){if(this.manualLoginWatchers.get(shop.id)===watch)this.stopManualLoginWatch(shop.id);return;}
     win.promotionKeepAlive=true;win.hide();this.stopManualLoginWatch(shop.id);
     this.log('manual-login-confirmed',current.name);
     return;
    }
   }catch(error){
    if(this.manualLoginWatchers.get(shop.id)===watch){this.log('manual-login-watch-error',error.message);this.stopManualLoginWatch(shop.id);}
    return;
   }
   if(valid())schedule();else if(this.manualLoginWatchers.get(shop.id)===watch)this.stopManualLoginWatch(shop.id);
  };
  schedule();
 }
 async attention(shop,win,message,ledger=false,allowSubmit=false){
  // v1.2.81（2026-11-10 财务反馈「跑一下停一下，要点暂停再点抓取」）：旧实现任何一家店遇到
  // 滑块/协议都会在这里原地等 15 分钟，并发 4 时 4 家一卡，后面 150 多家全排队。
  // 批量抓取（run/start）一律立刻抛出「需人工」，跳过该店继续跑；只有用户主动点「登录」才等待。
  if(!this.interactive){
   // 保留需要人工处理的官方窗口，让用户能看到并完成验证。
   if(!this.hidden&&!this.backgroundOnly&&!this.stopped)this.showProblem(win);
   throw manualError('该店需要人工验证'+(message?'：'+message:''),ledger?'verification':'manual');
  }
  if(this.backgroundOnly)throw Error('该店需要人工登录或验证，请切换到该店完成认证后补查');
  if(!this.hidden){this.assertWindow(win);this.showProblem(win);}
  this.log('attention-wait',shop.name+' '+message);
  this.phase='等待 '+shop.name+' 完成人工验证'+(message?'：'+message:'');
  const until=Date.now()+(this.manualWaitMs||300000);let businessURL='',businessStable=0,prefilled=false,prefillTries=0;
  while(Date.now()<until){
   const wc=this.assertWindow(win);
   if(ledger){
    const page=await this.readPage(win,'('+inspect.toString()+')()');
    if(page.error&&!['verification','need_login'].includes(page.code))throw Error(page.error);
    const auth=await this.authState(win);
    if(auth.status==='rejected')throw Error('千牛账号或密码错误，请编辑该店铺账号');
    const authBlocking=['verification','agreement','form','logged_out','manual'].includes(auth.status);
    if(!page.error&&!page.loading&&page.amount&&!authBlocking){win.promotionKeepAlive=true;win.hide();await this.flushSession(win);return {status:'ready'};}
    if(!page.error&&auth.status==='logged_in'&&auth.shopName){this.bindShop(shop,auth.shopName);return {status:'resume_ledger'};}
    // 推广业务首页只允许恢复导航，绝不据此确认登录或清除检查点。
    let business=false;try{const u=new URL(wc.getURL());business=u.protocol==='https:'&&u.hostname==='one.alimama.com'&&!u.hash.startsWith('#!/account/detail');}catch{}
    const candidate=business&&!wc.isLoadingMainFrame?.()&&!page.error&&['unknown','logged_in'].includes(auth.status)?wc.getURL():'';
    businessStable=candidate&&candidate===businessURL?businessStable+1:0;businessURL=candidate;
    if(businessStable>=2)return {status:'resume_ledger'};
   }else{
    const result=await this.authState(win);
    if(result.status==='logged_in'&&result.shopName){win.promotionKeepAlive=true;if(!win.isDestroyed())win.hide();await this.flushSession(win);this.log('attention-ok',shop.name);return result;}
    if(result.status==='rejected')throw Error('千牛账号或密码错误，请编辑该店铺账号');
    if(allowSubmit&&result.status==='form'){
     allowSubmit=false;
     const password=this.safeStorage.decryptString(Buffer.from(shop.secret,'base64'));
     await this.authState(win,{username:shop.username,password,stage:'submit'});
     await wait(350);
     continue;
    }
    if(!prefilled&&prefillTries<3&&!['logged_in','rejected','switched','submitted'].includes(result.status)){
     // v1.2.81：原来只在 form/logged_out 时预填，且只试一次。manual/unknown（页面半加载、找不到
     // 提交按钮）其实同样可填——放宽并重试一次，减少「窗口弹出来了但框还是空的」。
     // 验证码（verification）期间不算填好，用户通过后下一轮再补填一次（最多 3 轮）。
     prefillTries++;
     const password=this.safeStorage.decryptString(Buffer.from(shop.secret,'base64'));
     for(let n=0;n<2&&!prefilled;n++){
      this.assertWindow(win);
      const filled=await this.authState(win,{username:shop.username,password,fillOnly:true}).catch(()=>null);
      prefilled=!!filled&&['filled','manual','agreement','rejected'].includes(filled.status);
      if(!prefilled&&n===0)await wait(600);
     }
     this.log('prefill',shop.name+' try'+prefillTries+(prefilled?' ok':' pending'));
    }
    if(!['verification','agreement','manual','form','logged_out','unknown'].includes(result.status))throw Error(message);
   }
   await wait(350);
  }
  throw Error('等待人工验证超时，请补查该店铺');
 }
 async identity(shop,win,{revalidate=false}={}){
  const resumeUnknown=this.hasLoginAttempt(shop);let observed=await this.authState(win);if(['verification','agreement'].includes(observed.status)){this.markLoginRequired(shop);observed=await this.attention(shop,win,'请完成千牛验证');revalidate=false;}
  if(!revalidate&&observed.status==='logged_in'&&observed.shopName){if(!win.isDestroyed())win.hide();return observed.shopName;}
  await this.load(win,HOME);let redirected=false,loginSignals=0;
  for(let n=0;n<160;n++){
   this.assertWindow(win);const state=await this.authState(win);
   if(state.status==='logged_in'&&state.shopName){if(!win.isDestroyed())win.hide();return state.shopName;}
   if(['verification','agreement'].includes(state.status)){this.markLoginRequired(shop);const done=await this.attention(shop,win,'请完成千牛验证');return done.shopName;}
   if(state.status==='rejected'){this.markLoginRequired(shop);throw Error('千牛账号或密码错误，请编辑该店铺账号后补查');}
   const wc=this.assertWindow(win);if(wc.isLoadingMainFrame?.()){await wait(250);continue;}
   // 身份渲染慢不是登录失效；仅连续读到明确登录表单/未登录提示才转登录页。
   loginSignals=['form','logged_out'].includes(state.status)?loginSignals+1:0;
   if(!redirected&&loginSignals>=2){this.markLoginRequired(shop);redirected=true;await this.load(win,SELLER_LOGIN);continue;}
   if(redirected&&resumeUnknown&&['form','logged_out'].includes(state.status)){const done=await this.attention(shop,win,'上次登录结果未确认：空白账号密码框会预填，请在官方窗口确认并点击登录');return done.shopName;}
   if(redirected&&['form','logged_out'].includes(state.status)&&!this.hasLoginAttempt(shop)){
    const password=this.safeStorage.decryptString(Buffer.from(shop.secret,'base64'));
    this.beginLoginAttempt(shop);
    // v1.2.81：先亮窗口拿焦点再逐字输入——隐藏窗口里原生输入必定失败，这正是
    // 「弹窗后账号密码经常没写入」的直接原因。
    await this.focusForInput(win);
    this.log('login-fill-start',shop.name);
    const filled=await this.submitLogin(win,credentials=>this.authState(win,credentials),{username:shop.username,password});
    this.log('login-fill-result',shop.name+' '+filled.status);
    // 仅明确尚未提交的切换/表单结果可撤销本次预备检查点。
    if(['switched','logged_out','form'].includes(filled.status))this.finishLoginAttempt(shop);
    if(['verification','agreement','manual'].includes(filled.status)){const done=await this.attention(shop,win,'请在千牛窗口完成登录',false,filled.status==='verification'&&filled.stage==='submit');return done.shopName;}
    if(filled.status==='rejected')throw Error('千牛账号或密码错误，请编辑该店铺账号后补查');
   }
   await wait(300);
  }throw Error(redirected?'千牛自动登录未完成，请检查该店铺账号；未重复提交登录':'千牛页面尚未确认店铺身份，未判定登录过期；请检查官方窗口后重试');
 }
 bindShop(shop,identity){this.check();if(!identity||!String(identity).trim())throw Error('千牛店铺身份未读到，未获取金额');const current=this.shop(shop.id);if(current.boundShop&&current.boundShop!==identity){this.markLoginRequired(shop);throw Error('登录店铺发生变化，请重新配置账号');}if(current.name!==identity||current.boundShop!==identity)this.save({...this.data,shops:this.data.shops.map(s=>s.id===shop.id?{...s,name:identity,boundShop:identity}:s),results:this.data.results.map(r=>r.shopId===shop.id&&r.status==='running'?{...r,shopName:identity}:r)});}
 markLoginRequired(shop){this.check();const current=this.shop(shop.id);if(!current.loginNeedsAttention)this.save({...this.data,shops:this.data.shops.map(s=>s.id===shop.id?{...s,loginNeedsAttention:true}:s)});}
 // 提前登录和查询只使用这一条身份核验、会话落盘与状态确认路径。
 async authenticate(shop,win,{revalidate=false}={}){
  this.stopManualLoginWatch(shop.id);
  this.check();this.phase='正在确认 '+shop.name+' 的登录状态';let identity;
  if(shop.platform==='jd'){
   this.jdAdapter ||= new(require('./promotion-fee-jd.cjs').JdPromotionFee)({host:this});
   identity=await this.jdAdapter.login(shop,win,{revalidate});this.check();
   const current=this.shop(shop.id);if(!identity.accountId||current.jdLoginAccountId&&current.jdLoginAccountId!==identity.accountId){this.markLoginRequired(shop);throw Error('京东登录账户身份已变化，请核对账号');}
   this.save({...this.data,shops:this.data.shops.map(s=>s.id===shop.id?{...s,name:identity.name||s.name,jdLoginAccountId:identity.accountId}:s)});
  }else{identity=await this.identity(shop,win,{revalidate});this.bindShop(shop,identity);}
  await this.saveLoginSession(shop,win);
  return identity;
 }
 // v1.2.81：滑块/验证通过后立刻把会话刷到磁盘。以前只有走完 authenticate 才落盘，
 // 人工验证正好发生在「中途」，进程一重启就得再登一次 → 又弹一次滑块。
 async flushSession(win){
  try{const ses=this.assertWindow(win).session;ses.flushStorageData();await ses.cookies.flushStore();}catch(error){}
 }
 async saveLoginSession(shop,win,guard){
  this.check();const ses=this.assertWindow(win).session;
  try{ses.flushStorageData();await ses.cookies.flushStore();}
  catch(error){
   if(this.stopped||win.isDestroyed()||win.webContents.isDestroyed())throw error;
   if(guard)guard();
   this.writeFailure=true;this.lastError='账号会话保存失败，已停止后续查询';
   this.log('session-save-fail',error.message);
   throw Error(this.lastError+'：'+error.message);
  }
  this.check();if(guard)guard();
  const loginAttempts={...this.data.loginAttempts};delete loginAttempts[shop.sessionKey];
  const loginChecks={...this.data.loginChecks};delete loginChecks[shop.id];
  this.save({...this.data,loginAttempts,loginChecks,shops:this.data.shops.map(s=>s.id===shop.id?{...s,loginConfirmedAt:new Date().toISOString(),loginNeedsAttention:false}:s)});
  // 仅持久提交成功后清内存，避免身份错配、取消或保存失败被当成成功。
  this.authAttempts.delete(shop.sessionKey);this.jdAdapter?.attempted?.delete(shop.sessionKey);
 }
 async login(id){
  if(this.busy||this.loginBusy||this.accountTransferBusy||this.checkBusy)throw Error('查询、登录、账号操作或登录验证正在运行');
  if(this.writeFailure)throw Error('本机保存失败，已停止后续操作');
  const shop=this.shop(id);if(shop.platform==='douyin')throw Error('抖音登录尚未接入');
  this.loginBusy=true;this.loginShopId=id;this.stopped=false;this.lastError='';this.phase='正在登录 '+shop.name;
  // v1.2.81：主动登录是「有人在看」的场景，允许窗口显示并等待人工（上限 manualWaitMs），
  // 与批量抓取「遇验证立刻跳过」区分开。
  this.interactive=true;
  this.loginWork=(async()=>{let win;try{
   win=this.window(shop);await this.focusForInput(win);await this.authenticate(shop,win,{revalidate:true});
   win.promotionKeepAlive=true;win.hide();this.phase='登录状态已确认：'+this.shop(id).name;this.log('login-ok',shop.name);
  }catch(error){this.lastError=this.stopped?'登录已取消':error.message;if(!this.stopped)this.showProblem(win);this.log('login-fail',shop.name+' '+(error.code||'')+' '+error.message);}
  finally{this.interactive=false;this.loginBusy=false;this.loginShopId=null;}})();
  return this.state();
 }
 // v1.2.88 一键验证登录状态（2026-11-11 财务反馈「弹窗滑块太多，想先知道谁还登着」）：
 // 用已保存会话打开官方首页做只读探测——绝不填密码、不点登录、不弹验证窗，不产生新的
 // 密码登录记录，因此不会触发风控滑块。结果存 loginChecks 供界面标注；过期/待验证的
 // 店由前端自动勾选，交给「一键登录所选」接力处理。
 async checkLogins(input){
  if(this.busy||this.loginBusy||this.accountTransferBusy||this.checkBusy)throw Error('查询、登录或账号操作正在运行，稍后再验证');
  this.check();
  const ids=[...new Set(Array.isArray(input?.shopIds)?input.shopIds:[])].filter(id=>this.data.shops.some(s=>s.id===id));
  const shops=ids.length?ids.map(id=>this.shop(id)):this.data.shops.filter(s=>s.platform!=='douyin');
  if(!shops.length)throw Error('请先添加店铺账号');
  const startedAt=Date.now();this.checkBusy=true;this.lastError='';
  // 探测到的原始状态 → 展示口径：ok=会话有效；expired=会话已过期；verification=待人工验证；
  // rejected=登录异常；unknown=15 秒内没读出确定状态（页面加载慢/结构变化），不算失败也不瞎猜。
  const KIND={logged_in:'ok',verification:'verification',agreement:'verification',form:'expired',logged_out:'expired',rejected:'rejected',blocked:'rejected'};
  try{
   const checks={};let next=0;
   const probe=async shop=>{
    let win=this.windows.get(shop.id),created=!win||win.isDestroyed();
    try{
     if(created)win=this.window(shop);
     this.log('login-check-start',shop.name);
     await this.load(win,shop.platform==='jd'?require('./promotion-fee-jd.cjs').HOME:HOME);
     const deadline=Date.now()+(this.loginCheckTimeoutMs||15000);let raw='unknown';
     while(Date.now()<deadline){
      this.check();
      const st=shop.platform==='jd'
        ?await(this.jdAdapter||=new(require('./promotion-fee-jd.cjs').JdPromotionFee)({host:this})).observe(win)
        :await this.authState(win);
      if(KIND[st.status]){raw=st.status;break;}
      await wait(400);
     }
     return raw;
    }catch(error){return 'unknown';}
    finally{ // 自己开的检查窗口用完即收，避免在桌面/内存里堆窗口；会话窗口（keepAlive）不动
     try{if(win&&!win.isDestroyed()&&created&&!win.promotionKeepAlive&&!win.isVisible())win.destroy();}catch{}
    }
   };
   const worker=async()=>{while(next<shops.length){const shop=shops[next++];const raw=await this.queryContext.run(shop.id,()=>probe(shop));const status=KIND[raw]||'unknown';checks[shop.id]={status,at:new Date().toISOString()};this.log('login-check',shop.name+' '+status+(KIND[raw]?'':' (未确认:'+raw+')'));}};
   await Promise.allSettled(Array.from({length:Math.min(Math.max(this.concurrency,1),4)},()=>worker()));
   this.data.loginChecks={...(this.data.loginChecks||{}),checkedAt:new Date().toISOString(),...checks};
   this.save(this.data);
   const results=shops.map(s=>({shopId:s.id,shopName:s.name,status:checks[s.id]?checks[s.id].status:'unknown'}));
   const counts={ok:0,expired:0,verification:0,rejected:0,unknown:0};for(const r of results)counts[r.status]++;
   return {checkedAt:this.data.loginChecks.checkedAt,results,counts,seconds:Math.round((Date.now()-startedAt)/1000)};
  }finally{this.checkBusy=false;}
 }
 async query(shop,dates,context={}){
  if(this.adapter)return this.adapter(shop,dates);
  if(shop.platform==='douyin')throw Error('抖音推广费抓取尚未接入');
  if(shop.platform==='jd'){
   this.jdAdapter ||= new(require('./promotion-fee-jd.cjs').JdPromotionFee)({host:this});
   // 京东按「记账时间」出账：业务日期 D 的数据要按 D+1 天筛选（淘宝/天猫不位移）。结果行仍记业务日期，
   // 实际筛选日期另存 queryStart/queryEnd 供界面展示。
   // 今天的数据还没出账（要明天才筛得到），因此结束日钳制到今天，绝不向页面提交未来日期：
   // 否则「本月」这类默认区间（结束日=今天）会让京东落在明天，页面选不中、整店失败。
   const today=bjToday(),query={start:shiftDate(dates.start,1),end:shiftDate(dates.end,1)},clamped=query.end>today;
   if(clamped)query.end=today;
   if(query.start>query.end)throw Error('京东账单按记账时间次日出账：'+dates.end+' 的数据要等到 '+shiftDate(dates.end,1)+' 才筛得到，请改用更早的日期（最晚可查 '+shiftDate(today,-1)+'）');
   const result=await this.jdAdapter.query(shop,query,context);
   return {...result,queryStart:query.start,queryEnd:query.end,queryClamped:clamped,coverageEnd:clamped?shiftDate(query.end,-1):dates.end};
  }
  const win=this.window(shop),wc=win.webContents;
  const identity=await this.authenticate(shop,win);
  // 参数来自官方日期/扣款控件；最终仍须核对实际页面，不能只信URL。
  const url=ACCOUNT+'?currentPage=1&trade=DEDUCT&cashStart='+dates.start+'&cashEnd='+dates.end;
  this.phase='正在读取 '+shop.name+' 推广费';await this.load(win,url);
  let prior=null,stable=0,recoveryUsed=false,mismatch=null,mismatchLogged=false,readyUntil=Date.now()+(this.pageReadyTimeoutMs||20000);
  while(Date.now()<readyUntil){
   this.assertWindow(win);
   if(!trusted(wc.getURL()))throw Error('页面已离开官方推广账户');
   const state=await this.readPage(win,'('+inspect.toString()+')()');
   if(!state.error&&!state.loading&&state.amount){
    const auth=await this.authState(win);
    if(auth.status==='rejected'){this.markLoginRequired(shop);throw Error('千牛账号或密码错误，请编辑该店铺账号');}
    if(['verification','agreement','form','logged_out','manual'].includes(auth.status)){
     state.code=['verification','agreement'].includes(auth.status)?'verification':'need_login';state.error='推广页面仍需认证';
    }
   }
   if(['verification','need_login'].includes(state.code)){
    this.markLoginRequired(shop);
    this.log('query-needs-auth',shop.name+' '+state.code);
    if(recoveryUsed)throw Error('该店推广页面仍需登录或验证，本次未重复认证，请处理官方窗口后补查');
    recoveryUsed=true;prior=null;stable=0;
    await this.attention(shop,win,'推广页面需要认证，完成后继续原日期查询',true);
    this.assertWindow(win);await this.load(win,url);
    this.phase='正在读取 '+shop.name+' 推广费';readyUntil=Date.now()+(this.pageReadyTimeoutMs||20000);mismatch=null;continue;
   }
   if(state.error)throw Error(state.error);
   if(!state.loading&&state.trade==='DEDUCT'&&state.start===dates.start&&state.end===dates.end&&state.dateType==='交易日期'&&state.controls.includes('扣款')&&state.amount){
    const actual=displayedRange(state.controls);
    const problem=!state.identityLabels.includes(identity)&&!(state.accountLabels||[]).some(v=>v.normalize('NFKC').trim().toLowerCase()===shop.username.normalize('NFKC').trim().toLowerCase())?'推广账单的店铺身份未确认，未返回金额':!actual||actual.start!==dates.start||actual.end!==dates.end?'页面实际显示的日期范围未确认，未返回金额':null;
    if(problem){stable=0;prior=null;mismatch=problem;if(!mismatchLogged){mismatchLogged=true;this.log('query-date-mismatch',shop.name+' controls='+JSON.stringify(state.controls)+' urlRange='+state.start+'~'+state.end+' dateType='+state.dateType);}await wait(350);continue;}
    mismatch=null;
    // 页面时钟、提示文案等无关内容变化不影响金额；身份/日期/金额须连续一致。
    const key=JSON.stringify([state.amount,state.controls,identity]);stable=key===prior?stable+1:0;prior=key;
    if(stable>=2){
     if(this.shop(shop.id).loginNeedsAttention){await this.saveLoginSession(shop,win);win.promotionKeepAlive=true;}
     return {shopName:identity,amountCents:cents(state.amount),sourceUrl:state.url,controls:state.controls};
    }
   }else{prior=null;stable=0;}
   await wait(350);
  }
  throw Error(mismatch||'未确认扣款、交易日期、日期范围及稳定金额，未返回数值');
 }
 async start(input){if(this.busy||this.loginBusy||this.accountTransferBusy||this.checkBusy)throw Error('推广费查询、登录或登录验证正在运行');if(this.writeFailure)throw Error('本机保存失败，已停止后续查询');const dates=range(input),ids=[...new Set(input.shopIds||[])];if(!ids.length)throw Error('请勾选店铺');const shops=ids.map(id=>this.shop(id));const runId=randomUUID();const rows=shops.map(s=>({runId,shopId:s.id,shopName:s.name,platform:s.platform||'taobao',...dates,status:'queued',amountCents:null}));this.save({...this.data,results:[...this.data.results,...rows]});this.interactive=false;this.log('run-start',shops.length+' 家 '+dates.start+'~'+dates.end+' 并发 '+this.concurrency);this.busy=true;this.stopped=false;this.lastError='';this.work=this.run(shops,dates,runId).catch(error=>{this.lastError=error.message;}).finally(()=>{this.busy=false;this.current=null;this.phase='';});return this.state();}
 async run(shops,dates,runId){let next=0;const worker=async()=>{while(next<shops.length){if(this.stopped||this.writeFailure)return;const shop=shops[next++];await this.queryContext.run(shop.id,async()=>{this.activeQueries.set(shop.id,{phase:'正在查询 '+shop.name});try{const patch=value=>this.save({...this.data,results:this.data.results.map(r=>r.runId===runId&&r.shopId===shop.id?{...r,...value,updatedAt:new Date().toISOString()}:r)});patch({status:'running'});this.log('shop-start',shop.name);const startedAt=Date.now();try{const priorAccounts=this.data.results.find(r=>r.runId===runId&&r.shopId===shop.id)?.accounts;const result=await this.query(shop,dates,{priorAccounts,onAuthorizationNotices:notices=>{this.check();patch({authorizationNotices:notices});},onAccounts:accounts=>{this.check();patch({accounts});}});this.check();
     // 校验规则：有 accounts 时，顶层金额必须等于 completed 子账户之和（全为财务号/无推广时为 null 合法）；
     // 无 accounts（淘宝/千牛路径）保持原规则：金额必须是合法非负整数
     const hasAccounts=Array.isArray(result.accounts)&&result.accounts.length>0,completed=hasAccounts?result.accounts.filter(a=>a.status==='completed'):[];
     const moneyOk=hasAccounts?completed.every(a=>Number.isSafeInteger(a.amountCents)&&a.amountCents>=0)&&(completed.length?Number.isSafeInteger(result.amountCents)&&result.amountCents===completed.reduce((n,a)=>n+a.amountCents,0):result.amountCents===null):(Number.isSafeInteger(result.amountCents)&&result.amountCents>=0);
     if(result.shopName!==this.shop(shop.id).name||(result.status==='failed'&&result.amountCents!==null)||(result.status!=='failed'&&!moneyOk))throw Error('店铺或金额核对失败');patch({...result,status:result.status||'completed'});this.log('shop-done',shop.name+' '+(Date.now()-startedAt)+'ms '+(result.amountCents??''));}catch(error){if(this.writeFailure)return;const manual=error.code==='NEEDS_MANUAL';const pbWin=this.windows.get(shop.id);try{if(pbWin&&!pbWin.isDestroyed()&&(this.stopped||this.hidden||this.backgroundOnly))pbWin.hide();else if(pbWin&&!pbWin.isDestroyed()&&!manual)this.showProblem(pbWin);}catch{}this.log(manual?'shop-manual':'shop-failed',shop.name+' '+(Date.now()-startedAt)+'ms | '+(error.reason||'')+' | '+error.message);patch({status:this.stopped?'paused':manual?'manual':'failed',error:/Render frame was disposed|frame was detached|Execution context was destroyed/i.test(error.message)?'页面跳转时读取中断，请补查该店铺':/Object has been destroyed/.test(error.message)?'该店铺的千牛窗口已关闭，请补查该店铺':error.message,amountCents:null,...(manual?{manualReason:error.reason||'manual'}:{})});if(manual&&pbWin&&!pbWin.isDestroyed())this.watchManualLogin(shop,pbWin);}}finally{this.activeQueries.delete(shop.id);this.releaseCompletedWindow(shop.id,runId);}});}};const settled=await Promise.allSettled(Array.from({length:Math.min(this.concurrency,shops.length)},()=>worker()));const tally={};for(const r of this.data.results)if(r.runId===runId)tally[r.status]=(tally[r.status]||0)+1;this.log('run-end',JSON.stringify(tally));const failed=settled.find(r=>r.status==='rejected');if(failed)throw failed.reason;
 if(!this.writeFailure)this.save({...this.data,results:this.data.results.map(r=>r.runId===runId&&['queued','running'].includes(r.status)?{...r,status:'paused',error:'尚未查询'}:r)});}
 async retry(){if(this.busy||this.loginBusy||this.accountTransferBusy)throw Error('查询或登录正在运行');if(this.writeFailure)throw Error('本机保存失败，已停止后续查询');const suspect=r=>Array.isArray(r.accounts)&&r.accounts.some(a=>a.status==='none'||a.status==='finance-only');const rows=this.state().results.filter(r=>!r.accountChanged&&this.data.shops.some(s=>s.id===r.shopId)&&(r.status!=='completed'||suspect(r)));if(!rows.length)throw Error('没有可补查的已配置账号');const dates=range(rows[0]),runId=rows[0].runId,shops=rows.map(r=>this.shop(r.shopId));this.interactive=false;this.log('retry-start',shops.length+' 家');this.save({...this.data,results:this.data.results.map(r=>{if(r.runId!==runId||!shops.some(s=>s.id===r.shopId))return r;if(r.status!=='completed')return {...r,status:'queued',error:'',amountCents:null};return suspect(r)?{...r,status:'queued',error:'',amountCents:null,accounts:r.accounts.filter(a=>a.status==='completed')}:r;})});this.busy=true;this.stopped=false;this.lastError='';this.work=this.run(shops,dates,runId).catch(error=>{this.lastError=error.message;}).finally(()=>{this.busy=false;this.current=null;this.phase='';});return this.state();}
 pause(){this.stopped=true;for(const id of this.manualLoginWatchers?.keys()||[])this.stopManualLoginWatch(id);return this.state();}
 close(){this.stopped=true;for(const id of this.manualLoginWatchers?.keys()||[])this.stopManualLoginWatch(id);for(const w of [...this.windows.values(),...(this.problemWindows||[])])if(!w.isDestroyed())w.destroy();}
}
module.exports={PLATFORM_NAMES,PromotionFee,inspect,cents,range,trusted,displayedRange,dateBounds,shiftDate,bjToday,manualError};
