'use strict';
// 新版京准通首页合成页：账户卡「账号授权」只是标题、不可点，入口是卡内「前往」链接。
// 验证 openAuthorizationList 能通过「前往」进入授权列表并等待表格就绪。
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PromotionFee}=require('../electron/promotion-fee.cjs'),{JdPromotionFee}=require('../electron/promotion-fee-jd.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-authorize-entry-'));app.setPath('userData',root);if(process.platform==='darwin')app.setActivationPolicy('prohibited');app.on('window-all-closed',()=>{});for(const event of ['uncaughtException','unhandledRejection'])process.on(event,e=>{console.error(e.stack);app.exit(1);});
const html=`<style>body{font:14px sans-serif;margin:14px}table{border-collapse:collapse;min-width:750px}th,td{padding:12px;border:1px solid #ddd}.account-card{border:1px solid #ddd;padding:10px;width:360px}a{color:#2266cc;cursor:pointer}</style>
<div class="account-card"><span class="t">账号授权</span><span class="d">授权后可查看其他账号投放数据</span><a id="go">前往</a></div>
<div id="content"></div>
<script>
let entered=false,tableShown=false,navClicks=0;
function renderTable(){tableShown=true;content.innerHTML='<table class="jad-table"><thead><tr><th>被授权账户</th><th>授权账户 ?</th><th>授权有效期</th><th>授权状态</th><th>操作</th></tr></thead><tbody><tr><td>synthetic-finance</td><td>合成账户A<br>ID:90001001</td><td>2024-01-01 至 2027-12-31</td><td>生效中</td><td><button data-id="90001001">免密登录授权账户</button></td></tr></tbody></table><span>共1条</span>';}
window.result=()=>({entered,tableShown,navClicks});
document.getElementById('go').onclick=()=>{entered=true;location.hash='/authorize';renderTable();};
document.querySelector('.t').addEventListener('click',()=>{navClicks++;});
</script>`;
app.whenReady().then(async()=>{try{
 const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{backgroundThrottling:false}});
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
 const host=Object.create(PromotionFee.prototype);Object.assign(host,{stopped:false,writeFailure:false,pageReadyTimeoutMs:9000});
 await new JdPromotionFee({host}).openAuthorizationList(win);
 const state=await win.webContents.executeJavaScript('window.result()');
 assert.equal(state.entered,true,'应通过卡内「前往」链接进入授权页');
 assert.equal(state.tableShown,true,'授权列表应已渲染');
 console.log(JSON.stringify({success:true}));app.quit();
}catch(e){console.error(e.stack);app.exit(1);}});
