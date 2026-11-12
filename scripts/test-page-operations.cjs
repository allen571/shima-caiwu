'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {clickStable,pressPoint}=require('../electron/page-operations.cjs');
function fixture(){const events=[];let x=10,stopped=false;const wc={sendInputEvent(e){events.push(e);if(e.type==='mouseMove')x=80;}};const host={assertWindow(){if(stopped)throw Error('查询已暂停');return wc;}};return {events,host,win:{},locate:async()=>({x,y:20,action:'ready'}),stop:()=>stopped=true};}
test('旧点击可复现悬停后仍按旧坐标，新操作悬停后重新定位再按下',async()=>{
 const old=fixture();pressPoint(old.host,old.win,await old.locate());assert.equal(old.events.find(e=>e.type==='mouseDown').x,10);
 const f=fixture();await clickStable(f.host,f.win,f.locate,{action:'ready'});assert.equal(f.events.find(e=>e.type==='mouseDown').x,80);assert.equal(f.events.filter(e=>e.type==='mouseDown').length,1);
});
test('定位不确定只等待，不派发按下；取消发生在悬停等待时停止',async()=>{
 const f=fixture();await assert.rejects(clickStable(f.host,f.win,async()=>({reason:'遮挡'}),{timeout:150}),/未稳定/);assert.equal(f.events.length,0);
 const work=clickStable(f.host,f.win,f.locate);const timer=setTimeout(f.stop,60);try{await assert.rejects(work,/暂停/);}finally{clearTimeout(timer);}assert(!f.events.some(e=>e.type==='mouseDown'));
});
