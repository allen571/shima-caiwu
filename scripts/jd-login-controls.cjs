'use strict';
// 独立 Electron 控件验收：HTTPS 请求由隔离 session 本地响应，不访问京东或正式用户数据。
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {jdPage,JdPromotionFee}=require('../electron/promotion-fee-jd.cjs');
const {loginPage,PLATFORMS}=require('../electron/platform-login.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-jd-controls-'));
app.setPath('userData',root);
if(process.platform==='darwin')app.setActivationPolicy('prohibited');
app.on('window-all-closed',()=>{});
const credentials={username:'synthetic-account',password:'synthetic-password'};
let html='';
function fixture({legacy=false,duplicate=false,agreement=false,challenge=false,action='',tag='button'}={}){
 return `<html><meta charset="utf-8"><style>input{display:block;width:280px;margin:16px}button,a{display:block}</style><body>${challenge?'请完成验证':''}<form ${action?`action="${action}"`:''} onsubmit="return false"><input style="display:none" placeholder="账号"><input ${legacy?'id="loginname"':''} placeholder="请输入账号名/邮箱" aria-label="账号"><input type="password" placeholder="请输入登录密码">${duplicate?'<input placeholder="用户名">':''}${agreement?'<label><input type="checkbox">我同意协议</label>':''}<${tag} ${tag==='a'?'href="#"':''} onclick="window.clicks=(window.clicks||0)+1;window.clickedAt=Date.now();return false">立即登录</${tag}></form><script>window.clicks=0;window.events=[];window.timeline=[];document.addEventListener('input',e=>{events.push(e.type);timeline.push({type:e.target.type,at:Date.now()});});document.addEventListener('change',e=>events.push(e.type));</script></body></html>`;
}
async function expectPrepared(observe,win,input,context){
 const state=await observe(input);
 if(state.status!=='prepared'){
  const diagnostic=await win.webContents.executeJavaScript(`({activeTag:document.activeElement?.tagName,activeType:document.activeElement?.type,inputLengths:[...document.querySelectorAll('input')].filter(e=>e.getClientRects().length).map(e=>e.value.length),hasFocus:document.hasFocus(),events:window.events})`);
  console.error(JSON.stringify({fixtureDiagnostic:context,status:state.status,loading:win.webContents.isLoadingMainFrame(),...diagnostic}));
 }
 assert.equal(state.status,'prepared');
}
app.whenReady().then(async()=>{
 const ses=session.fromPartition('jd-controls-'+Date.now());
 await ses.protocol.handle('https',()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}));
 const win=new BrowserWindow({show:false,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 const read=()=>win.webContents.executeJavaScript('('+jdPage.toString()+')('+JSON.stringify({credentials})+')');
 const report=[];
 try{
  for(const width of [1100,640]){
   win.setSize(width,760);
   for(const options of [{},{legacy:true},{tag:'a'},{duplicate:true},{agreement:true},{challenge:true},{action:'https://evil.test/'}]){
    html=fixture(options);await win.loadURL('https://passport.shop.jd.com/login');
    const expected=options.duplicate?'unknown':options.agreement?'agreement':options.challenge?'verification':options.action?'untrusted':'submitted';
    assert.equal((await read()).status,expected);
    const state=await win.webContents.executeJavaScript(`({values:[...document.querySelectorAll('input')].filter(e=>e.getClientRects().length>0&&e.type!=='checkbox').map(e=>e.value),clicks:window.clicks,events:window.events})`);
    assert.equal(state.clicks,expected==='submitted'?1:0);
    if(expected==='submitted'){assert.deepEqual(state.values,[credentials.username,credentials.password]);assert.deepEqual(state.events,['input','change','input','change']);}
    else assert(state.values.every(v=>v===''));
    report.push({width,options,status:expected});
   }
  }
  for(const preset of ['', 'user-entered', 'password-entered']){
   html=fixture();await win.loadURL('https://passport.shop.jd.com/login');
   if(preset)await win.webContents.executeJavaScript(preset==='password-entered'?`document.querySelector('input[type=password]').value='password-entered'`:`document.querySelector('input[aria-label]').value='user-entered'`);
   const status=await win.webContents.executeJavaScript('('+jdPage.toString()+')('+JSON.stringify({credentials,fillOnly:true})+')');
   assert.equal(status.status,preset?'manual':'filled');
   const state=await win.webContents.executeJavaScript(`({user:document.querySelector('input[aria-label]').value,pwd:document.querySelector('input[type=password]').value,clicks:window.clicks})`);
   assert.equal(state.clicks,0);assert.equal(state.user,preset==='password-entered'?'':preset||credentials.username);assert.equal(state.pwd,preset==='password-entered'?preset:preset?'':credentials.password);
   // 第二次不得覆盖用户输入或提交。
   assert.equal((await win.webContents.executeJavaScript('('+jdPage.toString()+')('+JSON.stringify({credentials,fillOnly:true})+')')).status,'manual');
  }
  for(const options of [{agreement:true},{challenge:true}]){
   html=fixture(options);await win.loadURL('https://passport.shop.jd.com/login');
   assert.equal((await win.webContents.executeJavaScript('('+jdPage.toString()+')('+JSON.stringify({credentials,fillOnly:true})+')')).status,options.agreement?'agreement':'verification');
   assert.equal(await win.webContents.executeJavaScript(`window.clicks+[...document.querySelectorAll('input')].filter(e=>e.type!=='checkbox'&&e.value).length`),0);
  }
  let platformCases=0;
  for(const host of ['loginmyseller.taobao.com','login.taobao.com','login.tmall.com']){
   const config={...PLATFORMS.qianniu,loginHosts:[...PLATFORMS.qianniu.loginHosts,'loginmyseller.taobao.com']};
   for(const width of [1100,640])for(const mode of ['automatic','fillOnly','existing-user','existing-password']){
    win.setSize(width,760);html=fixture();await win.loadURL('https://'+host+'/');
    if(mode==='existing-user')await win.webContents.executeJavaScript(`document.querySelector('input[aria-label]').value='manual-user'`);
    if(mode==='existing-password')await win.webContents.executeJavaScript(`document.querySelector('input[type=password]').value='manual-password'`);
    const input={...credentials,...(mode==='automatic'?{}:{fillOnly:true})};
    const state=await win.webContents.executeJavaScript('('+loginPage.toString()+')('+JSON.stringify(config)+','+JSON.stringify(input)+')');
    assert.equal(state.status,mode==='automatic'?'submitted':mode==='fillOnly'?'filled':'manual');
    const result=await win.webContents.executeJavaScript(`({user:document.querySelector('input[aria-label]').value,pwd:document.querySelector('input[type=password]').value,clicks:window.clicks})`);
    assert.equal(result.clicks,mode==='automatic'?1:0);
    assert.equal(result.user,mode==='existing-user'?'manual-user':mode==='existing-password'?'':credentials.username);
    assert.equal(result.pwd,mode==='existing-password'?'manual-password':mode==='existing-user'?'':credentials.password);
    platformCases++;
   }
  }
  const {PromotionFee}=require('../electron/promotion-fee.cjs');
  const coordinator=Object.create(PromotionFee.prototype);coordinator.stopped=false;coordinator.writeFailure=false;
  for(const host of ['passport.shop.jd.com','loginmyseller.taobao.com','login.tmall.com'])for(const width of [1100,640]){
   win.setSize(width,760);
   html=fixture();await win.loadURL('https://'+host+'/');
   const config={...PLATFORMS.qianniu,loginHosts:[...PLATFORMS.qianniu.loginHosts,'loginmyseller.taobao.com']};
   const adapter=new JdPromotionFee({host:coordinator});
   const observe=input=>host==='passport.shop.jd.com'?adapter.observe(win,{credentials:input}):coordinator.authState(win,input);
   assert.equal((await coordinator.submitLogin(win,observe,credentials)).status,'submitted');
   const timing=await win.webContents.executeJavaScript(`({timeline,clickedAt:window.clickedAt,clicks:window.clicks})`);
   assert.deepEqual([...new Set(timing.timeline.map(e=>e.type))],['text','password']);const passwordStart=timing.timeline.findIndex(e=>e.type==='password');assert(timing.timeline[passwordStart].at-timing.timeline[passwordStart-1].at>=450);assert(timing.clickedAt-timing.timeline.at(-1).at>=900);assert.equal(timing.clicks,1);
   platformCases++;
   html=fixture();await win.loadURL('https://'+host+'/');
   const filled=host==='passport.shop.jd.com'?await adapter.observe(win,{credentials,fillOnly:true}):await coordinator.authState(win,{...credentials,fillOnly:true});assert.equal(filled.status,'filled');assert.equal(await win.webContents.executeJavaScript('window.clicks'),0);
   html=fixture();await win.loadURL('https://'+host+'/');
   assert.equal((await observe({...credentials,stage:'unexpected'})).status,'manual');assert.equal(await win.webContents.executeJavaScript('window.clicks'),0);
   await expectPrepared(observe,win,{...credentials,stage:'username'},{host,width,stage:'username'});
   await win.webContents.executeJavaScript(`document.querySelector('input[aria-label]').value='manual-change'`);
   assert.equal((await observe({...credentials,stage:'password'})).status,'manual');assert.equal(await win.webContents.executeJavaScript('window.clicks'),0);
   html=fixture();await win.loadURL('https://'+host+'/');
   await expectPrepared(observe,win,{...credentials,stage:'username'},{host,width,stage:'username'});
   await win.webContents.executeJavaScript(`document.querySelector('input[type=password]').value='manual-password'`);
   assert.equal((await observe({...credentials,stage:'password'})).status,'manual');
   assert.equal(await win.webContents.executeJavaScript(`document.querySelector('input[type=password]').value`),'manual-password');assert.equal(await win.webContents.executeJavaScript('window.clicks'),0);
   platformCases++;
  }
  html=fixture();await win.loadURL('https://evil.test/login');assert.equal((await read()).status,'untrusted');
  console.log(JSON.stringify({success:true,cases:report.length+6+platformCases,isolated:true}));
 }finally{win.destroy();await ses.clearStorageData();}
}).then(()=>app.quit()).catch(e=>{console.error(e);app.exit(1);});
app.on('will-quit',()=>fs.rmSync(root,{recursive:true,force:true}));
