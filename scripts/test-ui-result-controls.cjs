'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('实际界面按日期显示结果并勾选需要处理的账号',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-result-ui-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
 const env={...process.env,SHIMA_UI_TEST_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 const r=spawnSync(require('electron'),[path.join(__dirname,'ui-result-controls.cjs')],{env,encoding:'utf8',timeout:30000});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"success":true/);
});
