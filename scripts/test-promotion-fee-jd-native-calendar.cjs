'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');const {jdCalendar,jdDateInput,jdDismissNotice,JdPromotionFee}=require('../electron/promotion-fee-jd.cjs');
function calendar(hit=true,popup=null){let clicks=0;const em={getBoundingClientRect:()=>({x:10,y:20,width:20,height:20})};const cell={className:'jad-date-picker-cell',innerText:'1',getClientRects:()=>[{}],closest:selector=>selector==='.jad-dropdown-popper'?popup:null,querySelector:()=>em,contains:v=>v===em,click:()=>clicks++};const panel={getClientRects:()=>[{}],closest:()=>null,querySelectorAll:s=>s.includes('header-label')?[{innerText:'2026'},{innerText:'10'}]:[cell]};const context={document:{querySelectorAll:()=>[panel],elementFromPoint:()=>hit?em:{}},getComputedStyle:()=>({visibility:'visible'})};const value=vm.runInNewContext('('+jdCalendar.toString()+')("2026-10-01")',context);return {value,clicks};}
test('日期查找仅返回命中坐标，不执行DOM click',()=>{const {value,clicks}=calendar();assert.equal(value.action,'selected');assert.equal(value.x,20);assert.equal(value.y,30);assert.equal(clicks,0);});
test('动画遮挡日期文字时返回waiting，不误点',()=>{assert.equal(calendar(false).value,'waiting');});
test('原生日期坐标取得后暂停不派mouse事件',()=>{let events=0;const j=new JdPromotionFee({host:{assertWindow(){throw Error('查询已暂停');}}});assert.throws(()=>j.clickPoint({webContents:{sendInputEvent:()=>events++}},{x:20,y:30}),/暂停/);assert.equal(events,0);});
test('原生日期点击逐事件核停，down后暂停不派up',()=>{let events=[];const j=new JdPromotionFee({host:{assertWindow(win){if(events.length===2)throw Error('暂停');return win.webContents;}}});const win={webContents:{sendInputEvent:e=>events.push(e.type)}};assert.throws(()=>j.clickPoint(win,{x:20,y:30}),/暂停/);assert.deepEqual(events,['mouseMove','mouseDown']);});

test('弹层入退场及自身动画尚在移动时不输出可能过期的日期坐标',()=>{
 for(const className of ['jad-dropdown-popper jad-zoom-in-top-enter-active jad-zoom-in-top-enter-to','jad-dropdown-popper jad-zoom-in-top-enter','jad-dropdown-popper jad-zoom-in-top-leave-active'])assert.equal(calendar(true,{className}).value,'waiting');
 for(const animation of [{playState:'running'},{playState:'paused',pending:true}])assert.equal(calendar(true,{className:'jad-dropdown-popper',getAnimations:()=>[animation]}).value,'waiting');
 assert.equal(calendar(true,{className:'jad-dropdown-popper',getAnimations:()=>[{playState:'finished',pending:false}]}).value.action,'selected');
});
test('仅核对所属弹层动画，页面其他持续动画不阻止稳定日期',()=>{
 assert.equal(calendar(true,{className:'jad-dropdown-popper',getAnimations:()=>[]}).value.action,'selected');
});

test('日期输入未就绪和遮挡只返回等待及真实短原因，不抛页面泛化异常',()=>{
 const input={closest:()=>null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:10,y:20,width:20,height:20})};
 let nodes=[],hit;const context={document:{querySelectorAll:()=>nodes,elementFromPoint:()=>hit},getComputedStyle:()=>({visibility:'visible'})};
 const read=()=>vm.runInNewContext('('+jdDateInput.toString()+')()',context);
 assert.equal(read().action,'waiting');nodes=[input];hit={innerText:'账户管家跨PIN模式无权限操作此业务，请用该账户的账号密码登录使用。'};
 const blocked=read();assert.equal(blocked.action,'waiting');assert.match(blocked.reason,/跨PIN/);assert.equal(blocked.x,undefined);
 hit=input;const ready=read();assert.equal(ready.action,'ready');assert.equal(ready.x,20);assert.equal(ready.y,30);
 hit={innerText:'长'.repeat(500)};assert.equal(read().reason,'日期筛选被遮挡，未点击');
});

