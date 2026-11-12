'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {JdPromotionFee}=require('../electron/promotion-fee-jd.cjs');
const dates={start:'2026-10-01',end:'2026-10-23'};
function fixture(){
 const jd=new JdPromotionFee({host:{}});let resets=0,reads=0,prepared=0;
 const receipt={proof:()=>({sequence:1,...dates,amountCents:1234}),reset:()=>resets++};
 jd.observe=async()=>({status:'logged_in',accountId:'123'});
 jd.readPage=async()=>{reads++;return {accountId:'123',...dates,amountCents:1234,loading:false};};
 jd.showAuth=()=>{};jd.waitForAuth=async()=>({accountId:'123'});
 jd.financePage=async()=>prepared++;jd.waitBody=async()=>{};jd.setDates=async()=>{};
 return {jd,receipt,counts:()=>({resets,reads,prepared}),run:()=>jd.ledger({},dates,'123',receipt)};
}
test('认证阻挡不能凭旧页面和旧响应返回金额',async()=>{
 for(const status of ['form','logged_out','manual','blocked','rejected','untrusted','submitted','prepared','filled']){
  const f=fixture();f.jd.observe=async()=>({status,reason:'synthetic blocker'});
  await assert.rejects(f.run(),/认证未完成.*synthetic blocker/);assert.equal(f.counts().reads,0);assert.equal(f.counts().resets,1);
 }
});
test('读取期间出现登录表单不返回旧金额',async()=>{
 const f=fixture();let observations=0;f.jd.observe=async()=>++observations===1?{status:'unknown'}:{status:'form'};
 await assert.rejects(f.run(),/认证未完成/);assert.equal(f.counts().reads,1);
});
test('认证后重新准备原日期并要求新响应，反复验证及时停止',async()=>{
 for(const status of ['verification','agreement']){
  const f=fixture();f.jd.observe=async()=>({status});
  await assert.rejects(f.run(),/再次要求验证/);assert.equal(f.counts().prepared,1);assert.equal(f.counts().reads,0);
 }
});
test('认证后账户变化和暂停保持失败原因',async()=>{
 const f=fixture();f.jd.observe=async()=>({status:'verification'});f.jd.waitForAuth=async()=>({accountId:'999'});
 await assert.rejects(f.run(),/身份不一致/);assert.equal(f.counts().prepared,0);
 f.jd.waitForAuth=async()=>{throw Error('查询已暂停');};await assert.rejects(f.run(),/查询已暂停/);
});
test('稳定身份日期金额仍可返回，认证恢复后使用新证明',async()=>{
 const f=fixture();let first=true,fresh=false;f.jd.observe=async()=>first?(first=false,{status:'verification'}):{status:'logged_in',accountId:'123'};
 f.receipt.reset=()=>{fresh=false;};f.jd.setDates=async()=>{fresh=true;};f.receipt.proof=()=>fresh?{sequence:2,...dates,amountCents:1234}:null;
 const result=await f.run();assert.equal(result.refreshProof.sequence,2);assert.equal(f.counts().reads,3);
});
