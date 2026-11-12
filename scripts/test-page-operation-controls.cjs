'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('实际日历常用/窄窗：延迟选中、丢失首击恢复、慢翻月、单日及确认按钮均核验后再继续',()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const r=spawnSync(require('electron'),[path.join(__dirname,'page-operation-controls.cjs')],{env,encoding:'utf8',timeout:60000,killSignal:'SIGKILL'});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"success":true/);
});