function dismissContext(blocker,closes){
 const input={getClientRects:()=>[{}],getBoundingClientRect:()=>({x:10,y:20,width:20,height:20}),contains:()=>false,closest:()=>null};
 let removed=false;
 blocker=Object.assign({getBoundingClientRect:()=>({x:10,y:20,width:100,height:20}),querySelectorAll:()=>closes||[],remove:()=>{removed=true;},parentElement:{}},blocker);
 const context={document:{querySelectorAll:()=>[input],elementFromPoint:()=>blocker},getComputedStyle:()=>({visibility:'visible'})};
 const result=vm.runInNewContext('('+jdDismissNotice.toString()+')()',context);
 return {result,removed};
}
const noticeBase={innerText:'京小通有新消息',className:'im-bubble',closest:()=>null,getAttribute:()=>null};
test('京小通气泡遮挡日期框：无关闭钮时移除节点',()=>{
 const {result,removed}=dismissContext(noticeBase);assert.equal(result,'removed');assert.equal(removed,true);
});
test('京小通气泡有可见关闭钮时优先点关闭，不移除节点',()=>{
 const close={getClientRects:()=>[{}],closest:()=>null,click:()=>{}};
 const {result,removed}=dismissContext(noticeBase,[close]);assert.equal(result,'closed');assert.equal(removed,false);
});
test('非通知类遮挡不触碰，交回原有重试逻辑',()=>{
 const {result,removed}=dismissContext({innerText:'账户管家跨PIN模式无权限',className:'',closest:()=>null,getAttribute:()=>null});
 assert.equal(result,null);assert.equal(removed,false);
});
test('setDates 等待循环遇被遮挡会执行关气泡再轮询',async()=>{
 let dismisses=0,ready=false,reads=0;const host={assertWindow:()=>({}),execute:async(w,code)=>code.includes('function jdDateInput')?(ready?{action:'ready',x:10,y:10}:{action:'waiting',reason:'日期筛选被遮挡，未点击：京小通有新消息'}):code.includes('function jdDismissNotice')?(dismisses++,ready=true,null):{action:'selected',x:20,y:20}};
 const jd=new JdPromotionFee({host});jd.closeCalendar=async()=>{};
 jd.dateState=async()=>{reads++;return reads>6?{open:false,headers:'10',selection:'x',value:'2026-10-01 ~ 2026-10-01',cells:'z'}:{open:true,headers:'10',selection:'same',value:'',cells:reads%2?'a':'b'};};
 jd.stableClick=async(w,locate)=>locate();
 await jd.setDates({}, {start:'2026-10-01',end:'2026-10-01'});
 assert.ok(dismisses>=1,'关气泡应被调用');
});

test('日期更新等待期间暂停立即退出，不重试点击',async()=>{
 let stopped=false,reads=0;const jd=new JdPromotionFee({host:{assertWindow(){if(stopped)throw Error('查询已暂停');}}});jd.dateState=async()=>{reads++;stopped=true;return {open:true};};
 await assert.rejects(jd.waitDate({},()=>false),/暂停/);assert.equal(reads,1);
});
test('永久不接受日期点击只允许两次整组尝试，不循环派发',async()=>{
 let clicks=0,closed=0;const host={assertWindow:()=>({}),execute:async(w,code)=>code.includes('function jdDateInput')?{action:'ready',x:10,y:10}:{action:'selected',x:20,y:20}};
 const jd=new JdPromotionFee({host});jd.closeCalendar=async()=>closed++;jd.dateState=async()=>({open:true,headers:'10',selection:'old',value:'old'});jd.stableClick=async(w,locate)=>{clicks++;return locate();};
 jd.waitDate=async(w,test)=>test({open:true,headers:'10',selection:'old',value:'old'})?{open:true}:null;
 await assert.rejects(jd.setDates({}, {start:'2026-10-01',end:'2026-10-23'}),/控件未确认/);assert.equal(closed,2);assert.equal(clicks,4);
});

