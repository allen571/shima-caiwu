'use strict';
// 每日计划（定时抓取）调度器 v1.2.62
// 规则（用户 2026-11-09 确认）：
//   ① 时刻自选，到点自动抓 T-1 一天：先推广费（全平台）后资金（淘宝/天猫，日汇总单日）；
//   ② 第一轮全部店铺都跑；失败店铺单独跑第二轮（同样先推广费后资金）；v1.2.62 起二轮
//      还要含「无」(none) /「财务号」(finance-only) 的店铺（与推广费 retry() 同口径）；
//   ③ 结果全部一起体现：一轮成功 + 二轮成功 + 二轮后仍失败（每行标 round 1/2）；
//   ④ 跑完自动导出一份 Excel 到资金导出目录；
//   ⑤ 软件没开就抓不了（应用内定时+托盘常驻）；到点时若正在手动抓取/登录，顺延重试；软件晚开也会补跑当天计划。
// 互斥约束：推广费与资金模块互斥，只能串行；调度全程持 scheduler.running，关窗保护见 main.cjs locked()。
const fs=require('node:fs'),path=require('node:path'),randomUUID=require('node:crypto').randomUUID;
const XLSX=require('../vendor/xlsx.full.min.js');
// vendor 里的 SheetJS 是浏览器版：主进程写文件必须先绑定 fs（否则 writeFile 报 cannot save file）
try{XLSX.set_fs(fs);}catch(e){}

const wait=ms=>new Promise(r=>setTimeout(r,ms));
// 北京时间（UTC+8）日历部分：返回 'YYYY-MM-DD'
const bjDate=ts=>{
 const d=new Date(ts+28800000);
 return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
};
// 北京时间当日 'HH:MM'
const bjTime=ts=>{
 const d=new Date(ts+28800000);
 return String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0');
};
const shiftDate=(date,n)=>{
 const [y,m,d]=date.split('-').map(Number);
 const t=Date.UTC(y,m-1,d)+n*86400000;
 const o=new Date(t);
 return o.getUTCFullYear()+'-'+String(o.getUTCMonth()+1).padStart(2,'0')+'-'+String(o.getUTCDate()).padStart(2,'0');
};
const monthOf=date=>date.slice(0,7);
// 与推广费模块 retry() 同口径（v1.2.62）：顶层 completed 但子账户里有「无」(none) 或「财务号」(finance-only)
// 的行也要补查——这类账户第一轮常因页面没加载完被误判，不补查就会漏数
const promoSuspect=r=>Array.isArray(r.accounts)&&r.accounts.some(a=>a.status==='none'||a.status==='finance-only');
// v1.2.81：需人工（滑块/验证/协议）不参与自动二轮——马上重跑还是会被同一个验证挡住，
// 只会再占一遍时间，把 160 家店整批拖慢。这类店铺留到跑完后由界面「勾选需人工」集中处理。
const promoNeedRetry=r=>!r||(r.status!=='completed'&&r.status!=='manual')||promoSuspect(r);

