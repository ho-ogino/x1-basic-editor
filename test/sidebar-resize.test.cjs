'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
function setup(){
  const dom=new JSDOM('<main><section></section><div id="sidebar-resizer"></div><aside id="sidebar"></aside></main>',{runScripts:'outside-only'});
  const w=dom.window,sidebar=w.document.getElementById('sidebar'),handle=w.document.getElementById('sidebar-resizer');
  let mainWidth=1000,defaultWidth=268,layoutCalls=0,captured=null,observer;
  const rect=width=>({width,left:0,right:width,top:0,bottom:600,height:600});
  sidebar.parentElement.getBoundingClientRect=()=>rect(mainWidth);
  handle.getBoundingClientRect=()=>rect(6);
  sidebar.getBoundingClientRect=()=>rect(Number.parseFloat(sidebar.style.getPropertyValue('--sidebar-width'))||defaultWidth);
  handle.setPointerCapture=id=>{captured=id;};handle.hasPointerCapture=id=>captured===id;
  handle.releasePointerCapture=()=>{captured=null;};
  w.ResizeObserver=class{constructor(callback){observer=callback;}observe(){}};
  w.eval(fs.readFileSync(path.join(__dirname,'../src/sidebar-resize.js'),'utf8'));
  const control=w.X1SidebarResize(()=>layoutCalls++);
  function pointer(type,x=500,extra={}){
    const event=new w.Event(type,{cancelable:true});Object.assign(event,{pointerId:1,button:0,isPrimary:true,clientX:x,...extra});handle.dispatchEvent(event);
  }
  function key(key){handle.dispatchEvent(new w.KeyboardEvent('keydown',{key,cancelable:true}));}
  return {dom,w,sidebar,handle,pointer,key,control,resize:width=>{mainWidth=width;observer();},default:width=>{defaultWidth=width;control.refresh();},get captured(){return captured;},get calls(){return layoutCalls;}};
}
test('sidebar drag widens to the left, clamps, retains capture and releases on every exit',()=>{
  const ui=setup();try{
    const width=()=>ui.sidebar.style.getPropertyValue('--sidebar-width');
    for(const extra of [{button:2},{isPrimary:false}]){ui.pointer('pointerdown',500,extra);assert.equal(ui.captured,null);}
    ui.pointer('pointerdown');assert.equal(ui.captured,1);assert.equal(ui.w.document.body.classList.contains('resizing-sidebar'),true);
    ui.pointer('pointermove',400,{pointerId:2});assert.equal(width(),'');
    ui.pointer('pointermove',400);assert.equal(width(),'368px');assert.equal(ui.handle.getAttribute('aria-valuenow'),'368');
    ui.pointer('pointermove',-9999);assert.equal(width(),'834px');
    ui.pointer('pointermove',9999);assert.equal(width(),'220px');
    ui.pointer('pointerup',500,{pointerId:2});assert.equal(ui.captured,1);
    ui.pointer('pointerup');assert.equal(ui.captured,null);assert.equal(ui.w.document.body.classList.contains('resizing-sidebar'),false);
    ui.pointer('pointermove',0);assert.equal(width(),'220px');
    for(const exit of ['pointercancel','lostpointercapture']){
      ui.pointer('pointerdown');ui.pointer(exit);assert.equal(ui.captured,null);assert.equal(ui.w.document.body.classList.contains('resizing-sidebar'),false);
    }
    ui.pointer('pointerdown');ui.w.dispatchEvent(new ui.w.Event('blur'));assert.equal(ui.captured,null);
    assert.ok(ui.calls>1,'drag recalculates editor layout');
  }finally{ui.dom.window.close();}
});
test('sidebar keys and Home preserve tab defaults, manual width and container bounds',()=>{
  const ui=setup();try{
    const width=()=>ui.sidebar.style.getPropertyValue('--sidebar-width');
    assert.equal(width(),'');assert.equal(ui.handle.getAttribute('aria-valuenow'),'268');
    ui.default(340);assert.equal(width(),'');assert.equal(ui.handle.getAttribute('aria-valuenow'),'340');
    ui.key('ArrowLeft');assert.equal(width(),'350px');ui.default(268);assert.equal(width(),'350px');
    ui.key('ArrowRight');assert.equal(width(),'340px');
    ui.resize(400);assert.equal(width(),'234px');assert.equal(ui.handle.getAttribute('aria-valuemax'),'234');
    ui.resize(300);assert.equal(width(),'134px');assert.equal(ui.handle.getAttribute('aria-valuemin'),'134');
    ui.resize(1000);assert.equal(width(),'340px','restores the preferred width after temporary clamping');
    ui.key('Home');assert.equal(width(),'');assert.equal(ui.handle.getAttribute('aria-valuenow'),'268');
    ui.default(235);assert.equal(ui.handle.getAttribute('aria-valuenow'),'235');
    ui.key('ArrowRight');assert.equal(width(),'225px');
  }finally{ui.dom.window.close();}
});
