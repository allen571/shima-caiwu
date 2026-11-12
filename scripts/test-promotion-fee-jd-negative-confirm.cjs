'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {JdPromotionFee}=require('../electron/promotion-fee-jd.cjs');

function fakeWin(){
 const wc={url:'https://xnjzt.jd.com/home#/financialRecord',reloaded:0,
  webContents:{reload(){wc.reloaded++;},isLoading:()=>false},
  mainFrame:{framesInSubtree:[]}};
 return wc;
}

test('收支汇总渲染慢：首次判财务号，重载复判成功后继续取数',async()=>{
 const win=fakeWin(),jd=new JdPromotionFee({host:{assertWindow:()=>win}});
 let calls=0;
 jd.navigateReadyOnce=async(win,label)=>{calls++;if(calls===1&&label==='收支汇总')return 'financeOnly';return undefined;};
 assert.equal(await jd.navigateReady(win,'收支汇总'),undefined);
 assert.equal(win.reloaded,1);
});
test('重载后仍无收支汇总页签，才接受财务号判定',async()=>{
 const win=fakeWin(),jd=new JdPromotionFee({host:{assertWindow:()=>win}});
 jd.navigateReadyOnce=async(win,label)=>label==='收支汇总'?'financeOnly':undefined;
 assert.equal(await jd.navigateReady(win,'收支汇总'),'financeOnly');
 assert.equal(win.reloaded,1);
});
test('首次判无推广但重载后入口出现，正常继续不再报无',async()=>{
 const win=fakeWin(),jd=new JdPromotionFee({host:{assertWindow:()=>win}});
 let calls=0;const none=Error('x');none.promotionNone=true;
 jd.navigateReadyOnce=async()=>{calls++;if(calls===1)throw none;return undefined;};
 await jd.navigateReady(win,'财务管理');
 assert.equal(win.reloaded,1);
});
test('重载后仍无财务管理入口，维持无推广判定',async()=>{
 const win=fakeWin(),jd=new JdPromotionFee({host:{assertWindow:()=>win}});
 const none=Error('x');none.promotionNone=true;
 jd.navigateReadyOnce=async()=>{throw none;};
 await assert.rejects(jd.navigateReady(win,'财务管理'),e=>{assert.ok(e.promotionNone);return true;});
});
test('非负向错误不重载直接抛出（保持原诊断语义）',async()=>{
 const win=fakeWin(),jd=new JdPromotionFee({host:{assertWindow:()=>win}});
 jd.navigateReadyOnce=async()=>{throw Error('京东财务记录可操作入口未就绪');};
 await assert.rejects(jd.navigateReady(win,'财务记录'),/未就绪/);
 assert.equal(win.reloaded,0);
});
test('授权列表首次判无推广时重载复判，第二次成功即继续',async()=>{
 const win=fakeWin(),jd=new JdPromotionFee({host:{assertWindow:()=>win}});
 let calls=0;const none=Error('x');none.promotionNone=true;
 jd.waitAuthorizationsOnce=async(win,previous)=>{calls++;if(calls===1&&!previous)throw none;return {ready:true,rows:[{id:'x'}],signature:'s',pageNumber:1};};
 const state=await jd.waitAuthorizations(win);
 assert.equal(state.rows.length,1);
 assert.equal(win.reloaded,1);
});
test('授权列表重载复判后仍无推广，维持判定',async()=>{
 const win=fakeWin(),jd=new JdPromotionFee({host:{assertWindow:()=>win}});
 const none=Error('x');none.promotionNone=true;
 jd.waitAuthorizationsOnce=async()=>{throw none;};
 await assert.rejects(jd.waitAuthorizations(win),e=>{assert.ok(e.promotionNone);return true;});
 assert.equal(win.reloaded,1);
});
test('翻页场景（有 previous）不复判不重载',async()=>{
 const win=fakeWin(),jd=new JdPromotionFee({host:{assertWindow:()=>win}});
 const none=Error('x');none.promotionNone=true;
 jd.waitAuthorizationsOnce=async()=>{throw none;};
 await assert.rejects(jd.waitAuthorizations(win,{pageNumber:1,signature:'s'}),e=>{assert.ok(e.promotionNone);return true;});
 assert.equal(win.reloaded,0);
});
test('判财务号前放宽探测找到汇总入口：报请补查，不静默判财务号',async()=>{
 const win=fakeWin(),jd=new JdPromotionFee({host:{assertWindow:()=>win,pageReadyTimeoutMs:30,execute:async()=>1}});
 jd.jdFrames=()=>[];
 jd.financeDiagnostics=async()=>({frames:[{frame:'https://xnjzt.jd.com/home#/financialRecord',tabs:['充值记录','消费记录']}]});
 jd.widenedSummaryProbe=async()=>'推广费汇总';
 await assert.rejects(jd.navigateReady(win,'收支汇总'),e=>{assert.ok(e.message.includes('疑似存在')&&e.message.includes('推广费汇总'));return true;});
});
test('放宽探测无候选：维持财务号判定并记录判定依据',async()=>{
 const win=fakeWin(),jd=new JdPromotionFee({host:{assertWindow:()=>win,pageReadyTimeoutMs:30,execute:async()=>1}});
 jd.jdFrames=()=>[];
 jd.financeDiagnostics=async()=>({frames:[{frame:'https://xnjzt.jd.com/home#/financialRecord',tabs:['充值记录']}]});
 jd.widenedSummaryProbe=async()=>null;
 assert.equal(await jd.navigateReady(win,'收支汇总'),'financeOnly');
 assert.ok(jd.recordPageNote.includes('未见「收支汇总」入口'));
});
test('judgeNegativeAccount：上次有金额却判无 → 失败补查；无历史 → 保持负向并附依据',()=>{
 const {judgeNegativeAccount}=require('../electron/promotion-fee-jd.cjs');
 const prior={status:'completed',amountCents:712124};
 const a=judgeNegativeAccount(prior,'none','');
 assert.equal(a.status,'failed');assert.ok(a.error.includes('7121.24'));
 const b=judgeNegativeAccount(null,'finance-only','判定依据：财务记录页未见「收支汇总」入口');
 assert.equal(b.status,'finance-only');assert.ok(b.error.includes('判定依据'));
 const c=judgeNegativeAccount({status:'completed',amountCents:0},'none','');
 assert.equal(c.status,'none');
});