class Scheduler{
 constructor({service,fund,root,now,netProbe,netRetryMs,refreshMonthly=true}){
  this.service=service;   // 推广费 PromotionFee 实例
  this.fund=fund;         // 资金 FundSummary 实例
  this.root=root;         // userData 目录
  this.file=path.join(root,'schedule.json');
  this.now=now||(()=>Date.now());
  this.netProbe=netProbe||null; // 测试可注入；真实环境用 waitNetworkReady 内的默认探测
  this.netRetryMs=netRetryMs||30000;
  this.refreshMonthly=refreshMonthly;
  this.running=false;this.phaseText='';this.timer=null;
  this.work=null;
  this.data=this.load();
 }
 load(){
  // v1.2.84 autoDetailDownload：计划跑完后自动逐家下载 T-1 单日资金明细（行级「下载明细」）；
  // 默认开，老配置文件里没有这个键也走默认值
  try{return {enabled:false,time:'08:30',autoExport:true,autoStart:false,autoDetailDownload:true,history:[],lastRun:null,...JSON.parse(fs.readFileSync(this.file,'utf8'))};}
  catch(e){return {enabled:false,time:'08:30',autoExport:true,autoStart:false,autoDetailDownload:true,history:[],lastRun:null};}
 }
 save(){
  try{
   const tmp=this.file+'.tmp';
   fs.writeFileSync(tmp,JSON.stringify(this.data,null,2));
   fs.renameSync(tmp,this.file);
  }catch(e){/* 与主数据一致：写失败不炸主流程，下次配置时可见 */}
 }
 state(){
  return {
   enabled:!!this.data.enabled,time:this.data.time,autoExport:!!this.data.autoExport,autoStart:!!this.data.autoStart,
   autoDetailDownload:this.data.autoDetailDownload!==false,
   running:this.running,phaseText:this.phaseText,lastRun:this.data.lastRun,history:this.data.history.slice(-30).reverse(),
   busy:this.service&&this.service.busy,fundBusy:this.fund&&(this.fund.busy||this.fund.downloadBusy||this.fund.diagnosing)
  };
 }
 configure(patch){
  const allowed=['enabled','time','autoExport','autoStart','autoDetailDownload'];
  for(const k of allowed)if(k in patch){
   if(k==='time'&&!/^\d{2}:\d{2}$/.test(String(patch.time)))throw Error('时间格式应为 HH:MM');
   this.data[k]=patch[k];
  }
  this.save();
  if(patch.autoStart!==undefined)this.applyAutoStart();
  return this.state();
 }
 // 开机自启：便携版把自身 EXE 注册为登录启动项；开发环境（electron .）不注册
 applyAutoStart(){
  try{
   const {app}=require('electron');
   if(!app||!process.execPath||/electron\.exe$/i.test(process.execPath))return;
   app.setLoginItemSettings({openAtLogin:!!this.data.autoStart,path:process.execPath,args:['--hidden']});
  }catch(e){}
 }
 start(){
  if(this.timer)return;
  this.timer=setInterval(()=>this.tick().catch(()=>{}),30000);
  // 软件刚打开：若今天的计划时刻已过且还没跑，补跑一次（免得「早上开机晚了就漏一天」）
  setTimeout(()=>this.tick().catch(()=>{}),8000);
 }
 stop(){if(this.timer){clearInterval(this.timer);this.timer=null;}}
 close(){this.stop();this.save();}

