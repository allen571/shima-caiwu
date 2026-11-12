'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {JdPromotionFee}=require('../electron/promotion-fee-jd.cjs');

// jdAuthorizationPage 等页面函数是序列化后在真实页面里执行的，
// 语法或引用错误只有运行时才暴露。这里捕获所有注入脚本做编译级验证，
// 并断言关键兼容逻辑（被授权账户两列同名、免密登录按钮）在脚本里。
test('授权页面注入脚本可编译且包含改版兼容逻辑',async()=>{
 const {JdPromotionFee:Jd}=require('../electron/promotion-fee-jd.cjs');
 const scripts=[];
 const jd=new Jd({host:{pageReadyTimeoutMs:60,assertWindow:()=>{},execute:async(win,script)=>{scripts.push(script);return null;}}});
 jd.readPage=async(win,script)=>{scripts.push(script);return {ready:false,reason:'授权列表表头尚未就绪',rows:[],loading:false,empty:false};};
 await jd.waitAuthorizations({}).catch(()=>{});
 // waitAuthorizations 至少注入 authorizationState 与 diagnostics 两段脚本
 assert.ok(scripts.length>=2,'应注入授权状态与诊断脚本');
 for(const script of scripts){
  assert.doesNotThrow(()=>new Function('return ('+script.replace(/^\(/,'').replace(/\)\(\)$/,'')+')')(),script.slice(0,60)+'… 应可编译');
 }
 const page=scripts.find(s=>s.includes('授权账户'));
 assert.ok(page,'应包含授权列表页面脚本');
 assert.ok(page.includes("h.includes('授权账户')"),'表头判定应兼容「被授权账户」改版');
 assert.ok(page.includes('授权列表账户列尚未确认'),'同名双列时应有账户列确认逻辑');
 assert.ok(page.includes('免密登录授权账'),'应保留免密登录按钮匹配');
 // 2026-11 状态词改版：过期/生效改包含匹配，陌生状态但有免密登录控件按可登录处理
 assert.ok(page.includes('/过期|取消|撤销|失效|终止|拒绝/'),'过期判定应为包含匹配（覆盖「授权取消」等新词）');
 assert.ok(page.includes('/生效中|已生效|正常|授权有效/'),'生效判定应为包含匹配且不含「未生效」');
 assert.ok(page.includes('授权状态未识别：「'),'未知状态报错应带状态原文');
 assert.ok(!page.includes("active:status==='生效中'"),'不应再按单一「生效中」全等判定');
});
