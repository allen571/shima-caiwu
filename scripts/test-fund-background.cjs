'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {FundSummary}=require('../electron/fund-summary.cjs');
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fund-background-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let visible=false;
 const win={isDestroyed:()=>false,isVisible:()=>visible,show(){visible=true;},hide(){visible=false;},webContents:{isDestroyed:()=>false}};
 const host={window:()=>win,assertWindow:()=>win.webContents,authenticate:async()=>{},writeFailure:false};
 const fund=new FundSummary({host,root,downloads:root,autoDownload:false});
 fund.armWindowOpen=()=>{};fund.armNavTrace=()=>{};fund.armDownload=()=>{};
 return {fund,host,win,setVisible(v){visible=v;}};
}
test('成功认证后资金查询在隐藏窗口进入日汇总',async t=>{
 const {fund,win,setVisible}=setup(t);setVisible(true);
 fund.openRecordTab=async(w,tab)=>{assert.equal(w,win);assert.equal(tab,'日汇总');assert.equal(w.isVisible(),false);};
 fund.queryDaily=async()=>({incomeCents:1});
 assert.equal((await fund.queryOnce({id:'s',name:'synthetic'},'2026-11','2026-11-01')).incomeCents,1);
});
test('首页已显示财务菜单时不等待冷壳超时',async t=>{
 const {fund,win}=setup(t);let calls=0;
 fund.host.assertWindow=()=>({mainFrame:{framesInSubtree:[]}});
 fund.inspectAll=async()=>++calls===1?{url:'https://myseller.taobao.com/home.htm/QnworkbenchHome/',body:'首页 财务',loading:false,micro:{present:true,loaded:false},monthInputs:[]}:{url:'https://myseller.taobao.com/home.htm/whale-accountant/pay/capital/home',record:true,row:['1'],empty:false,monthInputs:[]};
 fund.enterViaDeposit=async()=>true;fund.clickText=async()=>true;
 fund.shellBootMs=60000;
 const started=Date.now();
 await fund.openRecordTab(win,'月汇总');
 assert.ok(Date.now()-started<10000);
});
