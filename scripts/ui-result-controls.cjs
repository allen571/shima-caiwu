'use strict';
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.env.SHIMA_UI_TEST_ROOT;app.setPath('userData',root);app.on('window-all-closed',()=>{});
const source=name=>fs.readFileSync(path.join(__dirname,'..','ui',name),'utf8');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 const now='2026-11-14T00:00:00.000Z',old='2026-11-13T00:00:00.000Z';
 try{
  for(const width of [1280,620]){
   win.setSize(width,900);await win.loadURL('data:text/html;charset=utf-8,<html><body><main id="root"></main></body></html>');
   await win.webContents.executeJavaScript(`window.sample={
    shops:[
     {id:'good',name:'合成店一',username:'synthetic1',platform:'taobao',loginConfirmedAt:'${now}',checkStatus:'expired',checkAt:'${old}'},
     {id:'expired',name:'合成店二',username:'synthetic2',platform:'taobao',loginConfirmedAt:'${old}',checkStatus:'expired',checkAt:'${now}'},
     {id:'manual',name:'合成店三',username:'synthetic3',platform:'tmall',loginNeedsAttention:true},
     {id:'jd',name:'合成京东',username:'synthetic4',platform:'jd'}
    ],
    results:[
     {shopId:'good',shopName:'合成店一',platform:'taobao',status:'completed',amountCents:100,start:'2026-11-01',end:'2026-11-12'},
     {shopId:'manual',shopName:'合成店三',platform:'tmall',status:'manual',start:'2026-11-01',end:'2026-11-12'},
     {shopId:'jd',shopName:'合成京东',platform:'jd',status:'completed',amountCents:200,start:'2026-11-01',end:'2026-11-12',queryStart:'2026-11-02',queryEnd:'2026-11-13'}
    ],stale:[],concurrency:1,manual:{count:1,shops:[{shopId:'manual'}]}};
    window.fundSample={shops:window.sample.shops,results:[{shopId:'good',shopName:'合成店一',platform:'taobao',month:'2026-11',day:'2026-11-12',status:'completed',source:'日汇总',days:1,incomeCents:100,expenseCents:0}],stale:[],batchDone:[]};
    window.selectionDesktop={promotionFee:async()=>window.sample,fundSummary:async()=>window.fundSample,scheduler:async()=>({running:false})};void 0;`);
   await win.webContents.insertCSS(source('finance.css')+source('promotion-fee.css')+source('fund-summary.css'));
   await win.webContents.executeJavaScript(source('promotion-fee.js')+';void 0');
   await win.webContents.executeJavaScript("window.PromotionFee.mount(document.querySelector('#root'))");
   let state=await win.webContents.executeJavaScript(`(()=>{document.querySelector('#pf-select-failed').click();return {ids:[...document.querySelectorAll('[data-select]:checked')].map(e=>e.dataset.select),total:document.querySelector('#pf-total').textContent,jd:[...document.querySelectorAll('#pf-results tr')].find(e=>e.textContent.includes('合成京东')).textContent}})()`);
   assert.deepEqual(state.ids,['expired','manual']);
   assert.match(state.total,/结果业务日期 2026-11-01 ～ 2026-11-12/);
   assert.match(state.total,/京东实查 2026-11-02 ～ 2026-11-13/);
   assert.match(state.jd,/2026-11-02 ～ 2026-11-13/);
   assert.match(state.jd,/业务日期 2026-11-01 ～ 2026-11-12/);
   if(process.env.SHIMA_UI_EVIDENCE)fs.writeFileSync(path.join(root,'promotion-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
   await win.webContents.executeJavaScript("document.querySelector('#root').innerHTML=''");
   await win.webContents.executeJavaScript(source('fund-summary.js')+';void 0');
   await win.webContents.executeJavaScript("window.FundSummary.mount(document.querySelector('#root'))");
   state=await win.webContents.executeJavaScript(`(()=>{document.querySelector('#fs-select-failed').click();document.querySelector('#fs-shops-toggle').click();return {ids:[...document.querySelectorAll('[data-fund-select]:checked')].map(e=>e.dataset.fundSelect),text:document.querySelector('#fs-results').textContent}})()`);
   assert.deepEqual(state.ids,['expired','manual']);assert.match(state.text,/2026-11-12/);
   await win.webContents.executeJavaScript("window.fundSample.results[0].day='2026-11-13'");
   await new Promise(r=>setTimeout(r,1500));
   assert.match(await win.webContents.executeJavaScript("document.querySelector('#fs-results').textContent"),/2026-11-13/);
   assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-daily]').textContent"),'下载整月明细');
   if(process.env.SHIMA_UI_EVIDENCE)fs.writeFileSync(path.join(root,'fund-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  console.log(JSON.stringify({success:true,widths:[1280,620]}));
 }finally{win.destroy();}
}).then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)});
