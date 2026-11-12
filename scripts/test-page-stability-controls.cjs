'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('实际页面稳定操作：悬停重排输入/日历/确认按钮，以及多输入/多弹层歧义拒绝',()=>{
 const env={...process.env,SHIMA_STABLE_OPERATIONS_ONLY:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const r=spawnSync(require('electron'),[path.join(__dirname,'page-operation-controls.cjs')],{env,encoding:'utf8',timeout:60000,killSignal:'SIGKILL'});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"success":true/);
});
