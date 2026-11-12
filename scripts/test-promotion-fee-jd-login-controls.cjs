'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('淘宝天猫京东登录控件：实际Electron常用与窄窗、自动提交/仅预填/已有输入及认证保护',()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const result=spawnSync(require('electron'),[path.join(__dirname,'jd-login-controls.cjs')],{env,encoding:'utf8',timeout:45000});
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/"success":true/);
});
