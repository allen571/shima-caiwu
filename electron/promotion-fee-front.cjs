'use strict';
// Activate the app as well as the window; show() alone can leave it behind another app.
function bringToFront(win,app=require('electron').app){
 if(!win||win.isDestroyed())return false;
 if(win.isMinimized?.())win.restore();
 win.setAlwaysOnTop(true,'floating');
 app?.focus({steal:true});
 win.show();win.moveTop?.();win.focus();
 const timer=setTimeout(()=>{if(!win.isDestroyed())win.setAlwaysOnTop(false);},1200);timer.unref?.();
 return true;
}
module.exports={bringToFront};
