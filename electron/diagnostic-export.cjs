'use strict';
// Explicit allowlist: never copy raw errors, URLs, account data, page content or logs.
const fs=require('node:fs'),path=require('node:path');
const statusSet=new Set(['queued','running','completed','failed','paused','manual','partial','conflict','none','finance-only']);
const platforms=new Set(['jd','taobao','tmall','douyin']);
const reason=value=>{const s=String(value||'');if(/滑块|验证|验证码/.test(s))return '需要验证';if(/登录|会话|认证/.test(s))return '登录或会话异常';if(/窗口.*关闭|destroyed|disposed/i.test(s))return '窗口已关闭';if(/超时|timeout/i.test(s))return '操作超时';if(/保存|写入|写盘/.test(s))return '本地保存异常';if(/授权|权限/.test(s))return '授权或权限异常';if(/网络|连接|network/i.test(s))return '网络或连接异常';if(/暂停|中断/.test(s))return '已暂停或中断';return s?'其他错误（原文未收集）':'';};
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}(?:-\d{2})?$/.test(value)?value:'';
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)?value:'';
function report({service,fund,version,platform,arch}){
 const shops=service.data.shops||[],aliases=new Map(shops.map((s,i)=>[s.id,'店铺'+(i+1)]));
 const row=r=>({店铺:aliases.get(r.shopId)||'未知店铺',平台:platforms.has(r.platform)?r.platform:'',状态:statusSet.has(r.status)?r.status:'unknown',开始日期:date(r.start),结束日期:date(r.end),实际查询开始:date(r.queryStart),实际查询结束:date(r.queryEnd),月份:date(r.month),日期:date(r.day),更新时间:timestamp(r.updatedAt),原因分类:reason(r.error),子账户:(Array.isArray(r.accounts)?r.accounts:[]).slice(0,100).map(a=>({状态:statusSet.has(a.status)?a.status:'unknown',更新时间:timestamp(a.updatedAt),原因分类:reason(a.error)}))});
 return {说明:'仅含匿名店铺编号、状态、日期和错误分类；不含账号、密码、Cookie、页面、原始日志或金额。错误原文未收集，复杂问题可能需要补充说明。',生成时间:new Date().toISOString(),版本:String(version||''),系统:platform+'-'+arch,推广费运行中:!!service.busy,登录运行中:!!service.loginBusy,资金抓取运行中:!!fund.busy,资金导出运行中:!!fund.downloadBusy,店铺数量:shops.length,推广费最近记录:(service.data.results||[]).slice(-200).map(row),资金最近记录:(fund.data.results||[]).slice(-200).map(row)};
}
async function exportDiagnostic({service,fund,version,platform,arch,dialog,parent,downloads}){
 const result=await dialog.showSaveDialog(parent,{title:'保存诊断信息',defaultPath:path.join(downloads,'诗玛诊断信息.json'),filters:[{name:'JSON 文件',extensions:['json']}]});
 if(result.canceled||!result.filePath)return {cancelled:true};
 fs.writeFileSync(result.filePath,JSON.stringify(report({service,fund,version,platform,arch}),null,2),'utf8');
 return {cancelled:false,path:result.filePath};
}
module.exports={report,exportDiagnostic};