test('重置关闭失败保留首次日期点击未确认原因，取消不包装成普通关闭失败',async()=>{
 let closes=0;const host={assertWindow:()=>({}),execute:async(w,code)=>code.includes('function jdDateInput')?{action:'ready',x:10,y:10}:{action:'selected',x:20,y:20}};
 const jd=new JdPromotionFee({host});jd.closeCalendar=async()=>{if(++closes===2)throw Error('日期面板未关闭');};jd.dateState=async()=>({open:true,headers:'10',selection:'old',value:'old'});jd.stableClick=async(w,locate)=>locate();
 jd.waitDate=async(w,test)=>test({open:true,headers:'10',selection:'old',value:'old'})?{open:true}:null;
 await assert.rejects(jd.setDates({}, {start:'2026-10-01',end:'2026-10-23'}),/日期点击后控件未确认.*日期面板未关闭/);
 let cancelled=false;host.assertWindow=()=>{if(cancelled)throw Error('查询已暂停');return {};};jd.closeCalendar=async()=>{cancelled=true;throw Error('日期面板未关闭');};
 await assert.rejects(jd.setDates({}, {start:'2026-10-01',end:'2026-10-23'}),/^Error: 查询已暂停$/);
});
test('选中类名未知时，单元格签名变化也接受为已选中并继续两个端点',async()=>{
 let clicks=0,closed=0,reads=0;const host={assertWindow:()=>({}),execute:async(w,code)=>code.includes('function jdDateInput')?{action:'ready',x:10,y:10}:{action:'selected',x:20,y:20}};
 const jd=new JdPromotionFee({host});jd.closeCalendar=async()=>closed++;
 jd.dateState=async()=>{reads++;return reads>6?{open:false,headers:'10',selection:'x',value:'2026-10-01 ~ 2026-10-23',cells:'z'}:{open:true,headers:'10',selection:'same',value:'',cells:reads%2?'a':'b'};};
 jd.stableClick=async(w,locate)=>{clicks++;return locate();};
 await jd.setDates({}, {start:'2026-10-01',end:'2026-10-23'});
 assert.equal(clicks,3);assert.equal(closed,1);
});
test('日期点击未确认时报出点后控件状态诊断，便于定位新版控件结构',async()=>{
 const host={assertWindow:()=>({}),execute:async(w,code)=>code.includes('function jdDateInput')?{action:'ready',x:10,y:10}:{action:'selected',x:20,y:20}};
 const jd=new JdPromotionFee({host});jd.closeCalendar=async()=>{};
 jd.dateState=async()=>({open:true,headers:'2026-10',selection:'range-hover',value:'',cells:'1:jad-date-picker-cell'});
 jd.stableClick=async(w,locate)=>locate();
 jd.waitDate=async(w,test)=>test({open:true,headers:'2026-10',selection:'range-hover',value:'',cells:'1:jad-date-picker-cell'})?{open:true}:null;
 await assert.rejects(jd.setDates({}, {start:'2026-10-01',end:'2026-10-23'}),/京东日期点击后控件未确认：2026-10-01（点后面板仍开启，输入值「空」，选中标记\[range-hover\]，单元格\[1:jad-date-picker-cell\]）.*未读取金额，请补查/);
});
test('账单忽略透明旧日期控件，但拒绝两个真实可见控件',()=>{
 const {jdLedger}=require('../electron/promotion-fee-jd.cjs');
 const node=opacity=>({opacity,getClientRects:()=>[{}],closest:()=>null,value:'2026-10-01 ~ 2026-10-23'});
 const current=node('1'),old=node('0');let inputs=[old,current];
 const button={...node('1'),innerText:'现金',classList:{contains:()=>true}};
 const context={document:{body:{innerText:'账户ID：123 推广费消费金额 12.34'},querySelectorAll:s=>s.startsWith('input')?inputs:s==='button'?[button]:[]},getComputedStyle:e=>({visibility:'visible',display:'block',opacity:e.opacity})};
 const read=()=>vm.runInNewContext('('+jdLedger.toString()+')()',context);
 assert.equal(read().amountCents,1234);inputs=[current,node('1')];assert.throws(read,/控件未唯一确认/);
});
test('日历忽略透明旧面板，但拒绝两个真实可见左面板',()=>{
 const em={getBoundingClientRect:()=>({x:0,y:0,width:20,height:20})};
 const cell={getClientRects:()=>[{}],closest:()=>null,className:'jad-date-picker-cell',innerText:'1',querySelector:()=>em,contains:e=>e===em};
 const panel=opacity=>({opacity,getClientRects:()=>[{}],closest:()=>null,classList:{contains:s=>s==='jad-date-picker-content-left'},querySelectorAll:s=>s.includes('header-label')?[{innerText:'2026'},{innerText:'10'}]:[cell]});
 let panels=[panel('0'),panel('1')];const context={document:{querySelectorAll:()=>panels,elementFromPoint:()=>em},getComputedStyle:e=>({visibility:'visible',display:'block',opacity:e.opacity||'1'})};
 const read=()=>vm.runInNewContext('('+jdCalendar.toString()+')("2026-10-01")',context);
 assert.equal(read().action,'selected');panels=[panel('1'),panel('1')];assert.throws(read,/面板不唯一/);
});
