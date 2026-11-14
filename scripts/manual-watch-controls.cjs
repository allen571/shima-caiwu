'use strict';
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict'),path=require('node:path');
const {PromotionFee}=require('../electron/promotion-fee.cjs');
const root=process.env.SHIMA_WATCH_ROOT;app.setPath('userData',root);app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<100;n++){if(await fn())return;await wait(50);}throw Error('等待合成登录确认超时');}
app.whenReady().then(async()=>{
 const ses=session.fromPartition('manual-watch-'+Date.now());
 await ses.protocol.handle('https',()=>new Response('<html><meta charset="utf-8"><body>请完成验证</body></html>',{headers:{'content-type':'text/html; charset=utf-8'}}));
 const win=new BrowserWindow({show:false,width:1280,height:850,webPreferences:{session:ses,backgroundThrottling:false}});
 try{
  for(const width of [1280,620]){
   win.setSize(width,850);await win.loadURL('https://myseller.taobao.com/home.htm/QnworkbenchHome/');
   const p=new PromotionFee({root:path.join(root,String(width)),safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s)}});
   p.putShop({name:'合成旗舰店',username:'synthetic',password:'synthetic-secret'});
   p.save({...p.data,shops:p.data.shops.map(s=>({...s,boundShop:'合成旗舰店',loginNeedsAttention:true}))});
   const shop=p.data.shops[0];p.windows.set(shop.id,win);p.manualWatchIntervalMs=50;p.beginLoginAttempt(shop);
   let hidden=0;const originalHide=win.hide.bind(win);win.hide=()=>{hidden++;originalHide();};
   p.watchManualLogin(shop,win);await wait(150);assert.equal(hidden,0);
   await win.webContents.executeJavaScript(`document.body.innerHTML='<header style="position:absolute;right:10px;top:10px"><span data-shop-name>合成旗舰店</span></header><main>商品 交易 物流 店铺</main>';void 0`);
   await until(()=>hidden===1);
   assert.equal(p.hasLoginAttempt(shop),false);assert.equal(p.shop(shop.id).loginNeedsAttention,false);
   assert.equal(win.isVisible(),false);assert.equal(win.promotionKeepAlive,true);
   p.stopManualLoginWatch(shop.id);p.windows.clear();win.hide=originalHide;
  }
  await ses.protocol.unhandle('https');await ses.clearStorageData();
  console.log(JSON.stringify({success:true,widths:[1280,620],isolated:true}));
 }finally{win.destroy();}
}).then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)});
