'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {JdPromotionFee,authorizationSummary}=require('../electron/promotion-fee-jd.cjs');
const row=(id,active,page=0)=>({accountId:id,name:'synthetic-'+id,active,expired:!active,validFrom:'2024-01-01',validUntil:active?'2027-12-31':'2026-01-01',page});
test('同ID过期在前/跨页仍优先生效记录，提示旧授权且只查询一次',()=>{
 const s=authorizationSummary([row('101',false),row('102',false),row('101',true,1),row('101',true,2)]);
 assert.equal(s.targets.length,1);assert.equal(s.targets[0].page,1);assert.equal(s.notices.find(n=>n.accountId==='101').stillActive,true);assert.equal(s.notices.find(n=>n.accountId==='102').stillActive,false);
});
function fixture(list,prior=[]){let notices,reads=0;const shop={id:'s',name:'synthetic-finance'},parent={webContents:{getURL:()=> 'https://jzt.jd.com/authorization'}},host={window:()=>parent,authenticate:async()=>({isSub:true}),assertWindow:w=>w.webContents,check(){},shop:()=>shop,windows:new Map(),hidden:true,showProblem(){}};
 const jd=new JdPromotionFee({host});jd.openAuthorizationList=async()=>{};jd.listAuthorizations=async()=>list;jd.authorizationPageAt=async()=>{};jd.authorizedAccount=async()=>parent;jd.readAccount=async()=>{reads++;return {amountCents:1234,refreshProof:{synthetic:true}};};
 return {jd,shop,parent,host,run:()=>jd.query(shop,{start:'2026-10-01',end:'2026-10-23'},{priorAccounts:prior,onAuthorizationNotices:n=>notices=n}),notices:()=>notices,reads:()=>reads};}
test('只有过期时仍返回提示和明确失败，金额为null而不是0',async()=>{const f=fixture(authorizationSummary([row('101',false)]));const r=await f.run();assert.equal(r.status,'failed');assert.equal(r.amountCents,null);assert.equal(r.authorizationNotices.length,1);assert.equal(f.reads(),0);});
test('有生效账户时查询继续，过期提示不进accounts或金额',async()=>{const f=fixture(authorizationSummary([row('101',false),row('102',true)]));const r=await f.run();assert.equal(r.status,'completed');assert.equal(r.amountCents,1234);assert.deepEqual(r.accounts.map(a=>a.accountId),['102']);assert.equal(f.notices().length,1);});
test('补查保留原成功项，过期原失败目标仍失败，新授权不混入',async()=>{const f=fixture(authorizationSummary([row('101',false),row('102',false),row('103',true)]),[{accountId:'101',name:'success',status:'completed',amountCents:500},{accountId:'102',name:'failed',status:'failed',amountCents:null}]);const r=await f.run();assert.equal(r.amountCents,500);assert.equal(r.status,'partial');assert.equal(f.reads(),0);assert.equal(r.accounts[0].status,'completed');assert.match(r.accounts[1].error,/授权已失效/);assert(!r.accounts.some(a=>a.accountId==='103'));});
test('授权提示持久化失败在派发子账户前停止',async()=>{const f=fixture(authorizationSummary([row('101',true)]));await assert.rejects(f.jd.query(f.shop,{}, {onAuthorizationNotices(){throw Error('本机保存失败');}}),/保存失败/);assert.equal(f.reads(),0);});
