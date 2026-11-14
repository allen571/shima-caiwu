'use strict';
// v1.2.84 登录现场自动诊断包：自动填入未完成 / 批量遇滑块跳过时落盘现场，
// 用户把桌面「诗玛登录诊断_店铺名」文件夹发回即可定位「账号密码没写入 / 白板」。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PromotionFee}=require('../electron/promotion-fee.cjs');
const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('encrypted:'+s),decryptString:b=>b.toString().slice(10)};
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-login-diag-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const service=new PromotionFee({root,safeStorage,desktop:root});
 service.putShop({name:'甲店',username:'甲店账号',password:'sample-secret'});
 return service;
}
// 假窗口：executeJavaScript 返回固定页面快照；不可见（截图跳过路径也要能走通）
function fakeWin(state,html){
 const noop=()=>{};
 const wc={isDestroyed:()=>false,executeJavaScript:async script=>String(script).includes('outerHTML')?{url:'https://loginmyseller.taobao.com/',html:html||'<html><body>login-skeleton</body></html>'}:state,url:'https://loginmyseller.taobao.com/',once:noop,removeListener:noop};
 wc.mainFrame={framesInSubtree:[wc]};
 const win={isDestroyed:()=>false,isVisible:()=>false,show:noop,focus:noop,isMinimized:()=>false,hide:noop,once:noop,removeListener:noop,webContents:wc};
 win.webContents.isDestroyed=wc.isDestroyed;
 return win;
}
test('批量遇滑块保留人工验证提示且不生成诊断包',async t=>{
 const s=setup(t);
 s.interactive=false;
 const shop=s.data.shops[0],win=fakeWin({url:'https://loginmyseller.taobao.com/',body:'请拖动下方滑块完成验证',inputs:2,passwords:1,passwordFilled:false,usernameFilled:false,iframes:[]});
 await assert.rejects(s.attention(shop,win,'请完成滑块验证'),error=>error.code==='NEEDS_MANUAL');
 const dirs=fs.readdirSync(s.root).filter(d=>d.startsWith('诗玛登录诊断_'));
 assert.equal(dirs.length,0);
});
test('identity 自动填入失败链路：填入 manual 后保留 NEEDS_MANUAL 且不生成诊断包',async t=>{
 const s=setup(t);
 s.interactive=false;
 const shop=s.data.shops[0],win=fakeWin({url:'https://loginmyseller.taobao.com/',inputs:2,passwords:1,passwordFilled:false,usernameFilled:false,iframes:[]});
 s.load=async()=>{};
 s.authState=async(win,credentials)=>credentials?{status:'manual'}:{status:'form'};
 s.submitLogin=async()=>({status:'manual'});
 s.hasLoginAttempt=()=>false;
 s.markLoginRequired=()=>{};
 s.beginLoginAttempt=()=>true;
 await assert.rejects(s.identity(shop,win),error=>error.code==='NEEDS_MANUAL');
 const dirs=fs.readdirSync(s.root).filter(d=>d.startsWith('诗玛登录诊断_'));
 assert.equal(dirs.length,0);
});
