'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),preview=require('../src/pcg-preview.js'),syntax=require('../src/syntax.js');
const example=Uint8Array.from([128,129,130,31,29,29,29,131,132,133]);
const blue='FF'.repeat(8)+'00'.repeat(16);
const rect=(left,top,right,bottom)=>({left,top,right,bottom,width:right-left,height:bottom-top});
test('three PCGs, down, three lefts, three PCGs compose exactly 24x16 without changing bytes',()=>{
  const before=example.slice(),image=preview.compose(example);
  assert.equal(image.width,24);assert.equal(image.height,16);assert.equal(image.truncated,false);
  assert.deepEqual(image.cells,[
    {x:0,y:0,code:128},{x:1,y:0,code:129},{x:2,y:0,code:130},
    {x:0,y:1,code:131},{x:1,y:1,code:132},{x:2,y:1,code:133}
  ]);
  assert.deepEqual(example,before);
});
test('negative positions rebase, only written cells define bounds, and later blank cells overwrite',()=>{
  assert.deepEqual(preview.compose([29,30,65,31,29,66]).cells,[{x:0,y:0,code:65},{x:0,y:1,code:66}]);
  const moved=preview.compose([65,28,28,31,31,30,29]);assert.equal(moved.width,8);assert.equal(moved.height,8);
  assert.deepEqual(preview.compose([128,29,32]).cells,[{x:0,y:0,code:32}]);
  assert.deepEqual(preview.compose([65,28,66]).cells,[{x:0,y:0,code:65},{x:2,y:0,code:66}]);
  const controls=preview.compose([7,65,27,51,7]);assert.deepEqual(controls.ignored,[7,27]);assert.equal(controls.width,16);
  for(const bytes of [[],[0,7,27],[28,29,30,31]]){const image=preview.compose(bytes);assert.equal(image.width,0);assert.equal(image.height,0);}
});
test('input and extent limits stop at a bounded prefix with an explicit truncation flag',()=>{
  const exact=preview.compose([65,...Array(62).fill(28),...Array(63).fill(31),66]);
  assert.equal(exact.width,512);assert.equal(exact.height,512);assert.equal(exact.truncated,false);
  const wide=preview.compose(Array(65).fill(65));assert.equal(wide.width,512);assert.equal(wide.cells.length,64);assert.equal(wide.truncated,true);
  const high=preview.compose(Array.from({length:65},()=>[65,29,31]).flat());assert.equal(high.height,512);assert.equal(high.cells.length,64);assert.equal(high.truncated,true);
  const repeated=Array.from({length:2048},()=>[65,29]).flat();
  assert.equal(preview.compose(repeated).truncated,false);assert.equal(preview.compose([...repeated,66]).truncated,true);
  const huge=preview.compose(new Uint8Array(2*1024*1024).fill(29));assert.equal(huge.width,0);assert.equal(huge.truncated,true);
});
test('quote ranges separate merged literals, exclude unterminated tails and never target comment tokens',()=>{
  assert.deepEqual(preview.quoteRanges('"A""B":C$=""'),[{start:0,end:3},{start:3,end:6},{start:10,end:12}]);
  assert.deepEqual(preview.quoteRanges('"A" + "unterminated'),[{start:0,end:3}]);
  const line='10 B$="A":C$="B":REM "not a target"';
  const ranges=syntax.highlightLine(line).filter(token=>token.kind==='string').flatMap(token=>preview.quoteRanges(token.text).map(range=>token.text.slice(range.start+1,range.end-1)));
  assert.deepEqual(ranges,['A','B']);
});
test('hit testing reaches late literals in logarithmic measurements and handles wrapped/scroll fragments',()=>{
  let measurements=0;
  const literals=Array.from({length:2048},(_,index)=>({element:{getClientRects(){measurements++;return [rect(index*12,10,index*12+8,26)];}},byteStart:index,byteEnd:index+1}));
  const lines=[{element:{getBoundingClientRect:()=>rect(0,0,30000,40)},literals}];
  assert.equal(preview.hitTest(lines,rect(0,0,30000,100),{x:2047*12+2,y:20}),literals[2047]);assert.ok(measurements<20);
  const wrapped={element:{getClientRects:()=>[rect(-20,-10,80,6),rect(0,10,40,26)]}};
  const other=[{element:{getBoundingClientRect:()=>rect(-20,-20,100,30)},literals:[wrapped]}];
  assert.equal(preview.hitTest(other,rect(0,0,100,50),{x:10,y:20}),wrapped);
  assert.equal(preview.hitTest(other,rect(0,0,100,50),{x:60,y:20}),null);
  assert.equal(preview.hitTest(other,rect(0,0,100,50),{x:-1,y:20}),null);
});
function setup(options={}){
  const dom=new JSDOM('<textarea id="editor">unchanged</textarea><div id="panel" hidden><canvas></canvas><div id="size"></div><div id="warning"></div></div>',{runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,editor=w.document.getElementById('editor'),panel=w.document.getElementById('panel'),canvas=panel.querySelector('canvas');
  const style=w.document.createElement('style');style.textContent=fs.readFileSync(path.join(__dirname,'../src/style.css'),'utf8');w.document.head.append(style);
  const calls=[],ctx={fillRect(...args){calls.push({args,color:this.fillStyle});},fillText(){throw Error('Font rasterization forbidden');}};
  canvas.getContext=()=>options.noContext?null:ctx;
  const boxes=[rect(10,10,90,30),rect(100,10,180,30)];
  const length=options.bytes?.length||example.length;
  const literals=boxes.map((box,index)=>({element:{getClientRects:()=>[box]},byteStart:index*length,byteEnd:(index+1)*length}));
  const lines=[{element:{getBoundingClientRect:()=>rect(0,0,200,40)},literals}];
  editor.getBoundingClientRect=()=>rect(0,0,200,100);panel.getBoundingClientRect=()=>rect(0,0,200,100);
  Object.defineProperty(w.document,'fonts',{value:{load(){throw Error('Font loading forbidden in bitmap preview');},get ready(){throw Error('Font waiting forbidden');}}});
  let enabled=true,time=0,next=0;const timers=new Map();
  w.setTimeout=(callback,delay)=>{const id=++next;timers.set(id,{callback,due:time+delay});return id;};
  w.clearTimeout=id=>timers.delete(id);
  const state={entries:new Map(Array.from({length:6},(_,i)=>[128+i,blue])),order:'BRG',layout:'planar',bitmap:require('../assets/x1-font.json')};
  const bytes=options.bytes?Uint8Array.from(options.bytes):new Uint8Array(example.length*2);if(!options.bytes){bytes.set(example);bytes.set(example,example.length);}
  const control=preview.attach({editor,panel,canvas,summary:w.document.getElementById('size'),warning:w.document.getElementById('warning'),
    isEnabled:()=>enabled,getLines:()=>lines,getBytes:()=>bytes,getState:()=>state});
  const move=(x=20,y=20)=>editor.dispatchEvent(new w.MouseEvent('mousemove',{clientX:x,clientY:y}));
  async function tick(ms){time+=ms;for(const [id,timer] of [...timers])if(timer.due<=time){timers.delete(id);timer.callback();}await new Promise(resolve=>setImmediate(resolve));}
  return {dom,w,editor,panel,canvas,calls,state,control,move,tick,setEnabled:value=>{enabled=value;},get timers(){return timers.size;},close(){control.destroy();dom.window.close();}};
}
test('hover waits 600ms, keeps the same target stable, restarts for another literal and is read-only',async()=>{
  const ui=setup();try{
    ui.editor.setSelectionRange(1,3);ui.move();await ui.tick(599);assert.equal(ui.panel.hidden,true);
    await ui.tick(1);assert.equal(ui.panel.hidden,false);assert.equal(ui.canvas.width,24);assert.equal(ui.canvas.height,16);
    assert.equal(ui.editor.getAttribute('aria-describedby'),'panel');assert.equal(ui.editor.value,'unchanged');assert.equal(ui.editor.selectionStart,1);assert.equal(ui.editor.selectionEnd,3);
    const paints=ui.calls.length;ui.move(21,20);assert.equal(ui.panel.hidden,false);assert.equal(ui.timers,0);assert.equal(ui.calls.length,paints);
    ui.move(110,20);assert.equal(ui.panel.hidden,true);await ui.tick(600);assert.equal(ui.panel.hidden,false);
    ui.editor.dispatchEvent(new ui.w.Event('mouseleave'));assert.equal(ui.panel.hidden,true);assert.equal(ui.editor.hasAttribute('aria-describedby'),false);
  }finally{ui.close();}
});
test('every interaction invalidates pending and visible bitmap previews without waiting for fonts',async()=>{
  for(const event of ['mouseleave','mousedown','scroll','input','compositionstart','blur']){
    const ui=setup();try{
      ui.move();ui.editor.dispatchEvent(new ui.w.Event(event));await ui.tick(600);assert.equal(ui.panel.hidden,true,event);
      ui.move();await ui.tick(600);assert.equal(ui.panel.hidden,false);ui.editor.dispatchEvent(new ui.w.Event(event));assert.equal(ui.panel.hidden,true,event);
    }finally{ui.close();}
  }
  for(const [target,event] of [['document','keydown'],['document','pointerdown'],['document','visibilitychange'],['window','resize'],['window','blur']]){
    const ui=setup();try{ui.move();await ui.tick(600);assert.equal(ui.panel.hidden,false);(target==='document'?ui.w.document:ui.w).dispatchEvent(new ui.w.Event(event));assert.equal(ui.panel.hidden,true,event);}finally{ui.close();}
  }
});
test('disabled interaction, canvas failure and unavailable ordinary bitmap do not disrupt editing',async()=>{
  for(const mode of ['disabled','no-context','bitmap-missing']){
    const ui=setup({bytes:[65],noContext:mode==='no-context'});
    try{
      if(mode==='disabled')ui.setEnabled(false);
      if(mode==='bitmap-missing')ui.state.bitmap=null;
      ui.move();await ui.tick(600);assert.equal(ui.panel.hidden,true);assert.equal(ui.editor.value,'unchanged');
    }finally{ui.close();}
  }
});
test('ordinary strings without PCG definitions use the same layout with white base-font glyphs',async()=>{
  const ui=setup({bytes:[65,66,67,31,29,29,29,68,69,70]});try{
    ui.state.entries.clear();ui.move();await ui.tick(600);
    assert.equal(ui.panel.hidden,false);assert.equal(ui.canvas.width,24);assert.equal(ui.canvas.height,16);
    const expected=[];
    for(const cell of preview.compose([65,66,67,31,29,29,29,68,69,70]).cells){
      ui.state.bitmap[cell.code].forEach((bits,y)=>{for(let x=0;x<8;x++)if(bits&(128>>x))expected.push([cell.x*8+x,cell.y*8+y,1,1]);});
    }
    assert.deepEqual(ui.calls.filter(call=>call.color==='#FFFFFF').map(call=>call.args),expected);
  }finally{ui.close();}
});
test('canvas painter delegates every color order and layout',async()=>{
  const bit={B:1,R:2,G:4};
  for(const order of ['BRG','BGR','RGB','RBG','GBR','GRB'])for(const layout of ['planar','interleaved']){
    const ui=setup();try{
      ui.state.order=order;ui.state.layout=layout;ui.move();await ui.tick(600);
      assert.equal(ui.panel.hidden,false);const first=ui.calls.find(call=>call.args?.[2]===1);
      assert.equal(first.color,require('../src/pcg.js').PALETTE[layout==='planar'?bit[order[0]]:7]);
    }finally{ui.close();}
  }
});
test('warnings describe ignored controls and truncation; ordinary glyphs use the supplied source bitmap',async()=>{
  for(const [bytes,expected] of [[[128,7,27],/\$07.*\$1B/],[[128,...Array(64).fill(65)],/上限/]]){
    const ui=setup({bytes});try{
      ui.move();await ui.tick(600);assert.equal(ui.panel.hidden,false);assert.match(ui.w.document.getElementById('warning').textContent,expected);
    }finally{ui.close();}
  }
  const ui=setup({bytes:[128,65]});try{
    ui.state.bitmap=Array.from({length:256},()=>Array(8).fill(0));ui.state.bitmap[65]=[128,0,0,0,0,0,0,1];
    ui.move();await ui.tick(600);assert.equal(ui.canvas.width,16);
    assert.deepEqual(ui.calls.filter(call=>call.color==='#FFFFFF').map(call=>call.args),[[8,0,1,1],[15,7,1,1]]);
  }finally{ui.close();}
});
test('normal bitmap blank/full cells and defined PCG precedence preserve exact integer dots',async()=>{
  const ui=setup({bytes:[65,66,128]});try{
    ui.state.bitmap=Array.from({length:256},()=>Array(8).fill(0));ui.state.bitmap[66].fill(255);ui.state.bitmap[128].fill(255);
    ui.move();await ui.tick(600);assert.equal(ui.panel.hidden,false);
    const white=ui.calls.filter(call=>call.color==='#FFFFFF');assert.equal(white.length,64);
    assert.ok(white.every(call=>call.args[0]>=8&&call.args[0]<16&&call.args.slice(2).join(',')==='1,1'));
    const blues=ui.calls.filter(call=>call.color==='#0000ff');assert.equal(blues.length,64);assert.ok(blues.every(call=>call.args[0]>=16));
  }finally{ui.close();}
  const pcg=setup();try{
    pcg.state.bitmap=null;pcg.move();await pcg.tick(600);assert.equal(pcg.panel.hidden,false,'PCG-only does not require a base font');
  }finally{pcg.close();}
});
