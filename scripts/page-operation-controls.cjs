'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PromotionFee}=require('../electron/promotion-fee.cjs'),{JdPromotionFee}=require('../electron/promotion-fee-jd.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-page-controls-'));
app.setPath('userData',root);if(process.platform==='darwin')app.setActivationPolicy('prohibited');
const delay=Number(process.env.SHIMA_PAGE_DELAY)||500,monthDelay=Math.round(delay*.9);
function fixture(drop,confirm=false,half=false,options={}){return `<!doctype html><style>[hidden]{display:none!important}body{margin:12px;font:14px sans-serif}input{width:280px;height:36px}.popup{display:flex;position:absolute;top:60px;left:10px;background:white;border:1px solid #ccc}.panel{width:230px}.days{display:grid;grid-template-columns:repeat(7,1fr)}.jad-date-picker-cell{height:28px;text-align:center}.selected{background:red}.jad-date-picker-header-label{margin:8px}em{display:block;font-style:normal}</style><input placeholder="请选择日期" readonly value="2026-09-23 ~ 2026-10-23">${options.unrelatedConfirm?'<div class="jad-dropdown-popper" style="position:absolute;top:620px"><button id="foreign-confirm">确定</button></div>':''}<div class="popup jad-dropdown-popper" hidden></div><h3 style="margin-top:360px">${options.interactive?'<button id="outside-title">入账明细</button>':'<span id="outside-title">入账明细</span>'}</h3>${options.blocked?'<div style="position:fixed;inset:0;background:#fff8;z-index:100"></div>':''}<script>
const input=document.querySelector('input'),popup=document.querySelector('.popup');let start=null,selected=['2026-09-23','2026-10-23'],drop=${drop},confirm=${confirm},draftEnd=null,pending=false,month=9,clicks=0,arrows=0,resets=0,outside=0,foreignClicks=0;const options=${JSON.stringify(options)};
window.result=()=>({clicks,arrows,value:input.value,open:!popup.hidden,resets,outside,foreignClicks});
function render(){popup.innerHTML=[month,month+1].map(m=>'<div class="panel jad-date-picker-content-'+(m===month?'left':'right')+'"><span class="jad-date-picker-prev-btn-arrow">‹</span><span class="jad-date-picker-header-label">2026</span><span class="jad-date-picker-header-label">'+m+'</span><span class="jad-date-picker-next-btn-arrow">›</span><div class="days">'+Array.from({length:31},(_,i)=>{const d='2026-'+String(m).padStart(2,'0')+'-'+String(i+1).padStart(2,'0');return '<div data-date="'+d+'" class="jad-date-picker-cell '+(selected.includes(d)?'selected':'')+'"><em>'+(i+1)+'</em></div>';}).join('')+'</div></div>').join('')+(confirm?'<button '+(!draftEnd?'disabled':'')+'>确定</button>':'')+(options.duplicateConfirm?'<button '+(!draftEnd?'disabled':'')+'>确定</button>':'');}
document.querySelector('#foreign-confirm')?.addEventListener('click',()=>foreignClicks++);
if(options.inputShift)input.addEventListener('mouseenter',()=>{input.style.marginLeft='80px';},{once:true});
if(options.hoverShift)popup.addEventListener('mouseenter',()=>{popup.style.left='110px';},{once:true});
if(options.confirmShift)popup.addEventListener('mouseover',e=>{if(e.target.tagName==='BUTTON')e.target.style.transform='translateX(30px)';});
if(options.duplicateInput){const second=input.cloneNode(true);second.style.position='absolute';second.style.top='500px';document.body.append(second);}
input.onclick=()=>{popup.hidden=false;draftEnd=null;render();};document.onkeydown=e=>{if(e.key==='Escape'&&!options.noEsc){setTimeout(()=>{popup.hidden=true;start=null;resets++;},options.escDelay||0);}};
document.addEventListener('mousedown',e=>{if(popup.hidden||popup.contains(e.target)||e.target===input)return;outside++;if(!options.permanent)setTimeout(()=>{popup.hidden=true;start=null;resets++;},250);});
popup.onclick=e=>{if(pending)return;if(e.target.tagName==='BUTTON'){input.value=start+' ~ '+draftEnd;popup.hidden=true;start=null;return;}const arrow=e.target.closest('[class*=btn-arrow]');if(arrow){pending=true;arrows++;setTimeout(()=>{month+=arrow.className.includes('prev')?-1:1;render();pending=false;},${monthDelay});return;}const cell=e.target.closest('[data-date]');if(!cell)return;clicks++;if(drop){drop=false;return;}const d=cell.dataset.date;pending=true;setTimeout(()=>{if(!start){start=d;selected=[d];render();}else if(confirm){draftEnd=d;selected=[start,d];render();}else{input.value=start+' ~ '+d;selected=[start,d];popup.hidden=true;start=null;}pending=false;},${delay});};
if(${half}){start='2026-10-07';selected=[start];popup.hidden=false;render();}if(options.duplicatePopup){const second=popup.cloneNode(true);second.hidden=false;second.style.left='300px';document.body.append(second);}
</script>`;}
process.on('uncaughtException',e=>{console.error(e.stack);app.exit(1);});
process.on('unhandledRejection',e=>{console.error(e?.stack||e);app.exit(1);});
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{const checks=[];try{
 const closeOnly=process.env.SHIMA_CALENDAR_CLOSE_ONLY==='1';
 const robustOnly=process.env.SHIMA_STABLE_OPERATIONS_ONLY==='1';
 const scenarios=robustOnly?[{inputShift:true},{hoverShift:true},{confirm:true,confirmShift:true},{confirm:true,unrelatedConfirm:true},{confirm:true,duplicateConfirm:true,ambiguous:true},{duplicateInput:true,ambiguous:true},{half:true,duplicatePopup:true,ambiguous:true}]:closeOnly?[{half:true,noEsc:true},{drop:true,noEsc:true},{half:true,noEsc:true,permanent:true,fail:true},{half:true,noEsc:true,interactive:true,fail:true},{half:true,noEsc:true,blocked:true,fail:true},{half:true,escDelay:700},{half:true,noEsc:true,cancel:true}]:process.env.SHIMA_PAGE_EXTENDED==='1'?[{confirm:true,same:true}]:[{}, {drop:true}, {same:true}, {confirm:true}, {confirm:true,same:true}, {half:true}];
 async function runCase(width,scenario){
  const {drop=false,confirm=false,same=false,half=false,cancel=false}=scenario;
  const win=new BrowserWindow({show:false,width,height:850,webPreferences:{backgroundThrottling:false}});
  try{
   await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(fixture(drop,confirm,half,scenario)));
   const host=Object.create(PromotionFee.prototype);Object.assign(host,{stopped:false,writeFailure:false,hidden:true});const jd=new JdPromotionFee({host});
   const dates={start:drop?'2026-08-15':'2026-10-01',end:same?'2026-10-01':'2026-10-23'};
   if(cancel){
    const work=jd.setDates(win,dates);const timer=setTimeout(()=>{host.stopped=true;},200);
    try{await assert.rejects(work,/暂停/);}finally{clearTimeout(timer);}
    const before=await win.webContents.executeJavaScript('result()');await new Promise(r=>setTimeout(r,delay+150));
    const after=await win.webContents.executeJavaScript('result()');assert.equal(after.clicks,before.clicks);assert.equal(after.value,'2026-09-23 ~ 2026-10-23');
   }else if(scenario.ambiguous){
    await assert.rejects(jd.setDates(win,dates),/不唯一/);const result=await win.webContents.executeJavaScript('result()');assert.equal(result.clicks,scenario.duplicateConfirm?2:0);assert.equal(result.outside,0);
   }else if(scenario.fail){
    await assert.rejects(jd.setDates(win,dates),/日期面板未关闭/,JSON.stringify({width,...scenario}));
    const result=await win.webContents.executeJavaScript('result()');assert.equal(result.clicks,0);assert.equal(result.value,'2026-09-23 ~ 2026-10-23');
    assert.equal(result.outside,scenario.permanent?1:0);
   }else{
    await jd.setDates(win,dates);
    const result=await win.webContents.executeJavaScript('result()');assert.equal(result.value,dates.start+' ~ '+dates.end);assert.equal(result.open,false);assert.equal(result.foreignClicks,0);assert.equal(result.clicks,drop?3:2);if(drop)assert.equal(result.arrows,2);if(half)assert.ok(result.resets>=1);if(scenario.noEsc)assert.equal(result.outside,1);if(scenario.escDelay)assert.equal(result.outside,0);
   }
   checks.push({width,...scenario,delayedSelectionMs:delay,delayedMonthMs:monthDelay});
  }finally{win.destroy();}
 }
 for(const width of [1280,620])for(const scenario of scenarios)await runCase(width,scenario);
 if(!robustOnly&&!closeOnly&&process.env.SHIMA_PAGE_EXTENDED!=='1'){
  await Promise.all([runCase(1280,{confirm:true,parallel:true}),runCase(620,{same:true,parallel:true})]);
  await runCase(620,{cancel:true});
 }
 fs.writeFileSync(path.join(root,'.disposable-test.json'),JSON.stringify({completed:true,disposable:true}));console.log(JSON.stringify({success:true,checks}));app.quit();
 }catch(e){console.error(e.stack);app.exit(1);}});