 // 每次检查：到点（或已过点）且今天没跑、模块空闲 → 触发；忙则顺延（下个 tick 再试，直到当天结束）
 async tick(){
  if(!this.data.enabled||this.running||this.work)return;
  const ts=this.now(),today=bjDate(ts);
  if(this.data.lastRun&&this.data.lastRun.date===today&&this.data.lastRun.status!=='skipped')return;
  const setAt=String(this.data.time||'08:30');
  if(bjTime(ts)<setAt)return;
  if(bjTime(ts)>='23:59')return; // 深夜不再补跑
  if(this.isBusy()){
   this.phaseText='今日计划时刻已到，但抓取模块正忙（手动抓取/登录中），稍后自动重试…';
   return;
  }
  const day=shiftDate(today,-1);
  this.work=this.executePlan(day,today).catch(error=>{this.phaseText='每日计划失败：'+error.message;}).finally(()=>{this.work=null;});
  await this.work;
 }
 isBusy(){
  const s=this.service,f=this.fund;
  return !!(s&&(s.busy||s.loginBusy||s.exportBusy||s.accountTransferBusy)||f&&(f.busy||f.downloadBusy||f.diagnosing));
 }
 // 立即运行（手动按钮）：同样抓 T-1；已在跑则拒绝
 async runNow(){
  if(this.running||this.work)throw Error('每日计划正在运行');
  if(this.isBusy())throw Error('抓取模块正忙（手动抓取/登录中），请稍后再试');
  const day=shiftDate(bjDate(this.now()),-1);
  this.work=this.executePlan(day,bjDate(this.now())).catch(error=>{this.phaseText='每日计划失败：'+error.message;}).finally(()=>{this.work=null;});
  await this.work;
  return this.state();
 }
 // 跑一轮并只返回「本轮新增」的结果行，避免与当天更早轮次的行混淆
 // v1.2.69（11-09 13:45 run 复盘实锤）：旧实现 start 前抓 this.service.data 引用快照，
 // 但 save() 是 this.data=新对象 的引用替换——旧快照数组不再增长，slice(base) 恒为空，
 // 结果「推广费 10 家 + 资金 6 家全部成功，汇总却报 0 成功 10 失败」。改为：
 // start 前记下已有 runId 集合，完成后从 service 的**当前** data 里按「新 runId + 店铺」取行。
 async runRound(kind,shopIds,day){
  if(!shopIds.length)return [];
  const service=kind==='promo'?this.service:this.fund;
  const beforeRuns=new Set(service.data.results.map(r=>r.runId));
  if(kind==='promo')await service.start({shopIds,start:day,end:day});
  else await service.start({shopIds,months:{start:monthOf(day),end:monthOf(day)},day});
  if(kind==='promo'&&service.work)await service.work;
  if(kind==='fund'&&service.work)await service.work;
  return service.data.results.filter(r=>!beforeRuns.has(r.runId)&&shopIds.includes(r.shopId));
 }
 // v1.2.69：网络就绪探测（11-10 06:30 run 实锤：睡眠唤醒后立即开跑，10 家全部「官方页面
 // 加载超时」——网络还没恢复。开跑前先探测官方域名连通性，不通则等 30 秒重试，最多 10 次
 // （5 分钟），全程不打扰、探测通过立即开跑）
 async waitNetworkReady(){
  const probe=this.netProbe||(()=>{
   const net=require('node:net');
   return ()=>new Promise(resolve=>{
    const sock=net.connect({host:'qn.taobao.com',port:443});
    const done=v=>{try{sock.destroy();}catch(e){}resolve(v);};
    sock.setTimeout(4000,()=>done(false));
    sock.once('connect',()=>done(true));
    sock.once('error',()=>done(false));
   });
  })();
  for(let i=0;i<10;i++){
   if(await probe())return true;
   this.phaseText='网络尚未就绪（可能是电脑刚唤醒），'+(i<9?'30 秒后重试':'已等待 5 分钟仍未连通')+'…';
   if(i<9)await wait(this.netRetryMs);
  }
  return false;
 }
 // 执行一轮完整计划（两轮重试 + 汇总 + 导出）
 async executePlan(day,today){
  this.running=true;this.phaseText='每日计划（'+day+'）开始';
  const startedAt=new Date().toISOString();
  const record={id:randomUUID(),date:day,startedAt,finishedAt:null,status:'running',rows:[],summary:null,error:''};
  try{
   // 网络未就绪时也继续跑（抓取模块自身有超时与二轮重试），只把等待过程写进 phaseText
   await this.waitNetworkReady();
   const shops=this.service.data.shops||[];
   const allIds=shops.map(s=>s.id);
   const fundIds=shops.filter(s=>['taobao','tmall'].includes(s.platform||'taobao')).map(s=>s.id);
   // 月累计快照先抓，单日结果后抓，确保工作台默认仍展示本次单日计划。
   // 月初第一天的累计与单日是同一个区间，无需重复抓。
   if(this.refreshMonthly&&allIds.length&&day.slice(8)!=='01'){
    this.phaseText='每日计划（'+day+'）更新推广费月累计（'+allIds.length+' 家）';
    const before=new Set(this.service.data.results.map(r=>r.runId));
    await this.service.start({shopIds:allIds,start:monthOf(day)+'-01',end:day});
    if(this.service.work)await this.service.work;
    if(this.service.writeFailure)throw Error(this.service.lastError||'推广费记录保存失败，已停止后续抓取');
    const rows=this.service.data.results.filter(r=>!before.has(r.runId)&&allIds.includes(r.shopId));
    const byId=new Map(rows.map(r=>[r.shopId,r]));
    record.monthly=allIds.map(id=>{const r=byId.get(id);return {shopId:id,status:r?.status||'missing',error:r?.error||(!r?'未生成月累计结果':'')};});
   }
   // —— 第一轮：全部店铺 ——
   this.phaseText='每日计划（'+day+'）第一轮 · 推广费（'+allIds.length+' 家）';
   const round1P=await this.runRound('promo',allIds,day);
   this.phaseText='每日计划（'+day+'）第一轮 · 资金日汇总（'+fundIds.length+' 家）';
   const round1F=await this.runRound('fund',fundIds,day);
   // —— 第二轮：只跑第一轮失败的店铺（推广费口径对齐 retry()：completed 但含「无/财务号」子账户的也要重查）——
   const failedP=round1P.filter(promoNeedRetry).map(r=>r.shopId);
   const failedF=round1F.filter(r=>r.status!=='completed').map(r=>r.shopId);
   let round2P=[],round2F=[];
   if(failedP.length||failedF.length){
    this.phaseText='每日计划（'+day+'）第二轮 · 重试失败的店铺（推广费 '+failedP.length+' 家 / 资金 '+failedF.length+' 家）';
    round2P=await this.runRound('promo',failedP,day);
    round2F=await this.runRound('fund',failedF,day);
   }
   // —— 汇总：每店一行；第二轮成功覆盖第一轮失败的行，轮次按实际成功（或最终失败）的那轮标 ——
   const curP=new Map(round1P.map(r=>[r.shopId,r])),curF=new Map(round1F.map(r=>[r.shopId,r]));
   for(const r of round2P)curP.set(r.shopId,r);
   for(const r of round2F)curF.set(r.shopId,r);
   const p1=new Map(round1P.map(r=>[r.shopId,r])),f1=new Map(round1F.map(r=>[r.shopId,r]));
   // 轮次判定：该店进过第二轮 → 成功了就是二轮；没进过 → 一轮
   const inR2P=new Set(round2P.map(r=>r.shopId)),inR2F=new Set(round2F.map(r=>r.shopId));
   record.rows=shops.map(s=>{
    const p2=curP.get(s.id),f2=curF.get(s.id);
    // v1.2.91（用户 2026-11-11 口径）：推广费成功 = completed；「无/财务号」子账户两轮核对后仍是
    // 无数据的（财务号结构性无金额、「无」即当前无推广，重查也不会变）→ 统一按没数据处理，
    // 不计失败、不写红字说明；行上保留 suspect 标记供界面显示灰色「无数据」徽标。
    const pOk=p2&&p2.status==='completed';
    const fOk=f2&&f2.status==='completed';
    const isFundShop=['taobao','tmall'].includes(s.platform||'taobao');
    const promo=p2||p1.get(s.id);
    const fund=isFundShop?(f2||f1.get(s.id)||null):null;
    const pRound=pOk?(inR2P.has(s.id)?2:1):null;
    const fRound=fOk?(inR2F.has(s.id)?2:1):null;
    const pSuspect=promo&&promo.status==='completed'&&promoSuspect(promo);
    return {
     shopId:s.id,shopName:s.name,platform:s.platform||'taobao',
     promo:promo?{status:promo.status,amountCents:promo.amountCents??null,round:pRound,suspect:!!pSuspect}:null,
     fund:isFundShop?(fund?{status:fund.status,incomeCents:fund.incomeCents??null,expenseCents:fund.expenseCents??null,incomeCount:fund.incomeCount??null,expenseCount:fund.expenseCount??null,balanceCents:fund.balanceCents??null,round:fRound}:{status:'missing',round:null}):null,
     error:[
      promo&&!pOk?promo.error:'',
      isFundShop&&fund&&!fOk?fund.error:''
     ].filter(Boolean).join('；')
    };
   });
   const isRound1Ok=r=>r.promo&&r.promo.status==='completed'&&r.promo.round===1&&(!r.fund||(r.fund.status==='completed'&&r.fund.round===1));
   const isOk=r=>r.promo&&r.promo.status==='completed'&&(!r.fund||r.fund.status==='completed');
   const ok1=record.rows.filter(isRound1Ok).length;
   const ok2=record.rows.filter(r=>isOk(r)&&!isRound1Ok(r)).length;
   const failed=record.rows.filter(r=>!isOk(r)).length;
   const manualCount=record.rows.filter(r=>r.promo&&r.promo.status==='manual').length;
   record.summary={total:record.rows.length,okRound1:ok1,okRound2:ok2,failed,manual:manualCount};
   if(record.monthly)record.summary.monthly={total:record.monthly.length,failed:record.monthly.filter(r=>r.status!=='completed').length};
   record.status=failed?'partial':'done';
   // —— v1.2.84 自动下载当日明细：资金已完成的淘宝/天猫店逐家下载 T-1 单日「下载明细」。
   // 串行执行（资金模块同一时刻只允许一个下载任务），单家失败只记在该行，不影响计划成败；
   // 京东店与资金未完成的店跳过。开关 autoDetailDownload 默认开，计划卡片可关。
   if(this.data.autoDetailDownload!==false&&typeof this.fund.downloadDay==='function'){
    const detailRows=record.rows.filter(r=>['taobao','tmall'].includes(r.platform)&&r.fund&&r.fund.status==='completed');
    let files=0,noData=0,dFail=0;
    for(let i=0;i<detailRows.length;i++){
     const row=detailRows[i];
     this.phaseText='每日计划（'+day+'）自动下载当日明细：'+row.shopName+'（'+(i+1)+'/'+detailRows.length+'，已得 '+files+' 份）';
     try{
      const res=await this.fund.downloadDay({shopId:row.shopId,date:day});
      row.detailFiles=(res.files||[]).length;
      files+=row.detailFiles;
      if(res.note){row.detailNote=res.note;noData++;}
     }catch(e){
      row.detailFiles=0;row.detailError=e.message;dFail++;
     }
    }
    record.summary.detail={shops:detailRows.length,files,noData,failed:dFail};
    this.phaseText='每日计划（'+day+'）完成：一轮成功 '+ok1+'，二轮成功 '+ok2+'，仍失败 '+failed+(manualCount?'（其中需人工验证 '+manualCount+' 家）':'')
     +'；明细文件 '+files+' 份'+(noData?'（暂无数据 '+noData+' 家）':'')+(dFail?'，下载失败 '+dFail+' 家':'');
   }
   record.finishedAt=new Date().toISOString();
   this.phaseText='每日计划（'+day+'）完成：一轮成功 '+ok1+'，二轮成功 '+ok2+'，仍失败 '+failed+(manualCount?'（其中需人工验证 '+manualCount+' 家）':'');
   // —— 自动导出 Excel（先导出，导出文件路径进 lastRun/历史）——
   if(this.data.autoExport){
    try{record.exportFile=this.exportExcel(record);}
    catch(e){this.phaseText+='；Excel 导出失败：'+e.message;}
   }
   this.data.lastRun={date:today,planDate:day,status:record.status,finishedAt:record.finishedAt,summary:record.summary,exportFile:record.exportFile||''};
   this.data.history.push(record);
   if(this.data.history.length>60)this.data.history=this.data.history.slice(-60);
   this.save();
  }catch(error){
   record.status='failed';record.error=error.message;record.finishedAt=new Date().toISOString();
   this.data.lastRun={date:today,planDate:day,status:'failed',finishedAt:record.finishedAt,error:error.message};
   this.data.history.push(record);
   if(this.data.history.length>60)this.data.history=this.data.history.slice(-60);
   this.save();
   throw error;
  }finally{this.running=false;}
  return record;
 }
 // 结果落 Excel：日期|店铺|平台|推广费|推广费状态|轮次|资金收入|资金支出|期末余额|资金状态|轮次|说明
 exportExcel(record){
  const head=['计划日期','店铺','平台','推广费（元）','推广费状态','推广费轮次','资金收入笔数','资金收入（元）','资金支出笔数','资金支出（元）','期末余额（元）','资金状态','资金轮次','明细文件','说明'];
  const cents=v=>v===null||v===undefined?'':(v/100).toFixed(2);
  // v1.2.91：「无/财务号」子账户两轮后仍无数据 → 按无数据处理（不算失败/待核对）
  const promoStatus=r=>r.suspect?(r.amountCents==null?'无数据(财务号/无)':'部分无数据(财务号/无)'):r.status==='manual'?'需人工验证':r.status;
  // v1.2.84：明细文件列——淘宝/天猫店显示份数（0 个/暂无数据也如实标），京东店留空
  const detailCell=r=>{
   if(!['taobao','tmall'].includes(r.platform)||!r.fund||r.fund.status!=='completed')return '';
   if(r.detailFiles==null)return '未下载';
   return String(r.detailFiles)+' 个'+(r.detailNote?'（暂无数据）':'');
  };
  const rows=record.rows.map(r=>[
   record.date,r.shopName,r.platform,
   r.promo?cents(r.promo.amountCents):'',r.promo?promoStatus(r.promo):'',r.promo&&r.promo.round?r.promo.round:'',
   r.fund&&r.fund.incomeCount!=null?r.fund.incomeCount:'',r.fund?cents(r.fund.incomeCents):'',r.fund&&r.fund.expenseCount!=null?r.fund.expenseCount:'',r.fund?cents(r.fund.expenseCents):'',r.fund?cents(r.fund.balanceCents):'',
   r.fund?r.fund.status:'',r.fund&&r.fund.round?r.fund.round:'',
   detailCell(r),
   [r.error,r.detailError?'明细下载失败：'+r.detailError:'',r.detailNote&&r.detailFiles?r.detailNote:''].filter(Boolean).join('；')||''
  ]);
  const ws=XLSX.utils.aoa_to_sheet([head,...rows]);
  ws['!cols']=head.map(h=>({wch:Math.max(10,String(h).length+2)}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'每日计划');
  const dir=this.exportDir();
  fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'每日计划_'+record.date+'.xlsx');
  XLSX.writeFile(wb,file);
  return file;
 }
 exportDir(){
  try{const ef=this.fund.data.exportFolder;if(ef)return ef;}catch(e){}
  return path.join(this.root,'每日计划导出');
 }
}

module.exports={Scheduler,bjDate,bjTime,shiftDate,monthOf};
