'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PromotionFee}=require('../electron/promotion-fee.cjs');
function makeHost(){
 const p=Object.create(PromotionFee.prototype);
 p.stopped=false;p.writeFailure=false;
 return p;
}
test('登录状态读取遇到已释放的页面框架时返回未知并允许后续观察',async()=>{
 const p=makeHost();let disposed=true;
 const frame={get url(){if(disposed)throw Error('Render frame was disposed before WebFrameMain could be accessed');return 'https://myseller.taobao.com/';},parent:null};
 const wc={isDestroyed:()=>false,mainFrame:{framesInSubtree:[frame]},getURL:()=>frame.url};
 const win={isDestroyed:()=>false,webContents:wc};
 p.readPage=async()=>({status:'logged_in',shopName:'synthetic'});
 assert.deepEqual(await p.authState(win),{status:'unknown'});
 disposed=false;
 assert.deepEqual(await p.authState(win),{status:'logged_in',shopName:'synthetic'});
});
test('登录动作遇到释放的框架不自动重试提交',async()=>{
 const p=makeHost();let executed=0;
 const frame={get url(){throw Error('Render frame was disposed before WebFrameMain could be accessed');}};
 const win={isDestroyed:()=>false,webContents:{isDestroyed:()=>false,mainFrame:{framesInSubtree:[frame]}}};
 p.execute=async()=>{executed++;};
 assert.deepEqual(await p.authState(win,{username:'synthetic',password:'synthetic',stage:'submit'}),{status:'unknown'});
 assert.equal(executed,0);
});
test('查询错误保留页面切换原因，窗口仍打开时不误报关闭',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pf-frame-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const p=new PromotionFee({root,safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s)},adapter:async()=>{throw Error('Render frame was disposed before WebFrameMain could be accessed');}});
 p.putShop({username:'synthetic',password:'synthetic'});const shop=p.data.shops[0];
 await p.start({shopIds:[shop.id],start:'2026-11-01',end:'2026-11-02'});await p.work;
 assert.equal(p.data.results.at(-1).error,'页面跳转时读取中断，请补查该店铺');
});
