'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PLATFORM_NAMES}=require('./promotion-fee.cjs');
const {parseAccountsFromFile}=require('./promotion-fee-excel.cjs');
// 账号导入文件上限：Excel 与 JSON 统一 5MB，避免误选巨型文件拖死主进程
const MAX_ACCOUNT_FILE_BYTES=5*1024*1024;
// 按扩展名判断是否为表格导入；其余仍走原有 JSON 通道
const isSpreadsheet=file=>/\.(?:xlsx|xls|csv|txt)$/i.test(String(file||''));
function importAccounts(service,document){
 if(service.busy||service.loginBusy)throw Error('请等待查询或登录结束');
 if(document?.format!=='shima-promotion-accounts'||document.version!==1||!Array.isArray(document.accounts)||!document.accounts.length||document.accounts.length>1000)throw Error('账号文件格式无效（最多1000个账号）');
 const seen=new Set(service.data.shops.map(s=>JSON.stringify([s.platform||'taobao',s.username]))),added=[];let skipped=0;
 for(const row of document.accounts){if(!row||typeof row.username!=='string'||typeof row.password!=='string'||!row.username.trim()||row.username.trim().length>120||!row.password||row.password.length>4096||!Object.hasOwn(PLATFORM_NAMES,row.platform))throw Error('账号文件包含无效的平台、账号或密码，未导入');
 const username=row.username.trim(),key=JSON.stringify([row.platform,username]);if(seen.has(key)){skipped++;continue;}
 if(!service.safeStorage?.isEncryptionAvailable())throw Error('系统密码加密不可用，未导入');
 // 表格可带独立店铺名列；JSON 账号文件没有该字段，回退为登录账号，与原行为一致
 const displayName=typeof row.name==='string'&&row.name.trim()?row.name.trim().slice(0,120):username;
 added.push({id:randomUUID(),sessionKey:randomUUID(),platform:row.platform,name:displayName,username,secret:service.safeStorage.encryptString(row.password).toString('base64'),boundShop:null,boundAccountId:null,jdLoginAccountId:null});seen.add(key);}
 if(service.singleShop&&service.data.shops.length+added.length>1)throw Error('当前为独立店铺环境，只能保存一个账号');
 if(added.length)service.save({...service.data,shops:[...service.data.shops,...added]});return {added:added.length,skipped};
}
// Excel/CSV 表格导入：解析后复用账号导入的去重、加密与互斥规则，
// 返回里额外带来源、页码、无效行明细，供界面把「哪几行没进来、为什么」说清楚
async function importSpreadsheet(service,file,unchanged=()=>{}){
 let parsed;
 try{parsed=parseAccountsFromFile(await fs.readFile(file),file);}
 catch(error){
  if(error.code==='EISDIR'||error.code==='EACCES')throw Error('无法读取该文件，请选择 Excel 表格文件');
  if(/\.(?:xlsx|xls)$/i.test(file)&&/zip|corrupt|Unsupported|Bad|not a/i.test(String(error.message)))throw Error('表格文件已损坏或不是有效的 Excel 文件');
  throw error;
 }
 // 解析是异步的，写库前再确认账号与查询状态没有变化
 unchanged();
 if(!parsed.accounts.length){
  const first=parsed.invalid[0];
  throw Error('表格里没有可导入的账号'+(first?'（第 '+first.row+' 行：'+first.reason+'）':'，请检查表头是否为「平台 / 账号 / 密码」'));
 }
 if(parsed.accounts.length>1000)throw Error('表格里的账号超过1000个，请拆分后再导入');
 let result;
 try{result=importAccounts(service,{format:'shima-promotion-accounts',version:1,accounts:parsed.accounts});}
 catch(error){throw Error('表格内容无法导入：'+String(error.message||error));}
 return {...result,source:'excel',sheet:parsed.sheet,totalRows:parsed.totalRows,invalid:parsed.invalid,emptyRows:parsed.emptyRows,notes:parsed.notes};
}
async function transferAccounts({service,action,dialog,parent,downloads}){
 if(service.busy||service.loginBusy||service.accountTransferBusy)throw Error('请等待查询、登录或账号导入导出结束');
 service.accountTransferBusy=true;let temporary;
 try{const snapshot=service.data;const unchanged=()=>{if(service.busy||service.loginBusy||service.data!==snapshot)throw Error('账号或查询状态已变化，请重试');};
 if(action==='importAccounts'){const picked=await dialog.showOpenDialog(parent,{title:'导入推广费账号（支持 Excel / CSV 表格）',properties:['openFile'],filters:[{name:'账号表格（Excel / CSV）',extensions:['xlsx','xls','csv']},{name:'账号文件（JSON）',extensions:['json']},{name:'所有支持的格式',extensions:['xlsx','xls','csv','json']}]});if(picked.canceled||!picked.filePaths?.length)return {cancelled:true};const file=picked.filePaths[0];if((await fs.stat(file)).size>MAX_ACCOUNT_FILE_BYTES)throw Error('账号文件不能超过5MB');if(isSpreadsheet(file)){return importSpreadsheet(service,file,unchanged);}let document;try{document=JSON.parse(await fs.readFile(file,'utf8'));}catch{throw Error('账号文件无法读取，请选择导出的JSON文件或Excel表格');}unchanged();return {...importAccounts(service,document),source:'json'};}
 if(!snapshot.shops.length)throw Error('暂无账号可导出');
 const picked=await dialog.showSaveDialog(parent,{title:'导出账号（文件包含明文密码，请妥善保管）',defaultPath:path.join(downloads,'推广费账号.json'),filters:[{name:'账号文件（含密码）',extensions:['json']}]});if(picked.canceled||!picked.filePath)return {cancelled:true};unchanged();
 const accounts=snapshot.shops.map(s=>({platform:s.platform||'taobao',username:s.username,password:service.safeStorage.decryptString(Buffer.from(s.secret,'base64'))}));
 const destination=/\.json$/i.test(picked.filePath)?picked.filePath:picked.filePath+'.json';temporary=path.join(path.dirname(destination),'.promotion-accounts-'+randomUUID()+'.tmp');await fs.writeFile(temporary,JSON.stringify({format:'shima-promotion-accounts',version:1,accounts},null,2),{mode:0o600,flag:'wx'});unchanged();await fs.rename(temporary,destination);temporary=null;return {count:accounts.length,name:path.basename(destination)};
 }finally{if(temporary)await fs.rm(temporary,{force:true}).catch(()=>{});service.accountTransferBusy=false;}
}
module.exports={importAccounts,transferAccounts};
