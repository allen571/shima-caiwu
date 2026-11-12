'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-finance-smoke-')),project=path.resolve(__dirname,'..'),evidence=process.env.SHIMA_FINANCE_EVIDENCE||path.join(root,'evidence');
const env={...process.env,SHIMA_FINANCE_TEST:'1',SHIMA_FINANCE_TEST_ROOT:root,SHIMA_FINANCE_EVIDENCE:evidence};delete env.ELECTRON_RUN_AS_NODE;
for(const phase of ['first','reopen']){const result=spawnSync(require('electron'),[project],{cwd:project,env:{...env,SHIMA_FINANCE_TEST_PHASE:phase},encoding:'utf8',timeout:60000});assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(evidence,'smoke-'+phase+'.json'))).success,true);}
fs.writeFileSync(path.join(root,'.disposable-test.json'),JSON.stringify({version:1,completed:true,disposable:true,completedAt:new Date().toISOString()}));console.log(JSON.stringify({success:true,root,evidence}));
