'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('新版千牛登录页：密码框禁用时先切「密码登录」页签再填写',()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=spawnSync(require('electron'),[path.join(__dirname,'taobao-login-tab-switch.cjs')],{env,encoding:'utf8',timeout:60000,killSignal:'SIGKILL'});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"success":true/);
});
