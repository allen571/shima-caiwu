'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('人工完成验证后同店窗口自动隐藏，常用和窄窗口均通过',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-watch-controls-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
 const env={...process.env,SHIMA_WATCH_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
 const r=spawnSync(require('electron'),[path.join(__dirname,'manual-watch-controls.cjs')],{env,encoding:'utf8',timeout:30000});
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"success":true/);
});
