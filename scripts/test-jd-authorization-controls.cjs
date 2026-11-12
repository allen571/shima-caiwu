'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('实际授权页：换行/重排列头、慢加载、跨页过期与生效重复、只打开有效记录、常用/窄窗',()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const r=spawnSync(require('electron'),[path.join(__dirname,'jd-authorization-controls.cjs')],{env,encoding:'utf8',timeout:30000,killSignal:'SIGKILL'});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/"success":true/);
});
