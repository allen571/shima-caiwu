'use strict';
// 「打开工作台」启动器——v1.2.98 起直接启动正式部署目录的 FinanceHub.exe server，
// 不再内置安装向导（旧内置 exe 是安装程序，曾四次把新版程序回滚成旧版）
const test=require('node:test');
const assert=require('node:assert');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const L=require('../electron/workbench-launcher.cjs');

function tmp(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'wb-launcher-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}

function fakeExe(dir,size=2048){
 fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,L.EXE_NAME);
 const buffer=Buffer.alloc(size,0x11);
 buffer[0]=0x4d;buffer[1]=0x5a;
 fs.writeFileSync(file,buffer);
 return file;
}

test('deploymentDir 默认 D:\\finance-hub，环境变量可覆盖',t=>{
 const old=process.env.FINANCEHUB_DIR;
 try{
  delete process.env.FINANCEHUB_DIR;
  assert.equal(L.deploymentDir(),'D:\\finance-hub');
  process.env.FINANCEHUB_DIR='X:\\fake';
  assert.equal(L.deploymentDir(),'X:\\fake');
 }finally{
  if(old===undefined)delete process.env.FINANCEHUB_DIR;else process.env.FINANCEHUB_DIR=old;
 }
});

test('deploymentExe 只认部署目录下的 PE 文件',t=>{
 const root=tmp(t);
 const dir=path.join(root,'deploy');
 assert.equal(L.deploymentExe(dir),null,'目录不存在时应为 null');
 fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,L.EXE_NAME),Buffer.from('PK\x03\x04not-an-exe'));
 assert.equal(L.deploymentExe(dir),null,'非 PE 文件应被拒绝');
 const exe=fakeExe(dir,3000);
 const found=L.deploymentExe(dir);
 assert.equal(found.file,exe);
 assert.equal(found.size,3000);
});

test('工作台已在运行（端口开）时不再拉起新进程',async t=>{
 const root=tmp(t);
 const dir=fakeExe(path.join(root,'deploy'));
 let spawned=0;
 const result=await L.launch({},{
  probe:async()=>true,
  spawnProcess:()=>{spawned++;return {pid:1};}
 });
 assert.equal(result.already,true);
 assert.equal(result.running,true);
 assert.equal(spawned,0);
});

test('正常启动：以 server 子命令拉起部署目录的 exe，cwd 为部署目录',async t=>{
 const root=tmp(t);
 const dir=path.join(root,'deploy');
 fakeExe(dir,3000);
 process.env.FINANCEHUB_DIR=dir;
 try{
  let calls=0,spawnArgs=null;
  const result=await L.launch({},{
   probe:async()=>++calls>2,
   spawnProcess:(file,args,options)=>{spawnArgs={file,args,options};return {pid:4321};},
   wait:async()=>{}
  });
  assert.equal(result.started,true);
  assert.equal(result.running,true);
  assert.equal(result.pid,4321);
  assert.equal(spawnArgs.file,path.join(dir,L.EXE_NAME));
  assert.deepEqual(spawnArgs.args,['server'],'必须以 server 子命令启动，绝不裸跑');
  assert.equal(spawnArgs.options.detached,true);
  assert.equal(spawnArgs.options.cwd,dir,'cwd 必须是部署目录，保证 config/数据库/web 都用同一份');
 }finally{
  delete process.env.FINANCEHUB_DIR;
 }
});

test('部署目录没有 FinanceHub.exe：明确报错，不执行任何安装程序',async t=>{
 const root=tmp(t);
 fs.mkdirSync(path.join(root,'empty'),{recursive:true});
 fs.writeFileSync(path.join(root,'empty','FinanceHub-Workbench.exe'),Buffer.alloc(100,0x4d));
 process.env.FINANCEHUB_DIR=path.join(root,'empty');
 try{
  await assert.rejects(()=>L.launch({},{
   probe:async()=>false,
   spawnProcess:()=>{throw Error('不应被调用');}
  }),/未安装/);
 }finally{
  delete process.env.FINANCEHUB_DIR;
 }
});

test('启动后端口始终未就绪：仍需如实返回并带提示',async t=>{
 const root=tmp(t);
 fakeExe(path.join(root,'deploy'));
 const result=await L.launch({},{
  probe:async()=>false,
  spawnProcess:()=>({pid:9}),
  wait:async()=>{}
 });
 assert.equal(result.started,true);
 assert.equal(result.running,false);
 assert.match(result.note,/30 秒/);
});

test('status 汇报可用性、体积与端口状态',async t=>{
 const root=tmp(t);
 fakeExe(path.join(root,'deploy'),5000);
 process.env.FINANCEHUB_DIR=path.join(root,'deploy');
 try{
  const info=await L.status({}, {probe:async()=>true});
  assert.equal(info.available,true);
  assert.equal(info.size,5000);
  assert.equal(info.running,true);
  assert.equal(info.port,8765);
  assert.ok(info.location.endsWith(L.EXE_NAME));
  process.env.FINANCEHUB_DIR=path.join(root,'no-such-dir');
  const missing=await L.status({}, {probe:async()=>false});
  assert.equal(missing.available,false);
 }finally{
  delete process.env.FINANCEHUB_DIR;
 }
});
