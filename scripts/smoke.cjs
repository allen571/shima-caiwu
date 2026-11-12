'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const XLSX=require('../vendor/xlsx.full.min.js');
exports.run=async({app,main,service,dialog})=>{
 const root=app.getPath('userData'),out=process.env.SHIMA_FINANCE_EVIDENCE||root,phase=process.env.SHIMA_FINANCE_TEST_PHASE||'first';
 fs.mkdirSync(out,{recursive:true});
 const report={version:app.getVersion(),electron:process.versions.electron,phase,hidden:true,realIPC:true,realSafeStorage:true,platformQuery:'synthetic adapter, no network',fileDialogs:'deterministic destinations',checks:[]};
 const js=code=>main.webContents.executeJavaScript(code,true),until=async(test)=>{for(let i=0;i<100;i++){if(await test())return;await new Promise(r=>setTimeout(r,50));}throw Error('等待实际控件结果超时');};
 try{
  assert.ok(root.includes('shima-finance-'));assert.equal(service.data.shops.length,phase==='reopen'?2:0);
  await until(()=>js(`!!document.querySelector('#pf-import-accounts')`));
  assert.equal(await js('document.querySelector("h1").textContent'),'财务 AI 工作台');
  report.checks.push('独立main/preload真实IPC加载、品牌和隔离目录');
  if(phase==='reopen'){
   assert.equal(service.state().results[0].amountCents,12345);
   assert.equal(service.safeStorage.decryptString(Buffer.from(service.data.shops[0].secret,'base64')),'synthetic-password');
   assert.equal(new Set(service.data.shops.map(s=>s.sessionKey)).size,2);
   const restored=service.window(service.data.shops[0]);
   const cookies=await restored.webContents.session.cookies.get({url:'https://session-test.invalid/'});
   assert.equal(cookies.find(c=>c.name==='synthetic-session')?.value,'synthetic-only');restored.destroy();
   report.checks.push('重启保存账号、密码解密、会话隔离、合成Cookie持久恢复及查询结果恢复');
  }else{
   await js(`document.querySelector('#pf-account-editor').open=true;document.querySelector('#pf-user').value='synthetic-finance';document.querySelector('#pf-password').value='synthetic-password';document.querySelector('#pf-form').requestSubmit()`);
   await until(()=>js(`document.querySelector('#pf-message').textContent.includes('账号已保存')`));
   assert.equal(service.data.shops.length,1);assert.notEqual(service.data.shops[0].secret,'synthetic-password');
   report.checks.push('真实表单保存账号、系统加密与本地持久记录');
   const realIdentity=service.identity.bind(service);let seenPartition,seenWindow;
   service.identity=async(shop,win)=>{seenPartition=win.webContents.session;seenWindow=win;await new Promise(r=>setTimeout(r,100));return shop.name;};
   await js(`document.querySelector('[data-login]').click()`);
   await until(()=>!!service.loginWork);await service.loginWork;
   await until(()=>js(`document.querySelector('#pf-shops').textContent.includes('已登录')`));
   assert.ok(service.data.shops[0].loginConfirmedAt);assert.equal(service.data.results.length,0);
   assert.equal(seenPartition,require('electron').session.fromPartition('persist:promotion-fee:'+service.data.shops[0].sessionKey));
   assert.equal(await js(`document.querySelector('[data-login]').textContent`),'重新登录');
   service.identity=async(shop,win,options)=>{assert.equal(options.revalidate,true);assert.equal(win,seenWindow);await new Promise(r=>setTimeout(r,100));return shop.name;};
   await js(`document.querySelector('[data-login]').click()`);await until(()=>service.loginBusy);await service.loginWork;
   await until(()=>js(`document.querySelector('#pf-message').textContent.includes('登录状态已确认')`));
   assert.equal(seenWindow.isVisible(),false);assert.equal(service.data.results.length,0);
   report.checks.push('实际重新登录按钮复用同账号窗口并要求重新核验，有效会话确认后保持后台、不读取账单');
   service.markLoginRequired(service.data.shops[0]);
   await js(`document.querySelector('#pf-concurrency').dispatchEvent(new Event('change'))`);
   await until(()=>js(`document.querySelector('#pf-shops').textContent.includes('需确认登录')`));
   assert.equal(await js(`document.querySelector('[data-login]').textContent`),'登录');
   await js(`document.querySelector('[data-login]').click()`);await until(()=>service.loginBusy);await service.loginWork;
   await until(()=>js(`document.querySelector('#pf-shops').textContent.includes('已登录')`));
   const goodDates=await js(`({start:document.querySelector('#pf-start').value,end:document.querySelector('#pf-end').value})`);
   await js(`document.querySelector('#pf-start').value='2026-10-23';document.querySelector('#pf-end').value='2026-10-01';document.querySelector('#pf-start-query').click()`);
   await until(()=>js(`document.querySelector('#pf-message').textContent.includes('请填写有效')`));
   await new Promise(r=>setTimeout(r,150));assert.ok(await js(`document.querySelector('#pf-message').textContent.includes('请填写有效')`));
   assert.equal(service.busy,false);assert.equal(service.data.results.length,0);
   await js(`document.querySelector('#pf-start').value=${JSON.stringify(goodDates.start)};document.querySelector('#pf-end').value=${JSON.stringify(goodDates.end)}`);
   report.checks.push('需确认登录→重新提前登录恢复；日期校验错误不被旧登录成功提示覆盖');
   service.identity=realIdentity;
   report.checks.push('实际登录按钮/IPC/独立持久分区/磁盘保存，合成身份返回，不触发账单查询');
   await seenPartition.cookies.set({url:'https://session-test.invalid/',name:'synthetic-session',value:'synthetic-only',expirationDate:Math.floor(Date.now()/1000)+3600,secure:true});
   await seenPartition.cookies.flushStore();
   service.adapter=async shop=>{assert.equal(service.window(shop).webContents.session,seenPartition);return {shopName:shop.name,amountCents:12345};};
   await js(`document.querySelector('#pf-start-query').click()`);
   await until(()=>js(`document.querySelector('#pf-results').textContent.includes('已获取')`));
   assert.ok((await js(`document.querySelector('#pf-total').textContent`)).includes('123.45'));
   assert.equal(service.window(service.data.shops[0]).webContents.session,seenPartition);
   assert.equal(service.window(service.data.shops[0]),seenWindow);assert.equal(seenWindow.isDestroyed(),false);
   report.checks.push('真实查询按钮沿用提前登录Session，成功后重建窗口仍复用持久分区，合计123.45（合成适配器）');
   // 店铺搜索筛选 + 勾选筛选结果（v1.2.6）
   await js(`(s=>{s.value='synthetic';s.dispatchEvent(new Event('input'))})(document.querySelector('#pf-shop-search'))`);
   await until(()=>js(`document.querySelectorAll('#pf-shops [data-select]').length===1`));
   await js(`document.querySelector('#pf-select-filtered').click()`);
   await until(()=>js(`document.querySelector('#pf-message').textContent.includes('已勾选搜索结果 1 个账号')`));
   await js(`(s=>{s.value='不存在的店铺';s.dispatchEvent(new Event('input'))})(document.querySelector('#pf-shop-search'))`);
   await until(()=>js(`document.querySelector('#pf-shops').textContent.includes('没有匹配')`));
   assert.equal(await js(`document.querySelector('#pf-select-filtered').click(),document.querySelector('#pf-message').textContent.includes('已勾选搜索结果')`),false);
   await js(`(s=>{s.value='';s.dispatchEvent(new Event('input'))})(document.querySelector('#pf-shop-search'))`);
   await until(()=>js(`document.querySelectorAll('#pf-shops [data-select]').length===1`));
   report.checks.push('店铺搜索关键字筛选列表、勾选筛选结果追加勾选与无匹配提示');
   // 本机真实网页控件验收：本地拦截HTTPS，走原query/inspect/attention；不访问平台。
   const syntheticName=service.data.shops[0].name;
   const ledgerMarkup=`<div data-shop-name>${syntheticName}</div><section><div>现金收支明细</div><p>支出（元）<span>¥123.45</span></p><input value="扣款"><input value="交易日期"><input value="${goodDates.start} ~ ${goodDates.end}"><table><tr><td>synthetic ledger</td></tr></table></section>`;
   let ledgerRequests=0;
    await seenPartition.protocol.handle('https',request=>{
     // v1.2.81：按请求里的 cashStart/cashEnd 生成页面日期，第二次查询换成更短的区间也能对上；
     // 只有第一次请求返回带验证的页面，用来验收「遇验证立即标记需人工」。
     const u=new URL(request.url);
     const start=u.searchParams.get('cashStart')||goodDates.start,end=u.searchParams.get('cashEnd')||goodDates.end;
     const pending=++ledgerRequests===1;
     const markup=`<div data-shop-name>${syntheticName}</div><section><div>现金收支明细</div><p>支出（元）<span>¥123.45</span></p><input value="扣款"><input value="交易日期"><input value="${start} ~ ${end}"><table><tr><td>synthetic ledger</td></tr></table></section>`;
     return new Response(`<html><meta charset="utf-8"><body>${pending?'<div id="pending-login" class="captcha"><input type="password"><button id="synthetic-auth-complete" onclick="document.querySelector(\'#pending-login\').remove();document.querySelector(\'#ready-ledger\').hidden=false">完成合成验证</button></div>':''}<main id="ready-ledger">${markup}</main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
    });
   const syntheticAdapter=service.adapter;
   service.adapter=null;service.identity=async shop=>shop.name;
   try{
     await js(`document.querySelector('#pf-start-query').click()`);
     // v1.2.81：批量抓取遇到验证/滑块不再原地等 15 分钟，改为立即标记「需人工」并跳过，
     // 让 160 家店能一口气跑完；这里验收该行为（不阻塞、不弹窗、不重复认证）。
     await until(()=>service.state().results.some(r=>r.status==='manual'));
     const queryingShop=service.data.shops[0],queryingWin=service.windows.get(queryingShop.id);
     assert.equal(queryingWin.webContents.session,seenPartition);assert.equal(service.shop(queryingShop.id).loginNeedsAttention,true);
     assert.equal(service.state().manual.count,1);
     await service.work;
     assert.equal(service.state().results[0].amountCents,null);assert.equal(service.state().results[0].status,'manual');
     report.checks.push('实际查询按钮→页面要求验证→立即标记需人工且不阻塞批次、不弹窗');
     // 该店窗口必须保留：人工处理完补查时直接复用，避免重新登录又撞一次滑块
     assert.equal(queryingWin.isDestroyed(),false);assert.ok(ledgerRequests>=1);
     await until(()=>js(`document.querySelector('#pf-results').textContent.includes('需人工验证')`));
     report.checks.push('真实DOM验证页→inspect 判定验证→标记需人工、不阻塞批次、窗口与会话保留待补查');
   }finally{await seenPartition.protocol.unhandle('https');service.identity=realIdentity;service.adapter=syntheticAdapter;}
   // 合成适配器已恢复：直接把成功结果刷回来（后续导出/导入/授权提示步骤依赖 amountCents=12345）
   await service.start({shopIds:[service.data.shops[0].id],start:goodDates.start,end:goodDates.end});await service.work;
   assert.equal(service.state().results[0].amountCents,12345);
   dialog.showSaveDialog=async()=>({filePath:path.join(root,'account-export.json')});
   await js(`document.querySelector('#pf-export-accounts').click()`);
   await until(()=>js(`document.querySelector('#pf-message').textContent.includes('已导出 1 个账号')`));
   const doc=JSON.parse(fs.readFileSync(path.join(root,'account-export.json'),'utf8'));assert.equal(doc.accounts[0].password,'synthetic-password');
   doc.accounts.push({platform:'jd',username:'synthetic-finance-jd',password:'synthetic-password-2'});
   fs.writeFileSync(path.join(root,'account-import.json'),JSON.stringify(doc));
   dialog.showOpenDialog=async()=>({filePaths:[path.join(root,'account-import.json')]});
   await js(`document.querySelector('#pf-import-accounts').click()`);
   await until(()=>js(`document.querySelector('#pf-message').textContent.includes('已导入 1 个账号，跳过 1')`));
   assert.equal(service.data.shops.length,2);
   assert.equal(service.state().results[0].amountCents,12345);
   report.checks.push('真实账号导出/导入按钮，新增及跳过重复，历史保留');
   dialog.showSaveDialog=async()=>({filePath:path.join(root,'fee-export.csv')});
   await js(`document.querySelector('#pf-export').click()`);
   await until(()=>js(`document.querySelector('#pf-message').textContent.includes('已导出 1 家店铺')`));
   assert.ok(fs.readFileSync(path.join(root,'fee-export.csv'),'utf8').includes('123.45'));
   report.checks.push('真实查询报表导出CSV并回读金额');
   await js(`document.querySelector('#pf-select-all').click()`);
   assert.equal(await js(`document.querySelectorAll('[data-select]:checked').length`),0);
   assert.equal(await js(`document.querySelector('#pf-start-query').disabled`),true);
   await js(`document.querySelector('[data-select]').click()`);
   assert.equal(await js(`document.querySelector('#pf-select-all').indeterminate`),true);
   await js(`document.querySelector('#pf-select-all').click()`);
   assert.equal(await js(`document.querySelectorAll('[data-select]:checked').length`),2);
   assert.equal(await js(`document.querySelector('#pf-select-all').checked&&!document.querySelector('#pf-select-all').indeterminate`),true);
   report.checks.push('实际全选控件：取消全选、单项半选、半选后全选及查询按钮状态');
   const firstResult=service.state().results[0],jdShop=service.data.shops.find(s=>s.platform==='jd');
   const authorizationNotices=[{accountId:'90001001',name:'合成授权账户A',validFrom:'2024-01-01',validUntil:'2026-01-01',stillActive:true,checkedAt:new Date().toISOString()},{accountId:'90001002',name:'合成授权账户B',validUntil:'2026-01-01',stillActive:false,checkedAt:new Date().toISOString()}];
   service.save({...service.data,results:[...service.data.results,{...firstResult,shopId:jdShop.id,shopName:jdShop.name,platform:'jd',amountCents:6789,authorizationNotices}]});
   await js(`document.querySelector('#pf-concurrency').dispatchEvent(new Event('change'))`);
   await until(()=>js(`document.querySelector('#pf-authorization-notices').textContent.includes('合成授权账户B')`));
   assert.equal(await js(`document.querySelector('#pf-authorization-notices').hidden`),false);
   assert.equal(await js(`document.querySelector('#pf-authorization-notices').textContent.includes('旧授权已过期，当前仍有生效授权')`),true);
   assert.equal(await js(`document.querySelector('#pf-authorization-notices').textContent.includes('授权已过期，已跳过过期记录')`),true);
   assert.equal(await js(`window.PromotionFee.resultSummary(window.PromotionFee.resultRows(${JSON.stringify(service.state().results)})).failed`),0);
   report.checks.push('京东过期授权提示显示名称/ID/有效期，并区分旧授权已过期但当前仍有效，不增加失败数');
   assert.equal(await js(`document.querySelector('#pf-authorization-notices ul').hidden`),true);
   report.checks.push('京东授权提醒默认折叠，仅显示条数摘要行');
   await js(`document.querySelector('.pf-notices-toggle').click()`);
   await until(async()=>!await js(`document.querySelector('#pf-authorization-notices ul').hidden`));
   assert.equal(await js(`document.querySelector('.pf-notices-toggle').textContent.includes('点击收起')`),true);
   await js(`document.querySelector('.pf-notices-toggle').click()`);
   await until(async()=>await js(`document.querySelector('#pf-authorization-notices ul').hidden`));
   report.checks.push('京东授权提醒可展开/收起，展开后重渲染保持状态');
   // 「勾选『无』账号」：只勾最近判为无的店铺，便于一键补获取
   const noneShop=service.data.shops[0],beforeResults=service.data.results;
   service.save({...service.data,results:[...beforeResults,{...firstResult,shopId:noneShop.id,shopName:noneShop.name,status:'none',amountCents:null,error:'判定依据：财务记录页未见「收支汇总」入口'}]});
   await js(`document.querySelector('#pf-concurrency').dispatchEvent(new Event('change'))`);
   await until(async()=>await js(`document.querySelectorAll('#pf-results .status-none').length`)===1);
   await js(`document.querySelector('#pf-select-none').click()`);
   await until(async()=>await js(`document.querySelector('#pf-message').textContent.includes('判为「无」的账号')`));
   assert.equal(await js(`document.querySelectorAll('[data-select]:checked').length`),1);
   assert.equal(await js(`document.querySelector('[data-select]:checked').dataset.select`),noneShop.id);
   assert.ok(await js(`document.querySelector('#pf-message').textContent.includes('点「获取推广费」重新抓取')`));
   report.checks.push('「勾选『无』账号」按钮只勾选最近判为无的店铺，并提示点获取推广费重新抓取');
   service.save({...service.data,results:beforeResults});
   await js(`document.querySelector('#pf-concurrency').dispatchEvent(new Event('change'))`);
   await until(async()=>await js(`document.querySelectorAll('#pf-results .status-none').length`)===0);
   await js(`document.querySelector('#pf-select-all').click()`);
   for(const width of [1440,620]){
    main.setSize(width,1120);await new Promise(r=>setTimeout(r,150));
    assert.ok(await js('document.documentElement.scrollWidth<=innerWidth'));
    main.webContents.invalidate();await new Promise(r=>setTimeout(r,250));
    await js(`document.querySelector('#pf-authorization-notices').scrollIntoView({block:'center'})`);
    fs.writeFileSync(path.join(out,'authorization-notices-'+width+'.png'),(await main.webContents.capturePage()).toPNG());
    await js(`document.querySelector('#pf-select-all').scrollIntoView({block:'center'})`);
    fs.writeFileSync(path.join(out,'finance-'+width+'.png'),(await main.webContents.capturePage()).toPNG());
   }
   report.checks.push('1440/620真实布局无页面横向溢出');
   // Excel表格导入：真实 .xls 文件经真实导入按钮与IPC落库，平台别名映射、店铺名拆分、未知平台行被忽略并提示
   const excelFile=path.join(root,'财务账号.xls'),excelBook=XLSX.utils.book_new();
   XLSX.utils.book_append_sheet(excelBook,XLSX.utils.aoa_to_sheet([
    ['平台','账号','密码'],
    ['淘天','excel-shop:ops1','excel-pass'],
    ['京东','excel-jd:ops2','excel-pass-2'],
    ['拼多多','未知店:某账号','bad-pass']
   ]),'账号');
   fs.writeFileSync(excelFile,XLSX.write(excelBook,{type:'buffer',bookType:'biff8'}));
   dialog.showOpenDialog=async()=>({filePaths:[excelFile]});
   await js(`document.querySelector('#pf-import-accounts').click()`);
   await until(()=>js(`document.querySelector('#pf-message').textContent.includes('已导入 2 个账号')`));
   assert.equal(service.data.shops.length,4);
   const excelMessage=await js(`document.querySelector('#pf-message').textContent`);
   assert.ok(excelMessage.includes('忽略 1 行'),'未知平台行应被忽略并提示');assert.ok(excelMessage.includes('共 3 行'));
   assert.equal(await js(`document.querySelector('#pf-shops').textContent.includes('拼多多')`),false);
   const imported=service.data.shops.filter(s=>s.username.startsWith('excel-'));
   assert.deepEqual(imported.map(s=>s.name).sort(),['excel-jd','excel-shop'],'店铺名应由账号拆分保留');
   assert.equal(service.safeStorage.decryptString(Buffer.from(imported.find(s=>s.platform==='jd').secret,'base64')),'excel-pass-2');
   report.checks.push('真实导入按钮读取.xls表格：平台别名映射、店铺名拆分、密码加密落库、未知平台行忽略并提示');
   // 恢复两阶段账号基线，避免影响重启阶段的断言
   service.save({...service.data,shops:service.data.shops.filter(s=>!s.username.startsWith('excel-'))});
  }
  // 资金月汇总页签：切换渲染、默认当前月、店铺胶囊、空结果与文件夹提示、页签往返
  assert.equal(await js(`document.querySelector('#fund-app').hidden`),true);
  await js(`document.querySelector('#finance-tabs [data-tab=fund]').click()`);
  await until(async()=>!await js(`document.querySelector('#fund-app').hidden`));
  const currentMonth=new Date(Date.now()+28800000).toISOString().slice(0,7);
  assert.equal(await js(`document.querySelector('#fs-month-start').value`),currentMonth);
  assert.equal(await js(`document.querySelector('#fs-month-end').value`),currentMonth);
  const fundShops=service.data.shops.filter(s=>['taobao','tmall'].includes(s.platform||'taobao'));
  await until(async()=>await js(`document.querySelectorAll('#fs-shops .fs-shop').length`)===fundShops.length);
  assert.equal(await js(`document.querySelectorAll('#fs-shops .fs-shop input:checked').length`),fundShops.length);
  assert.ok(await js(`document.querySelector('#fs-folder').textContent.includes('诗玛资金导出')`));
  assert.ok(await js(`document.querySelector('#fs-results').textContent.includes('一键抓取所选')`));
  assert.equal(await js(`document.querySelector('#fs-start').disabled`),false);
  // 手动接管条默认隐藏（hidden 必须真实生效），诊断/手动按钮都在
  assert.equal(await js(`document.querySelector('#fs-manual').hidden`),true,'手动接管条默认隐藏');
  assert.equal(await js(`getComputedStyle(document.querySelector('#fs-manual')).display`),'none','隐藏时计算样式必须不显示');
  assert.equal(await js(`document.querySelector('#fs-start-manual').disabled`),false);
  assert.equal(await js(`document.querySelector('#fs-diagnose').disabled`),false);
  assert.equal(await js(`document.querySelector('#fs-shops').hidden`),true,'店铺胶囊默认折叠');
  assert.equal(await js(`getComputedStyle(document.querySelector('#fs-shops')).display`),'none','折叠时计算样式必须真实不显示（CSS 不能压过 hidden）');
  assert.ok(await js(`document.querySelector('#fs-shops-toggle').textContent.includes('共 ${fundShops.length} 家')`));
  await js(`document.querySelector('#fs-shops-toggle').click()`);
  await until(async()=>!await js(`document.querySelector('#fs-shops').hidden`));
  // 顺序对齐：资金页胶囊序列必须与推广费表格（滤掉京东/抖音）逐行一致
  const expectedIds=JSON.stringify(fundShops.map(s=>s.id));
  assert.deepEqual(await js(`[...document.querySelectorAll('#fs-shops [data-fund-select]')].map(e=>e.dataset.fundSelect)`),
   await js(`[...document.querySelectorAll('#pf-shops [data-select]')].map(e=>e.dataset.select).filter(id=>${expectedIds}.includes(id))`),'资金页店铺顺序应与推广费页一致');
  assert.ok(await js(`document.querySelector('#fs-shops .fs-tag')!==null`),'胶囊应带天猫/淘宝平台标签');
  await js(`document.querySelector('#fs-shops-none').click()`);
  await until(async()=>await js(`document.querySelector('#fs-shops-toggle').textContent.includes('已选 0')`));
  await js(`document.querySelector('#fs-shops-all').click()`);
  await until(async()=>await js(`document.querySelector('#fs-shops-toggle').textContent.includes('已选 ${fundShops.length}')`));
  await js(`document.querySelector('#fs-shops-toggle').click()`);
  await until(async()=>await js(`document.querySelector('#fs-shops').hidden`));
  assert.equal(await js(`getComputedStyle(document.querySelector('#fs-shops')).display`),'none','收起后计算样式必须为 none');
  report.checks.push('资金页店铺区默认折叠、可展开/收起、带平台标签且与推广费页列表逐行同序，全选/清空可用');
  await js(`document.querySelector('#finance-tabs [data-tab=promotion]').click()`);
  await until(async()=>await js(`document.querySelector('#fund-app').hidden`));
  assert.ok(await js(`!!document.querySelector('#pf-shops')`));
  report.checks.push('页签往返后推广费页状态保留');
  // v1.2.82：内置源码包导出（真实按钮 → 真实 IPC → 真实落盘）
  const snapshotFile=path.join(__dirname,'..','source-snapshot.zip');
  if(fs.existsSync(snapshotFile)){
   assert.equal(await js(`document.querySelector('#finance-source').textContent`),'导出源码包');
   assert.equal(await js(`document.querySelector('#finance-source').disabled`),false);
   const sourceTarget=path.join(root,'内置源码导出');
   dialog.showSaveDialog=async()=>({filePath:sourceTarget});
   await js(`document.querySelector('#finance-source').click()`);
   await until(()=>fs.existsSync(sourceTarget+'.zip'));
   const exportedHead=fs.readFileSync(sourceTarget+'.zip').subarray(0,4);
   assert.equal(exportedHead.toString('hex'),'504b0304','导出的必须是标准 zip');
   assert.equal(fs.statSync(sourceTarget+'.zip').size,fs.statSync(snapshotFile).size,'导出大小必须与内置快照一致');
   await until(()=>js(`document.querySelector('#finance-source').textContent.includes('已导出')`));
   report.checks.push('真实「导出源码包」按钮：自动补 .zip 后缀、落盘大小与内置快照一致、按钮回显已导出');
  }else{
   report.checks.push('未生成 source-snapshot.zip，本次跳过内置源码导出验收');
  }
  report.success=true;
 }catch(error){report.error=error.stack;throw error;}finally{fs.writeFileSync(path.join(out,'smoke-'+phase+'.json'),JSON.stringify(report,null,2));}
};
