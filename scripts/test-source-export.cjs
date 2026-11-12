'use strict';
// 内置源码包导出测试（v1.2.82）：
// 覆盖快照定位（resources 优先 / 开发态回落）、ZIP 头校验、导出复制完整性、
// 取消、源缺失、复制半截时清理临时文件。
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {isZip,locate,sourceInfo,exportSource,fileName}=require('../electron/source-export.cjs');

const ZIP=Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),Buffer.alloc(1200,7)]);

function temp(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shima-source-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return root;
}
function writeSnapshot(dir,data=ZIP){
 const file=path.join(dir,'source-snapshot.zip');
 fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(file,data);
 return file;
}

test('locate 优先用安装目录 resources，其次开发态工程根',async t=>{
 const resources=temp(t),appRoot=temp(t);
 writeSnapshot(appRoot,Buffer.concat([Buffer.from([0x50,0x4b,0x03,0x04]),Buffer.alloc(900,1)]));
 const packed=writeSnapshot(resources);
 assert.equal(locate({resourcesPath:resources,appPath:appRoot}).file,packed);
 assert.equal(locate({resourcesPath:resources,appPath:appRoot}).size,fs.statSync(packed).size);
 // 安装包没有时回落开发态
 const dev=locate({resourcesPath:temp(t),appPath:appRoot});
 assert.equal(dev.file,path.join(appRoot,'source-snapshot.zip'));
 // 两处都没有
 assert.equal(locate({resourcesPath:temp(t),appPath:temp(t)}),null);
});

test('只认标准 ZIP 头，残缺或伪造文件不导出',async t=>{
 const dir=temp(t);
 const bad=path.join(dir,'source-snapshot.zip');
 fs.writeFileSync(bad,Buffer.from('not a zip at all'));
 assert.equal(isZip(bad),false);
 assert.equal(locate({resourcesPath:dir}),null);
 const empty=path.join(dir,'empty.zip');
 fs.writeFileSync(empty,Buffer.alloc(0));
 assert.equal(isZip(empty),false);
 assert.equal(isZip(path.join(dir,'missing.zip')),false);
 assert.equal(isZip(writeSnapshot(temp(t))),true);
});

test('sourceInfo 报告可用与文件大小，缺失时 available=false',async t=>{
 const resources=temp(t);
 writeSnapshot(resources);
 const info=sourceInfo({version:'1.2.82',resourcesPath:resources,appPath:temp(t)});
 assert.equal(info.available,true);assert.equal(info.version,'1.2.82');
 assert.equal(info.size,ZIP.length);assert.equal(info.name,'诗玛财务AI工作台-1.2.82-源码.zip');
 const none=sourceInfo({version:'1.2.82',resourcesPath:temp(t),appPath:temp(t)});
 assert.equal(none.available,false);assert.equal(none.size,0);assert.equal(none.name,'诗玛财务AI工作台-1.2.82-源码.zip');
});

test('导出复制字节一致，自动补 .zip 后缀并在资源管理器定位',async t=>{
 const resources=temp(t),desktop=temp(t);
 writeSnapshot(resources);
 const chosen=path.join(desktop,'自定义名字');
 let located='';
 const result=await exportSource({
  dialog:{showSaveDialog:async(_parent,options)=>{
   assert.equal(options.defaultPath,path.join(desktop,fileName('1.2.82')));
   return {canceled:false,filePath:chosen};
  }},
  desktop,version:'1.2.82',resourcesPath:resources,appPath:desktop,
  shell:{showItemInFolder:file=>{located=file;}},
 });
 assert.equal(result.cancelled,false);
 assert.equal(result.path,chosen+'.zip');
 assert.equal(result.name,'自定义名字.zip');
 assert.equal(result.size,ZIP.length);
 assert.deepEqual(fs.readFileSync(result.path),ZIP);
 assert.equal(located,result.path);
 assert.deepEqual(fs.readdirSync(desktop).filter(n=>n.endsWith('.tmp')),[]);
});

test('已带 .zip 后缀不重复追加',async t=>{
 const resources=temp(t),desktop=temp(t);
 writeSnapshot(resources);
 const chosen=path.join(desktop,'源码.ZIP');
 const result=await exportSource({dialog:{showSaveDialog:async()=>({canceled:false,filePath:chosen})},desktop,version:'1.2.82',resourcesPath:resources,appPath:desktop});
 assert.equal(result.path,chosen);
 assert.deepEqual(fs.readFileSync(chosen),ZIP);
});

test('用户取消不改动任何文件',async t=>{
 const resources=temp(t),desktop=temp(t);
 writeSnapshot(resources);
 const result=await exportSource({dialog:{showSaveDialog:async()=>({canceled:true})},desktop,version:'1.2.82',resourcesPath:resources,appPath:desktop});
 assert.equal(result.cancelled,true);
 assert.equal(result.name,'诗玛财务AI工作台-1.2.82-源码.zip');
 assert.deepEqual(fs.readdirSync(desktop),[]);
});

test('没有内置源码时明确报错，不弹保存框',async t=>{
 const desktop=temp(t);
 let asked=false;
 await assert.rejects(()=>exportSource({
  dialog:{showSaveDialog:async()=>{asked=true;return {canceled:false,filePath:path.join(desktop,'x.zip')};}},
  desktop,version:'1.2.82',resourcesPath:temp(t),appPath:temp(t),
 }),/当前程序没有内置源码/);
 assert.equal(asked,false);
});

test('复制半截时删除临时文件且目标不出现',async t=>{
 const resources=temp(t),desktop=temp(t);
 writeSnapshot(resources);
 const destination=path.join(desktop,'半截.zip');
 const io={
  copyFile:async()=>{},
  stat:async()=>({size:ZIP.length-1}),
  rename:async()=>{throw Error('不应执行重命名');},
  rm:async file=>{fs.rmSync(file,{force:true});},
 };
 await assert.rejects(()=>exportSource({dialog:{showSaveDialog:async()=>({canceled:false,filePath:destination})},desktop,version:'1.2.82',resourcesPath:resources,appPath:desktop,io}),/复制不完整/);
 assert.equal(fs.existsSync(destination),false);
 assert.deepEqual(fs.readdirSync(desktop),[]);
});

test('写入失败时清理临时文件，错误文案带原因',async t=>{
 const resources=temp(t),desktop=temp(t);
 writeSnapshot(resources);
 const io={
  copyFile:async(_from,to)=>{fs.writeFileSync(to,Buffer.alloc(10));throw Error('磁盘已满');},
  stat:async()=>({size:10}),
  rename:async()=>{},
  rm:async file=>{fs.rmSync(file,{force:true});},
 };
 await assert.rejects(()=>exportSource({dialog:{showSaveDialog:async()=>({canceled:false,filePath:path.join(desktop,'x.zip')})},desktop,version:'1.2.82',resourcesPath:resources,appPath:desktop,io}),/导出失败：磁盘已满/);
 assert.deepEqual(fs.readdirSync(desktop),[]);
});
