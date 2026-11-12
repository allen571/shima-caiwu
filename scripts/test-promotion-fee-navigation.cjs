'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PromotionFee}=require('../electron/promotion-fee.cjs');
function setup(){const p=Object.create(PromotionFee.prototype);p.stopped=false;p.writeFailure=false;const win=new EventEmitter(),wc=new EventEmitter();let destroyed=false,stops=0,resolve,reject;Object.assign(wc,{isDestroyed:()=>destroyed,stop:()=>{stops++;reject?.(Object.assign(Error('aborted'),{code:'ERR_ABORTED'}));},getURL:()=> 'https://shop.jd.com/',isLoadingMainFrame:()=>false});Object.assign(win,{webContents:wc,promotionPlatform:'jd',isDestroyed:()=>destroyed,loadURL:()=>new Promise((a,b)=>{resolve=a;reject=b;}),destroy:()=>{destroyed=true;win.emit('closed');}});return {p,win,wc,resolve:()=>resolve(),stops:()=>stops,clean:()=>assert.deepEqual([win.listenerCount('closed'),wc.listenerCount('destroyed'),wc.listenerCount('render-process-gone')],[0,0,0])};}
for(const reason of ['pause','writeFailure','closed','crash','timeout'])test('页面加载等待响应'+reason+'并清理监听，不吞取消或超时',async()=>{
 const f=setup();f.p.navigationTimeoutMs=f.p.jdNavigationTimeoutMs=reason==='timeout'?20:1000;const work=f.p.load(f.win,'https://shop.jd.com/');
 if(reason==='pause')f.p.stopped=true;if(reason==='writeFailure')f.p.writeFailure=true;if(reason==='closed')f.win.destroy();if(reason==='crash')f.wc.emit('render-process-gone');
 await assert.rejects(work,reason==='pause'?/暂停/:reason==='writeFailure'?/保存失败/:reason==='timeout'?/超时/:/关闭|异常/);f.clean();if(['pause','writeFailure','timeout'].includes(reason))assert.equal(f.stops(),1);
 f.resolve();await new Promise(r=>setImmediate(r));f.clean();
});
test('正常导航完成后释放所有监听',async()=>{const f=setup(),work=f.p.load(f.win,'https://shop.jd.com/');f.resolve();await work;f.clean();assert.equal(f.stops(),0);});
