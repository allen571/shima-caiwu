'use strict';
// v1.2.82：把打包时随 exe 一起装进去的「源码快照」导出给用户。
// 快照来源优先级：
//   1) 打包态 <安装目录>/resources/source-snapshot.zip（electron-builder extraResources）
//   2) 开发态 项目根/source-snapshot.zip（npm run snapshot 生成）
// 只认标准 ZIP 头，避免把残缺文件当源码包导出。
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const SNAPSHOT='source-snapshot.zip';

function candidates({resourcesPath,appPath}){
 const list=[];
 if(resourcesPath)list.push(path.join(resourcesPath,SNAPSHOT));
 // 打包态 appPath 指向 app.asar（是文件不是目录），join 出来的路径 stat 会直接失败，无需额外判断
 if(appPath)list.push(path.join(appPath,SNAPSHOT));
 return list;
}

function isZip(file){
 let fd;
 try{fd=fs.openSync(file,'r');}catch(error){return false;}
 try{
  const head=Buffer.alloc(4);
  if(fs.readSync(fd,head,0,4,0)!==4)return false;
  return head[0]===0x50&&head[1]===0x4b&&head[2]===0x03&&head[3]===0x04;
 }catch(error){return false;}
 finally{try{fs.closeSync(fd);}catch(error){}}
}

function locate(options){
 for(const file of candidates(options)){
  try{
   const stat=fs.statSync(file);
   if(stat.isFile()&&isZip(file))return {file,size:stat.size};
  }catch(error){}
 }
 return null;
}

function fileName(version){return '诗玛财务AI工作台-'+(version||'')+'-源码.zip';}

function sourceInfo({version,resourcesPath,appPath}){
 const found=locate({resourcesPath,appPath});
 return found
  ?{available:true,version,name:fileName(version),size:found.size,source:found.file}
  :{available:false,version,name:fileName(version),size:0,source:''};
}

async function exportSource({dialog,parent,desktop,shell,version,resourcesPath,appPath,io=fsp}){
 const found=locate({resourcesPath,appPath});
 if(!found)throw Error('当前程序没有内置源码（开发模式下直接使用工程目录即可）');
 const name=fileName(version);
 const picked=await dialog.showSaveDialog(parent,{title:'导出内置源码包',defaultPath:path.join(desktop,name),filters:[{name:'ZIP 压缩包',extensions:['zip']}]});
 if(picked.canceled||!picked.filePath)return {cancelled:true,name};
 const destination=/\.zip$/i.test(picked.filePath)?picked.filePath:picked.filePath+'.zip';
 const temporary=destination+'.'+randomUUID()+'.tmp';
 try{
  await io.copyFile(found.file,temporary);
  // 回读校验：宁可失败也不能给用户一个半截的源码包
  const copied=(await io.stat(temporary)).size;
  if(copied!==found.size)throw Error('复制不完整（'+copied+'/'+found.size+' 字节）');
  await io.rename(temporary,destination);
 }catch(error){
  await io.rm(temporary,{force:true}).catch(()=>{});
  throw Error('导出失败：'+(error.message||error));
 }
 try{if(shell&&shell.showItemInFolder)shell.showItemInFolder(destination);}catch(error){}
 return {cancelled:false,name:path.basename(destination),path:destination,size:found.size};
}

module.exports={SNAPSHOT,candidates,isZip,locate,fileName,sourceInfo,exportSource};
