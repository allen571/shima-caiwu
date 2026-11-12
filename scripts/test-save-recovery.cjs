'use strict';
// v1.2.86 保存熔断三项改进：底层错误落日志、失败重试 3 次、熔断后下次保存成功即自恢复
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PromotionFee}=require('../electron/promotion-fee.cjs');
const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('encrypted:'+s),decryptString:b=>b.toString().slice(10)};
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-save-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const s=new PromotionFee({root,safeStorage});s.putShop({name:'甲店',username:'甲店账号',password:'sample-secret'});return s;}

test('瞬时保存失败自动重试：rename 连续失败 2 次后成功，不熔断',async t=>{
 const s=setup(t);
 const real=fs.renameSync;let attempts=0;
 fs.renameSync=(a,b)=>{attempts++;if(attempts<=2)throw Object.assign(Error('EPERM: 另一进程占用， operation not permitted'),{code:'EPERM'});return real(a,b);};
 t.after(()=>{fs.renameSync=real;});
 const data={...s.data,marker:'retry-ok'};
 s.save(data);
 assert.equal(attempts,3,'第 3 次重试成功');
 assert.equal(s.writeFailure,false,'不熔断');
 assert.equal(s.data.marker,'retry-ok');
 const log=fs.readFileSync(s.logFile,'utf8');
 assert.ok(log.includes('save-retry'),'底层错误已记入日志');
 assert.ok(log.includes('EPERM'),'日志含错误码');
});

test('持续保存失败熔断并记录底层错误；故障排除后下次保存自恢复',async t=>{
 const s=setup(t);
 fs.mkdirSync(s.file+'.tmp');// 占住 tmp 路径 → writeFileSync 必失败
 assert.throws(()=>s.save({...s.data,marker:'x'}),/本机保存失败/);
 assert.equal(s.writeFailure,true,'已熔断');
 let log=fs.readFileSync(s.logFile,'utf8');
 assert.ok(log.includes('save-fail'),'熔断已记录');
 assert.ok(log.includes('save-retry'),'3 次重试均已记录');
 fs.rmSync(s.file+'.tmp',{recursive:true,force:true});// 故障排除
 s.save({...s.data,marker:'recovered'});// 熔断态下直接恢复成功
 assert.equal(s.writeFailure,false,'熔断自动解除');
 assert.equal(s.data.marker,'recovered');
 log=fs.readFileSync(s.logFile,'utf8');
 assert.ok(log.includes('save-recovered'),'恢复事件已记录');
 // 恢复后再重启实例，数据完整
 const again=new PromotionFee({root:s.root,safeStorage});
 assert.equal(again.data.marker,'recovered');
});

test('恢复尝试仍失败：保持熔断并报本机保存失败',async t=>{
 const s=setup(t);
 fs.mkdirSync(s.file+'.tmp');
 assert.throws(()=>s.save({...s.data,marker:'x'}),/本机保存失败/);
 assert.equal(s.writeFailure,true);
 assert.throws(()=>s.save({...s.data,marker:'y'}),/本机保存失败/,'恢复失败仍报错');
 assert.equal(s.writeFailure,true,'保持熔断');
 const log=fs.readFileSync(s.logFile,'utf8');
 assert.ok(log.includes('熔断'),'第二次失败也记录了熔断原因');
});
