'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('实际财务导航：忽略静态同名文字，等待目标状态，失效点击不重复派发',()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=spawnSync(require('electron'),[path.join(__dirname,'navigation-stability-controls.cjs')],{env,encoding:'utf8',timeout:30000,killSignal:'SIGKILL'});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"success":true/);
});
