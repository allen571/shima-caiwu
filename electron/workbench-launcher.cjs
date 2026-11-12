'use strict';
// 「打开工作台」按钮：点一下启动 FinanceHub 数据服务（本机 127.0.0.1:8765）。
// v1.2.83~1.2.97：随主程序内置了一个 FinanceHub-Workbench.exe，服务没运行时点按钮把它拉起来。
//   重大隐患（v1.2.98 修正）：那个内置 exe 实际是安装向导，一旦服务没在运行它就被触发，
//   往 D:\finance-hub 释放旧版文件把新版程序整个打回旧版——11-11~11-12 的四次「程序回滚」
//   全是它干的。v1.2.98 起不再内置任何安装程序，改为：直接启动正式部署目录里的
//   FinanceHub.exe server（config/数据库/web 都用部署目录自己的，数据只有一个口径）；
//   未部署时明确报错引导用户先运行「启动工作台.bat」，绝不静默执行安装。
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');

const EXE_NAME='FinanceHub.exe';
const WORKBENCH_PORT=8765;
const START_TIMEOUT_MS=30000;

// 部署目录：安装包固定释放位置；环境变量仅供测试注入
function deploymentDir(){return process.env.FINANCEHUB_DIR||'D:\\finance-hub';}

function isPe(file){
 let fd;
 try{fd=fs.openSync(file,'r');}catch(error){return false;}
 try{
  const head=Buffer.alloc(2);
  if(fs.readSync(fd,head,0,2,0)!==2)return false;
  return head[0]===0x4d&&head[1]===0x5a;
 }catch(error){return false;}
 finally{try{fs.closeSync(fd);}catch(error){}}
}

function deploymentExe(dir){
 const file=path.join(dir||deploymentDir(),EXE_NAME);
 if(!isPe(file))return null;
 let size=0;
 try{size=fs.statSync(file).size;}catch(error){return null;}
 return {file,size};
}

// 端口探测：工作台起来后会在 127.0.0.1:8765 监听，用它判断「是否已在运行 / 是否启动成功」
function portOpen(port=WORKBENCH_PORT,host='127.0.0.1',timeout=800){
 return new Promise(resolve=>{
  let done=false;
  const socket=net.connect({port,host});
  const finish=value=>{if(done)return;done=true;try{socket.destroy();}catch(error){}resolve(value);};
  socket.setTimeout(timeout);
  socket.once('connect',()=>finish(true));
  socket.once('timeout',()=>finish(false));
  socket.once('error',()=>finish(false));
 });
}

async function status(options,{probe=portOpen}={}){
 const found=deploymentExe();
 const running=await probe();
 return {available:!!found,size:found?found.size:0,running,port:WORKBENCH_PORT,location:found?found.file:''};
}

async function launch(options,{spawnProcess=spawn,probe=portOpen,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const found=deploymentExe();
 if(!found)throw Error('财务工作台未安装：请先在 '+deploymentDir()+' 运行「启动工作台.bat」完成安装');
 if(await probe())return {started:false,already:true,running:true,port:WORKBENCH_PORT,path:found.file};
 let child;
 try{
  // detached + 显示控制台窗口：和「启动工作台.bat」双击运行一致，关掉窗口即停止服务
  child=spawnProcess(found.file,['server'],{cwd:path.dirname(found.file),detached:true,stdio:'ignore',windowsHide:false});
  if(child&&typeof child.unref==='function')child.unref();
 }catch(error){
  throw Error('工作台启动失败：'+(error.message||error));
 }
 const deadline=Date.now()+START_TIMEOUT_MS;
 while(Date.now()<deadline){
  if(await probe(WORKBENCH_PORT,'127.0.0.1',400))return {started:true,already:false,running:true,port:WORKBENCH_PORT,path:found.file,pid:child&&child.pid};
  await wait(700);
 }
 return {started:true,already:false,running:false,port:WORKBENCH_PORT,path:found.file,pid:child&&child.pid,note:'已启动，但 30 秒内没检测到服务端口'};
}

module.exports={EXE_NAME,WORKBENCH_PORT,START_TIMEOUT_MS,deploymentDir,deploymentExe,isPe,portOpen,status,launch};
