// 打包产物冒烟验证（临时流程，不属于产品源码）：复制 win-unpacked → npx asar 提取后塞入 scripts → 重新打包 → 用打包 EXE 跑两阶段 smoke
const {spawnSync}=require('child_process');
const fs=require('fs'),path=require('path'),os=require('os');
const root=path.join(__dirname,'..');
const unpacked=path.join(root,'release158','win-unpacked');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'shima-pack-smoke-'));
const work=path.join(tmp,'app');
// 1. 复制 win-unpacked（排除体积无关的大目录已尽量小：整个复制）
fs.cpSync(unpacked,work,{recursive:true});
// 2. 提取 asar
const exe=path.join(work,'诗玛财务AI工作台.exe');
const asarPath=path.join(work,'resources','app.asar');
let r=spawnSync('npx',['--yes','@electron/asar','extract',asarPath,path.join(tmp,'asar-ext')],{shell:true,encoding:'utf8'});
if(r.status!==0)throw Error('asar extract 失败: '+r.stderr);
// 3. 塞入 scripts + 环境标记
fs.cpSync(path.join(root,'scripts'),path.join(tmp,'asar-ext','scripts'),{recursive:true});
// 4. 重新打包
r=spawnSync('npx',['--yes','@electron/asar','pack',path.join(tmp,'asar-ext'),asarPath],{shell:true,encoding:'utf8'});
if(r.status!==0)throw Error('asar pack 失败: '+r.stderr);
// 5. 两阶段 smoke（用打包 EXE）
const evidence=path.join(tmp,'evidence');
const env={...process.env,SHIMA_FINANCE_TEST:'1',SHIMA_FINANCE_TEST_ROOT:path.join(tmp,'shima-finance-pack-userdata'),SHIMA_FINANCE_EVIDENCE:evidence};
delete env.ELECTRON_RUN_AS_NODE;
// 打包应用不支持 NODE_OPTIONS（Electron 会打警告并拖慢启动，进而把 120 秒冒烟拖到超时）
delete env.NODE_OPTIONS;
for(const phase of ['first','reopen']){
 // 本机偶发 GPU/网络服务崩溃（用户实例占用时更明显），超时放宽到 180 秒给重试留余地
 const result=spawnSync(exe,[],{cwd:work,env:{...env,SHIMA_FINANCE_TEST_PHASE:phase},encoding:'utf8',timeout:180000});
 if(result.status!==0)throw Error('phase '+phase+' 退出码 '+result.status+' stderr: '+String(result.stderr).slice(0,500));
 const ok=JSON.parse(fs.readFileSync(path.join(evidence,'smoke-'+phase+'.json'),'utf8'));
 console.log('phase',phase,'success=',ok.success,'checks=',ok.checks?ok.checks.length:'n/a');
 if(!ok.success)throw Error('phase '+phase+' smoke success=false');
}
console.log('PACKAGED_SMOKE_OK',tmp);
