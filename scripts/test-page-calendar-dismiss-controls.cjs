'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('实际京东日历关闭：不支持Esc、半选/失败重试、遮挡、交互标题、永久不关闭及延迟Esc',()=>{
 const env={...process.env,SHIMA_CALENDAR_CLOSE_ONLY:'1'};delete env.ELECTRON_RUN_AS_NODE;
 const r=spawnSync(require('electron'),[path.join(__dirname,'page-operation-controls.cjs')],{env,encoding:'utf8',timeout:60000,killSignal:'SIGKILL'});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"success":true/);
});
