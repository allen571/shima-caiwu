'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('新版首页账户卡：通过「前往」进入授权列表',()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=spawnSync(require('electron'),[path.join(__dirname,'jd-authorize-entry.cjs')],{env,encoding:'utf8',timeout:30000,killSignal:'SIGKILL'});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"success":true/);
});
