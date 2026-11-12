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
test('填入未完成时落诊断包：JSON+DOM+不含密码明文，同店只采一次',async t=>{
 const s=setup(t);
 const shop=s.data.shops[0],win=fakeWin({url:'https://loginmyseller.taobao.com/',body:'扫码登录 密码登录',inputs:2,passwords:1,passwordFilled:false,usernameFilled:false,disabledPassword:false,iframes:[]});
 const dir=await s.captureLoginFailure(shop,win,'填入结果 manual','登录自动填入未完成');
 assert.ok(dir,'应返回目录');
 assert.ok(fs.existsSync(path.join(dir,'诊断.json')));
 assert.ok(fs.existsSync(path.join(dir,'frame-1.html')));
 const report=JSON.parse(fs.readFileSync(path.join(dir,'诊断.json'),'utf8'));
 assert.equal(report.trigger,'登录自动填入未完成');
 assert.equal(report.shop.username,'甲店账号');
 assert.equal(report.frames[0].state.passwordFilled,false);
 const raw=fs.readFileSync(path.join(dir,'诊断.json'),'utf8')+fs.readFileSync(path.join(dir,'frame-1.html'),'utf8');
 assert.equal(raw.includes('sample-secret'),false,'密码明文绝不能进诊断包');
 // 截图：窗口不可见 → 不落截图文件
 assert.equal(fs.existsSync(path.join(dir,'页面截图.png')),false);
 // 同店第二次采集被跳过
 assert.equal(await s.captureLoginFailure(shop,win,'again','again'),'');
});
test('一轮上限 5 个包，窗口已销毁时不采集',async t=>{
 const s=setup(t);
 for(let i=0;i<5;i++){
  s.putShop({name:'店'+i,username:'u'+i,password:'p'+i});
  const shop=s.data.shops.find(x=>x.name==='店'+i);
  const dir=await s.captureLoginFailure(shop,fakeWin({url:'https://loginmyseller.taobao.com/',inputs:1,passwords:1,passwordFilled:false,usernameFilled:false,iframes:[]}),'x','y');
  assert.ok(dir,'第'+(i+1)+'个包应生成');
 }
 const shop6=s.data.shops.find(x=>x.name==='甲店');
 assert.equal(await s.captureLoginFailure(shop6,fakeWin({inputs:0,passwords:0,iframes:[]}),'x','y'),'','第 6 个包应被上限拦住');
 assert.equal(await s.captureLoginFailure(shop6,{isDestroyed:()=>true,webContents:{isDestroyed:()=>true}}),'','窗口销毁应返回空');
});
test('批量遇滑块跳过前先采集现场再抛 NEEDS_MANUAL',async t=>{
 const s=setup(t);
 s.interactive=false;
 const shop=s.data.shops[0],win=fakeWin({url:'https://loginmyseller.taobao.com/',body:'请拖动下方滑块完成验证',inputs:2,passwords:1,passwordFilled:false,usernameFilled:false,iframes:[]});
 await assert.rejects(s.attention(shop,win,'请完成滑块验证'),error=>error.code==='NEEDS_MANUAL');
 const dirs=fs.readdirSync(s.root).filter(d=>d.startsWith('诗玛登录诊断_'));
 assert.equal(dirs.length,1,'跳过路径应落一个包');
 const report=JSON.parse(fs.readFileSync(path.join(s.root,dirs[0],'诊断.json'),'utf8'));
 assert.match(report.trigger,/需人工验证自动跳过/);
 assert.match(report.detail,/滑块/);
});
test('identity 自动填入失败链路：填入 manual → 采集 → 转 NEEDS_MANUAL',async t=>{
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
 assert.equal(dirs.length,1,'填入失败与滑块跳过去重后只落一个包');
 const report=JSON.parse(fs.readFileSync(path.join(s.root,dirs[0],'诊断.json'),'utf8'));
 assert.equal(report.trigger,'登录自动填入未完成');
});
