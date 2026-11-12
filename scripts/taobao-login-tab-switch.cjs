'use strict';
// 新版千牛登录页合成页：默认「短信登录」页签激活，账号/密码输入框已渲染但 disabled。
// 验证 loginPage 能识别该结构：无凭据时报 logged_out（而非把禁用框当可填表单），
// 有凭据时先给「密码登录」页签的原生点击坐标；页签切回后能正常逐段原生填写与提交。
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PLATFORMS,loginPage}=require('../electron/platform-login.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-taobao-login-tab-'));app.setPath('userData',root);if(process.platform==='darwin')app.setActivationPolicy('prohibited');app.on('window-all-closed',()=>{});for(const event of ['uncaughtException','unhandledRejection'])process.on(event,e=>{console.error(e.stack);app.exit(1);});
const config={...PLATFORMS.qianniu};
// data: URL 无 https 主机，测试聚焦页签与填写逻辑：固定 trusted 与 loginHost 判定（二者另有单测/真实页覆盖）。
const source=loginPage.toString().replace(/const trusted=.*?;/,'const trusted=true;').replace(/const loginHost=config\.loginHosts\.includes\(location\.hostname\);/,'const loginHost=true;');
const call=(wc,credentials)=>wc.executeJavaScript('('+source+')('+JSON.stringify(config)+','+JSON.stringify(credentials||null)+')',true);
const pageA=`<style>body{font:14px sans-serif;padding:16px}.tab{display:inline-block;padding:8px 18px;cursor:pointer}.tab.active{color:#fff;background:#2266cc}input{display:block;margin:12px 0;padding:10px;width:240px;background:#f2f2f2}button{padding:10px 60px;background:#2266cc;color:#fff;border:0;cursor:pointer}</style>
<span class="tab active" id="smsTab">短信登录</span><span class="tab" id="pwdTab">密码登录</span>
<div><input id="user" placeholder="账号名/邮箱" disabled><input id="pwd" type="password" placeholder="登录密码" disabled><button id="go" disabled>立即登录</button></div>
<script>let switched=false;pwdTab.onclick=()=>{switched=true;user.disabled=false;pwd.disabled=false;go.disabled=false;};window.pageState=()=>({switched,userVal:user.value,pwdVal:pwd.value});</script>`;
const pageB=`<style>body{font:14px sans-serif;padding:16px}input{display:block;margin:12px 0;padding:10px;width:240px}button{padding:10px 60px}</style>
<span class="tab active">密码登录</span>
<div><input id="user" placeholder="账号名/邮箱"><input id="pwd" type="password" placeholder="登录密码"><button id="go">立即登录</button></div>
<script>window.pageState=()=>({userVal:user.value,pwdVal:pwd.value});</script>`;
const pageC=`<div><input id="user" placeholder="账号名/邮箱" disabled><input id="pwd" type="password" placeholder="登录密码" disabled></div>`;
app.whenReady().then(async()=>{try{
 const win=new BrowserWindow({show:false,width:1180,height:800,webPreferences:{backgroundThrottling:false}});
 const wc=win.webContents;
 const creds={username:'synthetic-finance-user',password:'test-login-pass'};
 // 页面A：新版短信页签 + 禁用密码框
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(pageA));
 assert.deepEqual(await call(wc,null),{status:'logged_out'},'禁用密码框应视为未登录而非可填表单');
 const sw=await call(wc,{...creds,stage:'username',nativeInput:true});
 assert.equal(sw.status,'native','应给页签原生点击坐标');assert.equal(sw.action,'switch','应先切换到密码登录页签');
 assert.equal(typeof sw.x,'number');assert.equal(typeof sw.y,'number');
 const clicked=await call(wc,{...creds});
 assert.equal(clicked.status,'switched','无原生要求时应直接点击页签');
 assert.equal((await wc.executeJavaScript('window.pageState()')).switched,true,'页签应已被点开');
 // 页面B：密码登录页签已启用（等价切回后的状态）
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(pageB));
 assert.deepEqual(await call(wc,null),{status:'form'},'启用表单仍应识别为可填');
 const u=await call(wc,{...creds,stage:'username'});
 assert.equal(u.status,'prepared');assert.equal((await wc.executeJavaScript('window.pageState()')).userVal,creds.username,'账号应已写入');
 const p=await call(wc,{...creds,stage:'password'});
 assert.equal(p.status,'prepared');assert.equal((await wc.executeJavaScript('window.pageState()')).pwdVal,creds.password,'密码应已写入');
 const s=await call(wc,{...creds,stage:'submit',nativeInput:true});
 assert.equal(s.status,'native');assert.equal(s.action,'submit','应给登录按钮原生点击坐标');
 // 原生输入按设计拒绝往非空框打字（防重复输入），先清空模拟用户手动清空后的重试
 await wc.executeJavaScript('user.value=\'\';user.dispatchEvent(new Event(\'input\',{bubbles:true}));');
 const un=await call(wc,{...creds,stage:'username',nativeInput:true});
 assert.equal(un.status,'native');assert.equal(un.action,'username','原生输入应定位账号框');
 // 页面C：密码框禁用且无页签——退回旧行为 logged_out，不误报可填
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(pageC));
 assert.deepEqual(await call(wc,null),{status:'logged_out'});
 console.log(JSON.stringify({success:true}));app.quit();
}catch(e){console.error(e.stack);app.exit(1);}});
