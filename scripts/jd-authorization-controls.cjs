'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PromotionFee}=require('../electron/promotion-fee.cjs'),{JdPromotionFee,jdAuthorizationPage}=require('../electron/promotion-fee-jd.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-authorization-controls-'));app.setPath('userData',root);if(process.platform==='darwin')app.setActivationPolicy('prohibited');app.on('window-all-closed',()=>{});for(const event of ['uncaughtException','unhandledRejection'])process.on(event,e=>{console.error(e.stack);app.exit(1);});
const html=`<style>[hidden]{display:none!important}body{font:14px sans-serif;margin:14px}table{border-collapse:collapse;min-width:750px}th,td{padding:12px;border:1px solid #ddd}.table-scroll{overflow:auto}button{padding:9px}</style><button id="entry">账号授权</button><div id="content"></div><script>
let page=0,clicks=[];const pages=[[{id:'90001001',name:'合成账户A',status:'过期'},{id:'90001002',name:'合成账户B',status:'过期'}],[{id:'90001001',name:'合成账户A',status:'生效中'},{id:'90001003',name:'合成账户C',status:'生效中'},{id:'90001001',name:'合成账户A',status:'生效中'}]];
function render(){content.innerHTML='<div class="table-scroll"><table class="jad-table"><thead><tr><th>授权<br>状态</th><th>授权有效期</th><th>被授权账户</th><th>授权账户 ?</th><th>操作</th></tr></thead><tbody>'+pages[page].map(r=>'<tr><td>'+r.status+'</td><td>2024-01-01 至 '+(r.status==='生效中'?'2027-12-31':'2026-01-01')+'</td><td>synthetic-finance</td><td>'+r.name+'<br>ID:'+r.id+'</td><td><button data-id="'+r.id+'" '+(r.status==='过期'?'disabled':'')+'>免密登录授权账户</button></td></tr>').join('')+'</tbody></table></div><span aria-current="page">'+(page+1)+'</span><span>共5条</span><button title="下一页" '+(page===1?'disabled':'')+'>下一页</button><div class="jad-loading" hidden>加载中</div>';if(page===0){const next=document.querySelector('button[title="下一页"]');next.disabled=true;setTimeout(()=>{next.disabled=false;},1100);}}
window.goPage=p=>{page=p;render();};entry.onclick=()=>setTimeout(render,550);document.addEventListener('click',e=>{if(e.target.dataset.id)clicks.push(e.target.dataset.id);if(e.target.title==='下一页'){document.querySelector('.jad-loading').hidden=false;setTimeout(()=>{page++;render();},450);}});window.result=()=>({page,clicks});
</script>`;
app.whenReady().then(async()=>{try{for(const width of [1280,620]){
 const win=new BrowserWindow({show:false,width,height:900,webPreferences:{backgroundThrottling:false}});try{
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));const host=Object.create(PromotionFee.prototype);Object.assign(host,{stopped:false,writeFailure:false,pageReadyTimeoutMs:5000});const jd=new JdPromotionFee({host});
  await jd.openAuthorizationList(win);assert.equal(await win.webContents.executeJavaScript("document.body.innerText.includes('授权状态')"),false);
  const result=await jd.listAuthorizations(win);assert.equal(result.targets.length,2);assert.equal(result.targets.find(r=>r.accountId==='90001001').page,1);assert.equal(result.notices.length,2);assert.equal(result.notices.find(n=>n.accountId==='90001001').stillActive,true);assert.equal(result.notices.find(n=>n.accountId==='90001002').stillActive,false);
  // Narrow view may hide the operation column; scroll only the synthetic table before clicking its row.
  await win.webContents.executeJavaScript("document.querySelector('.table-scroll').scrollLeft=1000");
  assert.equal(await host.execute(win,'('+jdAuthorizationPage.toString()+')({action:"login",accountId:"90001001"})',true),true);assert.deepEqual(await win.webContents.executeJavaScript('result().clicks'),['90001001']);
  await win.webContents.executeJavaScript("document.querySelector('tbody tr td:nth-child(4)').textContent='合成缺失ID账户'");await assert.rejects(jd.authorizationState(win),/ID未识别/);
  await win.webContents.executeJavaScript('goPage(0)');assert.equal(await host.execute(win,'('+jdAuthorizationPage.toString()+')({action:"login",accountId:"90001001"})',true),false);assert.deepEqual(await win.webContents.executeJavaScript('result().clicks'),['90001001']);
 }finally{win.destroy();}}
 fs.writeFileSync(path.join(root,'.disposable-test.json'),JSON.stringify({completed:true,disposable:true}));console.log(JSON.stringify({success:true}));app.quit();
 }catch(e){console.error(e.stack);app.exit(1);}});
