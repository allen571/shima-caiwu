'use strict';
const {app,BrowserWindow,ipcMain,safeStorage,dialog,Menu,shell,crashReporter,Tray}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const testMode=process.env.SHIMA_FINANCE_TEST==='1';
app.setName('诗玛财务 AI 工作台');
app.setPath('userData',process.env.SHIMA_FINANCE_TEST_ROOT||path.join(app.getPath('appData'),'shima-finance-ai-workbench'));
if(testMode&&process.platform==='darwin')app.setActivationPolicy('prohibited');
// 「双击后直接闪退」无迹可查（用户 2026-11-08 反馈）：主进程任何一步死掉都没有现场。
// 落一份启动日志到 userData/startup.log，闪退后把这一行行发回来就能定位卡在哪一步。
const traceLog=path.join(app.getPath('userData'),'startup.log');
const trace=(event,detail)=>{try{const line=new Date().toISOString()+' | v'+app.getVersion()+' | '+process.platform+'-'+process.arch+' | '+event+(detail?' | '+String(detail).replace(/\s+/g,' ').slice(0,600):'')+'\n';if(fs.existsSync(traceLog)&&fs.statSync(traceLog).size>524288)fs.writeFileSync(traceLog,'');fs.appendFileSync(traceLog,line);}catch(error){}};
trace('boot',process.argv.slice(1).join(' '));
try{crashReporter.start({productName:'ShimaFinanceWorkbench',companyName:'Shima',submitURL:'https://shimafinance.invalid/report',uploadToServer:false,compress:false});}catch(error){trace('crash-reporter-failed',error.message);}
process.on('uncaughtException',error=>{trace('uncaught-exception',error&&error.stack||error);});
process.on('unhandledRejection',error=>{trace('unhandled-rejection',error&&error.stack||error);});
let main,service,fund,scheduler,tray=null,quitting=false;
const locked=()=>(service&&(service.busy||service.loginBusy||service.exportBusy||service.accountTransferBusy))||!!(fund&&(fund.busy||fund.downloadBusy||fund.diagnosing))||!!(scheduler&&scheduler.running);
const shutdown=()=>{quitting=true;try{fs.unlinkSync(path.join(app.getPath('userData'),'session.lock'));}catch(error){}try{scheduler?.close();}catch(error){}service?.close();fund?.close();};
// 单实例锁：旧版窗口还开着时，新版会在启动瞬间静默 app.quit()——用户看到的就是「双击后直接闪退没了」。
// 这里不再静默退出：明确告诉用户是旧窗口占着，并把旧窗口拉到前台；同时把现场写进 startup.log。
if(!app.requestSingleInstanceLock()){
 trace('single-instance-blocked','已有工作台进程在运行，本次启动退出');
 // v1.2.57 弹窗节流：启动要解压 10~15 秒，用户以为没反应会连续双击——每次都弹「已经在运行」
 // 反而像报错轰炸。90 秒内弹过一次就静默退出，靠旧实例的 second-instance 把已开窗口顶到前台
 const promptFlag=path.join(app.getPath('userData'),'instance-prompt.flag');
 let prompted=0;
 try{prompted=Number(fs.readFileSync(promptFlag,'utf8'))||0;}catch(error){}
 const now=Date.now();
 if(now-prompted<90000){
  trace('single-instance-throttled','90 秒内已提示过，静默退出（已开窗口应已被顶到前台）');
  app.exit(0);
 }else{
  try{fs.writeFileSync(promptFlag,String(now));}catch(error){}
  app.whenReady().then(()=>{
   // 旧实例已经收到 second-instance 事件把自己顶到前台了，这里只负责把话说清楚
   const answer=dialog.showMessageBoxSync({type:'warning',title:'工作台已经在运行',message:'已经有一个「诗玛财务 AI 工作台」窗口在运行。',detail:'如果任务栏里已经能看到工作台窗口，直接用那个窗口即可，不用再双击。\n\n确实找不到旧窗口（或它是旧版本想换新版）时，可以选「结束旧进程并继续」——注意：旧窗口里正在跑的抓取/下载会被中断。',buttons:['我知道了','结束旧进程并继续'],defaultId:0,cancelId:0,noLink:true});
   trace('single-instance-choice','response='+answer);
   if(answer===1){
    // 只结束「有主窗口」的那个进程：按住名字整片杀会连本进程自己的渲染/GPU 子进程一起带走
    try{const {execFileSync}=require('node:child_process');execFileSync('powershell',['-NoProfile','-NonInteractive','-Command','Get-Process -Name "诗玛财务AI工作台" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Stop-Process -Force -ErrorAction SilentlyContinue'],{stdio:'ignore'});}catch(error){trace('single-instance-kill-failed',error.message);}
    // 便携版进程跑在临时解压目录里，直接 relaunch(execPath) 会指向随时被清理的 temp 路径——优先回到用户双击的那个 EXE
    const target=process.env.PORTABLE_EXECUTABLE_FILE||process.execPath;
    trace('single-instance-relaunch',target);
    // 强杀后单实例命名锁要等旧进程真正退出才释放，立刻 relaunch 会再撞一次锁——留一拍再起
    setTimeout(()=>{app.relaunch({execPath:target,args:[]});app.exit(0);},1200);return;
   }
   app.exit(0);
  });
 }
}else{
 app.on('second-instance',()=>{if(main&&!main.isDestroyed())require('./promotion-fee-front.cjs').bringToFront(main);});
 app.whenReady().then(async()=>{
  try{
   trace('ready','开始初始化');
   Menu.setApplicationMenu(null);
   if(process.platform==='darwin')app.dock?.setIcon(path.join(__dirname,'../assets/app-icon.png'));
   service=new(require('./promotion-fee.cjs').PromotionFee)({root:app.getPath('userData'),BrowserWindow,safeStorage,hidden:testMode,desktop:app.getPath('desktop')});
   fund=new(require('./fund-summary.cjs').FundSummary)({host:service,root:app.getPath('userData'),dialog,downloads:app.getPath('downloads'),desktop:app.getPath('desktop'),hidden:testMode});
   // v1.2.61：每日计划（定时抓取）——应用内定时 + 托盘常驻；软件没开就抓不了，开晚了会补跑
   scheduler=new(require('./scheduler.cjs').Scheduler)({service,fund,root:app.getPath('userData')});
   scheduler.start();
   scheduler.applyAutoStart();
   trace('services-created','schedule='+(scheduler.data.enabled?scheduler.data.time:'off'));
   // 互斥：资金抓取/导出与推广费查询、登录共用窗口与会话，不能并行
   for(const action of ['start','retry','login']){const original=service[action].bind(service);service[action]=async(...args)=>{if(fund.busy||fund.downloadBusy||fund.diagnosing)throw Error('资金月汇总抓取或导出正在运行，请稍后再试');return original(...args);};}
  main=new BrowserWindow({width:1240,height:920,minWidth:580,minHeight:500,show:!testMode&&!process.argv.includes('--hidden'),title:'诗玛财务 AI 工作台',icon:path.join(__dirname,'../assets/app-icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  trace('window-created','show='+(!testMode));
  // v1.2.61：托盘常驻——每日计划开启后关窗=隐藏到托盘，到点自动抓；托盘菜单可显示窗口/立即执行/退出
  try{
   tray=new Tray(path.join(__dirname,'../assets/app-icon.ico'));
   const trayMenu=Menu.buildFromTemplate([
    {label:'显示主窗口',click:()=>{if(main&&!main.isDestroyed()){main.show();main.focus();}}},
    {label:'立即执行每日计划（抓 T-1）',click:()=>{scheduler.runNow().then(()=>{if(main&&!main.isDestroyed()){main.show();main.focus();}}).catch(error=>{trace('schedule-runnow-failed',error.message);dialog.showErrorBox('每日计划',error.message);});}},
    {type:'separator'},
    {label:'退出',click:()=>{quitting=true;app.quit();}}
   ]);
   tray.setToolTip('诗玛财务 AI 工作台');
   tray.setContextMenu(trayMenu);
   tray.on('double-click',()=>{if(main&&!main.isDestroyed()){main.show();main.focus();}});
   trace('tray-created','schedule='+(scheduler.data.enabled?scheduler.data.time:'off'));
  }catch(error){trace('tray-failed',error.message);}
   // 渲染进程崩掉时（GPU/内存异常）窗口会直接消失，同样表现为「闪退」——必须留痕并尝试自愈
   main.webContents.on('render-process-gone',(event,details)=>{trace('render-process-gone',details.reason+' exitCode='+details.exitCode);});
   main.webContents.on('did-fail-load',(event,code,description,url)=>{trace('did-fail-load',code+' '+description+' '+url);});
   main.webContents.on('preload-error',(event,preloadPath,error)=>{trace('preload-error',preloadPath+' '+(error&&error.message));});
   main.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   main.webContents.on('will-navigate',event=>event.preventDefault());
   for(const action of ['state','login','setConcurrency','putShop','removeShop','removeShops','start','retry','pause','export','importAccounts','exportAccounts','checkLogins'])ipcMain.handle('promotion:'+action,async(event,...args)=>{
    if(event.sender!==main.webContents||event.senderFrame!==main.webContents.mainFrame)throw Error('无权访问');
    if(['importAccounts','exportAccounts'].includes(action))return require('./promotion-fee-accounts.cjs').transferAccounts({service,action,dialog,parent:main,downloads:app.getPath('downloads')});
    if(action==='export')return require('./promotion-fee-export.cjs').exportPromotionFees({service,dialog,parent:main,downloads:app.getPath('downloads')});
    if(action==='removeShop'){
     const shop=service.shop(args[0]);
     if(service.busy||service.loginBusy)throw Error('查询或登录期间不能删除账号');
     const answer=await dialog.showMessageBox(main,{type:'warning',message:'删除账号“'+shop.name+'”？',detail:'历史查询结果保留。',buttons:['取消','删除账号'],defaultId:0,cancelId:0,noLink:true});
     if(answer.response!==1)return {...service.state(),cancelled:true};
    }
    if(action==='removeShops'){
     if(service.busy||service.loginBusy)throw Error('查询或登录期间不能删除账号');
     const ids=[...new Set(Array.isArray(args[0])?args[0]:[])];
     // 只列实际存在的账号，避免确认框与实际删除数对不上
     const removing=ids.map(id=>service.data.shops.find(s=>s.id===id)).filter(Boolean);
     if(!removing.length)throw Error('请先勾选要删除的账号');
     const shown=removing.slice(0,8).map(s=>s.name).join('、');
     const answer=await dialog.showMessageBox(main,{type:'warning',message:'删除所选的 '+removing.length+' 个账号？',detail:'将删除：'+shown+(removing.length>8?' 等 '+removing.length+' 个':'')+'。历史查询结果保留。',buttons:['取消','删除所选'],defaultId:0,cancelId:0,noLink:true});
     if(answer.response!==1)return {...service.state(),cancelled:true};
    }
    return service[action](...args);
   });
   for(const action of ['state','start','restart','pause','download','downloadBatch','setAutoDownload','confirmManual','skipManual'])ipcMain.handle('fund:'+action,async(event,...args)=>{
    if(event.sender!==main.webContents||event.senderFrame!==main.webContents.mainFrame)throw Error('无权访问');
    if(action==='start'&&(service.busy||service.loginBusy))throw Error('推广费查询或登录正在运行');
    return fund[action](...args);
   });
   // v1.2.61：每日计划（定时抓取）IPC
   for(const action of ['state','configure','runNow'])ipcMain.handle('schedule:'+action,async(event,...args)=>{
    if(event.sender!==main.webContents||event.senderFrame!==main.webContents.mainFrame)throw Error('无权访问');
    if(action==='configure')return scheduler.configure(args[0]||{});
    if(action==='runNow')return await scheduler.runNow();
    return scheduler.state();
   });
   ipcMain.handle('fund:setExportFolder',async event=>{
    if(event.sender!==main.webContents||event.senderFrame!==main.webContents.mainFrame)throw Error('无权访问');
    const answer=await dialog.showOpenDialog(main,{title:'选择资金导出文件夹',properties:['openDirectory','createDirectory']});
    if(answer.canceled)return {...fund.state(),cancelled:true};
    return fund.setExportFolder(answer.filePaths[0]);
   });
   ipcMain.handle('app:exportDiagnostic',async event=>{
    if(event.sender!==main.webContents||event.senderFrame!==main.webContents.mainFrame)throw Error('无权访问');
    return require('./diagnostic-export.cjs').exportDiagnostic({service,fund,version:app.getVersion(),platform:process.platform,arch:process.arch,dialog,parent:main,downloads:app.getPath('downloads')});
   });
   // v1.2.82：导出随安装包内置的源码快照（打包时由 electron-builder extraResources 放进 resources/）
   for(const action of ['sourceInfo','exportSource'])ipcMain.handle('app:'+action,async event=>{
    if(event.sender!==main.webContents||event.senderFrame!==main.webContents.mainFrame)throw Error('无权访问');
    const source=require('./source-export.cjs');
    const options={version:app.getVersion(),resourcesPath:process.resourcesPath,appPath:app.getAppPath()};
    if(action==='sourceInfo')return source.sourceInfo(options);
    return source.exportSource({...options,dialog,parent:main,desktop:app.getPath('desktop'),shell});
   });
   // v1.2.83：内置「财务工作台」（FinanceHub，本机 8765 端口的数据服务），界面按钮一键启动
   for(const action of ['workbenchStatus','workbenchLaunch'])ipcMain.handle('app:'+action,async event=>{
    if(event.sender!==main.webContents||event.senderFrame!==main.webContents.mainFrame)throw Error('无权访问');
    const launcher=require('./workbench-launcher.cjs');
    const options={resourcesPath:process.resourcesPath,appPath:app.getAppPath(),userData:app.getPath('userData')};
    if(action==='workbenchStatus')return launcher.status(options);
    return launcher.launch(options);
   });
   ipcMain.handle('fund:openExportFolder',async event=>{
    if(event.sender!==main.webContents||event.senderFrame!==main.webContents.mainFrame)throw Error('无权访问');
    // 用户反馈「找不到 D:\Backup\Downloads 这个盘」：导出文件夹可能是被重定向的下载目录，资源管理器里很难找——直接帮用户打开
    const dir=fund.exportFolder();
    try{fs.mkdirSync(dir,{recursive:true});}catch(e){}
    const r=await shell.openPath(dir);
    if(r)throw Error('打开导出文件夹失败：'+r);
    return fund.state();
   });
   main.on('close',event=>{
    if(quitting)return;
    // v1.2.61：每日计划已启用（或正在跑）时，点关闭=最小化到托盘，不退出——定时到点才能抓
    if(scheduler&&(scheduler.data.enabled||scheduler.running)&&tray){
     event.preventDefault();
     if(!main.isVisible())return;
     main.hide();
     return;
    }
    if(locked()){
     event.preventDefault();
     // 卡死逃生门（用户 2026-11-04 被困）：抓取/导出/诊断任一状态异常挂起时，「知道了」会变成死循环——
     // 必须给一个强制退出出口。抓取记录逐条实时落盘，强退最多丢当前正在抓的那一格
     void dialog.showMessageBox(main,{type:'warning',message:'还有查询/导出操作没有结束，暂时不能直接退出。',detail:'建议先点页面上的「暂停」，等它结束后再关。如果操作卡住不动，点「强制退出」立即关闭：抓取记录逐条实时保存，最多丢失正在抓的那一格。',buttons:['知道了','强制退出'],defaultId:0,cancelId:0,noLink:true}).then(({response})=>{
      if(response===1){shutdown();app.exit(0);}
     });
    }else shutdown();
   });
   app.on('before-quit',event=>{if(!quitting&&locked()){event.preventDefault();main.show();main.focus();}else{shutdown();try{tray?.destroy();}catch(error){}}});
   // v1.2.72：版本号经 query 注入 UI（boot.js 读 location.search 显示角标，替代写死的 v1.2.5）
   await main.loadFile(path.join(__dirname,'../ui/index.html'),{query:{v:app.getVersion()}});
   trace('ui-loaded','');
   if(testMode){
    await require('../scripts/smoke.cjs').run({app,main,service,dialog});
    shutdown();app.quit();
   }
  }catch(error){
   trace('startup-failed',error&&error.stack||error);
   if(testMode)console.error(error.stack);else dialog.showErrorBox('财务 AI 工作台启动失败',(error&&error.message||String(error))+'\n\n诊断日志（发给技术）：'+traceLog);
   shutdown();app.exit(1);
  }
 });
 app.on('window-all-closed',()=>{trace('window-all-closed','');app.quit();});
 app.on('child-process-gone',(event,details)=>{if(details&&details.reason!=='clean-exit')trace('child-process-gone',details.type+' '+details.reason);});
}
