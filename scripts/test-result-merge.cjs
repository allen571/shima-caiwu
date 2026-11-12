'use strict';
// v1.2.85 重抓后合并显示：每店显示最新一行；最新一行失败/需人工/暂停时回显该店上一轮已获取
// 的结果（carriedOver），第一轮成功数据不再因新 runId 而从界面与导出中消失。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PromotionFee}=require('../electron/promotion-fee.cjs');
const {FundSummary}=require('../electron/fund-summary.cjs');
const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('e:'+s),decryptString:b=>b.toString().slice(2)};

function promoSetup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-merge-promo-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const s=new PromotionFee({root,safeStorage});
 s.putShop({name:'甲店',username:'甲店账号',password:'sample-secret'});
 s.putShop({name:'乙店',username:'乙店账号',password:'sample-secret'});
 s.putShop({name:'丙店',username:'丙店账号',password:'sample-secret'});
 return s;
}
function fundSetup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-merge-fund-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const fund=new FundSummary({autoDownload:false,host:{data:{shops:[{id:'t1',name:'淘一号',platform:'taobao'},{id:'t2',name:'淘二号',platform:'tmall'}]},busy:false,loginBusy:false},root,downloads:root});
 return fund;
}
const rowOf=(shopId,runId,status,amountCents=null)=>({runId,shopId,status,amountCents,updatedAt:'2026-11-11T03:00:00Z'});

test('推广费合并显示：二轮新 runId 不再挤掉一轮成功行',t=>{
 const s=promoSetup(t);
 const [A,B,C]=s.data.shops.map(x=>x.id);
 s.save({...s.data,results:[rowOf(A,'r1','completed',100),rowOf(B,'r1','completed',200),rowOf(C,'r1','failed'),rowOf(C,'r2','manual')]});
 const rows=s.state().results;
 assert.deepEqual(rows.map(r=>[r.shopId,r.status]),[[A,'completed'],[B,'completed'],[C,'manual']],'甲乙沿用一轮成功，丙显示最新需人工');
 assert.equal(rows.filter(r=>r.carriedOver).length,0,'未重抓的成功店不标 carriedOver');
});
test('推广费合并显示：重抓失败时回显上一轮已获取，合计继续计入',t=>{
 const s=promoSetup(t);
 const [A,B,C]=s.data.shops.map(x=>x.id);
 s.save({...s.data,results:[rowOf(A,'r1','completed',100),rowOf(B,'r1','completed',200),rowOf(A,'r3','failed')]});
 const rows=s.state().results;
 const carriedA=rows.filter(r=>r.shopId===A);
 assert.equal(carriedA.length,2,'甲店应有最新失败行 + 上一轮成功行');
 assert.deepEqual(carriedA.map(r=>r.status).sort(),['completed','failed']);
 assert.equal(carriedA.find(r=>r.status==='completed').carriedOver,true,'上一轮成功行带 carriedOver 标记');
 assert.equal(carriedA.find(r=>r.status==='completed').amountCents,100,'金额保留');
 const done=rows.filter(r=>r.status==='completed'&&!r.duplicate);
 assert.equal(done.reduce((n,r)=>n+r.amountCents,0),300,'合计=甲上一轮100 + 乙200');
});
test('推广费合并显示：重抓成功后只显示新成功行，不重复显示旧值',t=>{
 const s=promoSetup(t);
 const [A]=s.data.shops.map(x=>x.id);
 s.save({...s.data,results:[rowOf(A,'r1','completed',100),rowOf(A,'r3','completed',150)]});
 const rows=s.state().results;
 assert.equal(rows.length,1);
 assert.equal(rows[0].amountCents,150,'显示最新成功值');
 assert.equal(rows[0].carriedOver,undefined);
});
test('资金合并显示：与推广费同口径',t=>{
 const fund=fundSetup(t);
 fund.save({version:1,exportFolder:'',results:[
  {runId:'f1',shopId:'t1',month:'2026-11',status:'completed',incomeCents:1000,expenseCents:0,balanceCents:1000,incomeCount:1,expenseCount:0},
  {runId:'f1',shopId:'t2',month:'2026-11',status:'completed',incomeCents:2000,expenseCents:0,balanceCents:2000,incomeCount:1,expenseCount:0},
  {runId:'f2',shopId:'t1',month:'2026-11',status:'failed',error:'该店需要人工验证'}]});
 const rows=fund.state().results;
 assert.equal(rows.length,3,'淘一号失败+上一轮成功 = 2 行，淘二号 1 行');
 const t1=rows.filter(r=>r.shopId==='t1');
 assert.equal(t1.filter(r=>r.status==='completed'&&r.carriedOver).length,1);
 assert.equal(t1.find(r=>r.status==='completed').incomeCents,1000,'上一轮收入保留');
 assert.equal(rows.filter(r=>r.shopId==='t2')[0].carriedOver,undefined);
});

// —— v1.2.87 结果表只显示今天/昨天，历史记录进 stale（默认隐藏，可开关） ——

test('推广费结果表：10 月 27 日的老失败行不再显示，今天成功的行正常显示',t=>{
 const s=promoSetup(t);
 const [A,B,C]=s.data.shops.map(x=>x.id);
 s.save({...s.data,results:[
  {runId:'r9',shopId:C,status:'failed',amountCents:null,start:'2026-10-01',end:'2026-10-01',updatedAt:'2026-10-27T06:50:00Z',error:'老失败'},
  {runId:'r10',shopId:A,status:'completed',amountCents:100,start:'2026-11-10',end:'2026-11-10',updatedAt:new Date().toISOString()},
  {runId:'r10',shopId:B,status:'completed',amountCents:200,start:'2026-11-10',end:'2026-11-10',updatedAt:new Date().toISOString()}
 ]});
 const st=s.state();
 assert.deepEqual(st.results.map(r=>r.shopId).sort(),[A,B].sort(),'只显示今天/昨天两行');
 assert.equal(st.stale.length,1,'10-27 老记录进 stale');
 assert.equal(st.stale[0].shopId,C);
 assert.equal(st.results.reduce((n,r)=>n+(r.amountCents||0),0),300,'合计只算近期行');
});

test('推广费结果表：无 updatedAt 但有近期查询日期的行仍显示（老版本数据兼容）',t=>{
 const s=promoSetup(t);
 const [A]=s.data.shops.map(x=>x.id);
 const today=new Date(Date.now()+28800000).toISOString().slice(0,10);
 s.save({...s.data,results:[{runId:'r1',shopId:A,status:'completed',amountCents:50,start:today,end:today}]});
 assert.equal(s.state().results.length,1);
 assert.equal(s.state().stale.length,0);
});

test('资金结果表：11-04 的老失败行隐藏，今天的完成行显示',t=>{
 const fund=fundSetup(t);
 fund.save({version:1,exportFolder:'',results:[
  {runId:'f1',shopId:'t1',month:'2026-11',status:'failed',error:'该店铺的千牛窗口已关闭',updatedAt:'2026-11-04T08:23:00Z'},
  {runId:'f2',shopId:'t2',month:'2026-11',day:'2026-11-10',status:'completed',incomeCents:500,expenseCents:0,balanceCents:500,incomeCount:1,expenseCount:0,updatedAt:new Date().toISOString()}
 ]});
 const st=fund.state();
 assert.deepEqual(st.results.map(r=>r.shopId),['t2'],'只显示今天的单日完成行');
 assert.equal(st.stale.length,1);
 assert.equal(st.stale[0].shopId,'t1');
});
