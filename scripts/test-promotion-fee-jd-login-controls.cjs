'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
test('淘宝天猫京东登录控件：实际Electron常用与窄窗、自动提交/仅预填/已有输入及认证保护',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-jd-controls-'));
 const env={...process.env,SHIMA_JD_CONTROLS_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 try{
  const result=spawnSync(require('electron'),[path.join(__dirname,'jd-login-controls.cjs')],{env,encoding:'utf8',timeout:90000});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/"success":true/);
 }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
