'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PromotionFee}=require('../electron/promotion-fee.cjs'),{JdPromotionFee}=require('../electron/promotion-fee-jd.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-navigation-controls-'));app.setPath('userData',root);if(process.platform==='darwin')app.setActivationPolicy('prohibited');app.on('window-all-closed',()=>{});
process.on('uncaughtException',e=>{console.error(e.stack);app.exit(1);});process.on('unhandledRejection',e=>{console.error(e.stack);app.exit(1);});
const html=blocked=>`<style>button{margin:12px;padding:12px}</style><div id="menu"><button>财务管理</button><span>财务记录</span></div><main></main><script>let calls=0,staticClicks=0;document.onclick=e=>{if(e.target.tagName==='SPAN')staticClicks++;if(e.target.tagName!=='BUTTON')return;calls++;if(${blocked})return;setTimeout(()=>{if(e.target.innerText==='财务管理')menu.innerHTML='<button>财务管理</button><button>财务记录</button><span>收支汇总</span>';else if(e.target.innerText==='财务记录')menu.innerHTML='<button>财务管理</button><button>财务记录</button><button>收支汇总</button>';else document.querySelector('main').innerHTML='<input placeholder="请选择日期" value="2026-10-01 ~ 2026-10-23"><p>推广费消费金额 12.34</p>';},600);};window.result=()=>({calls,staticClicks});</script>`;
app.whenReady().then(async()=>{try{
 for(const width of [1280,620])for(const blocked of [false,true]){
  const win=new BrowserWindow({show:false,width,height:850,webPreferences:{backgroundThrottling:false}});try{
   await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html(blocked)));
   const host=Object.create(PromotionFee.prototype);Object.assign(host,{stopped:false,writeFailure:false,pageReadyTimeoutMs:blocked?1100:5000});const jd=new JdPromotionFee({host});
   if(blocked)await assert.rejects(jd.navigateReady(win,'财务管理'),/导航后目标页面未就绪/);else for(const label of ['财务管理','财务记录','收支汇总'])await jd.navigateReady(win,label);
   const result=await win.webContents.executeJavaScript('result()');assert.equal(result.calls,blocked?1:3);assert.equal(result.staticClicks,0);
  }finally{win.destroy();}
 }
 fs.writeFileSync(path.join(root,'.disposable-test.json'),JSON.stringify({completed:true,disposable:true}));console.log(JSON.stringify({success:true}));app.quit();
 }catch(e){console.error(e.stack);app.exit(1);}});
