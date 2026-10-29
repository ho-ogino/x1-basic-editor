'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const base=path.join(__dirname,'..');
function setup(confirmation=0){
  const handlers=new Map(),listeners=new Map(),events=new Map(),sent=[],saves=[],titles=[],edited=[];
  let ready,resolveInitial,menu,windowRef,closed=false;const dialogs=[],windowEvents=new Map(),rendererEvents=new Map();
  const controls={confirmation,saveCanceled:false,openCanceled:false,failSave:false,saveName:'new.bas'};
  const initial=new Promise(resolve=>{resolveInitial=resolve;});
  const documentA={path:path.resolve('A.bas'),name:'A.bas',bytes:[65],hash:'a'};
  const documentB={path:path.resolve('B.bas'),name:'B.bas',bytes:[66],hash:'b'};
  const electron={
    app:{isPackaged:false,whenReady:()=>({then(fn){ready=fn;}}),on(){},quit(){},getPath:()=>base},
    BrowserWindow:class{
      constructor(){windowRef=this;this.webContents={once:(name,fn)=>events.set(name,fn),on(){},send:(name,...args)=>{
        sent.push([name,...args]);for(const callback of rendererEvents.get(name)||[])callback({},...args);
      },
        setWindowOpenHandler(){},session:{setPermissionRequestHandler(){},webRequest:{onBeforeRequest(){}}}};}
      once(){} on(name,fn){windowEvents.set(name,fn);} loadFile(){} setDocumentEdited(value){edited.push(value);} setTitle(value){titles.push(value);}
      close(){const event={prevented:false,preventDefault(){this.prevented=true;}};windowEvents.get('close')?.(event);if(!event.prevented)closed=true;}
    },
    Menu:{setApplicationMenu(value){menu=value;},buildFromTemplate:items=>items},
    dialog:{async showOpenDialog(){return {canceled:controls.openCanceled,filePaths:[documentB.path]};},
      async showSaveDialog(){return {canceled:controls.saveCanceled,filePath:path.resolve(controls.saveName)};},async showMessageBox(_win,options){dialogs.push(options);return {response:controls.confirmation};}},
    ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:(name,fn)=>listeners.set(name,fn)}
  };
  const store={MAX_BYTES:2*1024*1024,readDocument:file=>file===documentA.path?initial:Promise.resolve(documentB),
    async atomicSave(file,bytes){if(controls.failSave)throw Error('disk failure');saves.push({file,bytes});return 'saved';}};
  const requireMock=name=>name==='electron'?electron:name==='./src/file-store.cjs'?store:name==='./src/font-settings.cjs'?{FontSettings:class{async read(){return null;}}}:require(name.startsWith('./')?path.join(base,name):name);
  vm.runInNewContext(fs.readFileSync(path.join(base,'main.cjs'),'utf8'),{
    require:requireMock,__dirname:base,Buffer,console,process:{platform:'win32',argv:['electron','.',documentA.path]}
  });
  ready();
  return {sent,saves,titles,edited,menu,dialogs,documentA,documentB,controls,get closed(){return closed;},requestClose:()=>windowRef.close(),
    connect(w){
      const bridge={contextBridge:{exposeInMainWorld:(name,api)=>{w[name]=api;}},ipcRenderer:{
        invoke:(name,payload)=>handlers.get(name)({},payload),send:(name,payload)=>listeners.get(name)({},payload),
        on(name,callback){if(!rendererEvents.has(name))rendererEvents.set(name,[]);rendererEvents.get(name).push(callback);}
      }};
      vm.runInNewContext(fs.readFileSync(path.join(base,'preload.cjs'),'utf8'),{require:name=>{assert.equal(name,'electron');return bridge;}});
    },start:()=>events.get('did-finish-load')(),resolve:()=>resolveInitial(documentA),
    invoke:(name,payload)=>handlers.get(name)({},payload),send:(name,payload)=>listeners.get(name)({},payload)};
}
test('command-line document loads normally when no user action supersedes it',async()=>{
  const app=setup(),pending=app.start();app.send('state',{dirty:false});app.resolve();await pending;
  assert.equal(app.sent.length,1);assert.equal(app.sent[0][0],'loaded');assert.equal(app.sent[0][1].name,'A.bas');
  app.send('state',{dirty:false});app.send('state',{dirty:true});app.send('state',{dirty:false});
  assert.deepEqual(app.titles.slice(-3),['A.bas — X1 BASIC Editor','● A.bas — X1 BASIC Editor','A.bas — X1 BASIC Editor']);
  assert.deepEqual(app.edited.slice(-3),[false,true,false]);
});
test('late startup load cannot replace edits, even when Undo restores the clean state',async()=>{
  const app=setup(),pending=app.start();app.send('state',{dirty:true});app.send('state',{dirty:false});
  app.resolve();await pending;assert.equal(app.sent.length,0);
  await app.invoke('save',{bytes:[67]});assert.equal(app.saves[0].file,path.resolve('new.bas'));
});
test('late startup load cannot roll an opened document or its save target back to the startup file',async()=>{
  const app=setup(),pending=app.start(),opened=await app.invoke('open');assert.equal(opened.name,'B.bas');
  app.send('state',{dirty:true});app.resolve();await pending;assert.equal(app.sent.length,0);
  await app.invoke('save',{bytes:[66,67]});assert.equal(app.saves[0].file,app.documentB.path);
});
test('new document and Save As supersede a pending startup load',async()=>{
  for(const action of ['new-document','save']){
    const app=setup(),pending=app.start();
    if(action==='new-document')app.send(action);else await app.invoke('save',{bytes:[67],saveAs:true});
    app.resolve();await pending;assert.equal(app.sent.length,0);
  }
});

test('native Open/Save menu keeps existing commands and accelerators',()=>{
  const app=setup(),file=app.menu.find(item=>item.label==='ファイル');
  const imports=file.submenu.find(item=>item.label==='開く…'),exports=file.submenu.find(item=>item.label==='保存');
  assert.equal(imports.accelerator,'CmdOrCtrl+O');assert.equal(exports.accelerator,'CmdOrCtrl+S');
  imports.click();exports.click();assert.deepEqual(app.sent,[['command','open'],['command','save']]);
  assert.ok(file.submenu.some(item=>item.label==='新規'));assert.ok(file.submenu.some(item=>item.label==='名前を付けて保存…'));
});
test('dirty confirmation uses Save wording and preserves save/discard/cancel responses',async()=>{
  for(const [response,expected] of ['save','discard','cancel'].entries()){
    const app=setup(response);assert.equal(await app.invoke('confirm-dirty'),expected);
    assert.equal(app.dialogs[0].message,'変更を保存しますか？');
    assert.deepEqual(Array.from(app.dialogs[0].buttons),['保存','保存しない','キャンセル']);
  }
});

async function desktopRenderer(app){
  const html=fs.readFileSync(path.join(base,'src/index.html'),'utf8'),dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  const style=w.document.createElement('style');style.textContent=fs.readFileSync(path.join(base,'src/style.css'),'utf8');w.document.head.append(style);
  w.FontFace=class{constructor(family){this.family=family;}async load(){return this;}};
  Object.defineProperty(w.document,'fonts',{value:{ready:Promise.resolve(),add(){},delete(){}}});
  app.connect(w);
  for(const [,script] of html.matchAll(/<script src="([^"]+)"/g))w.eval(fs.readFileSync(path.join(base,'src',script),'utf8'));
  const pending=app.start();app.resolve();await pending;
  const settle=()=>new Promise(resolve=>setImmediate(resolve));await settle();
  const $=id=>w.document.getElementById(id),editor=$('editor');
  return {dom,w,$,editor,settle,
    type(text){editor.dispatchEvent(new w.InputEvent('beforeinput',{inputType:'insertText'}));editor.setRangeText(text,editor.selectionStart,editor.selectionEnd,'end');editor.dispatchEvent(new w.InputEvent('input'));},
    async action(label){const item=app.menu.flatMap(menu=>menu.submenu||[]).find(item=>item.label===label);assert.ok(item,'native menu '+label);item.click();await settle();},
    state(name,dirty){
      assert.equal($('document-bar').hidden,false);assert.notEqual(w.getComputedStyle($('document-bar')).display,'none');
      assert.equal($('filename').textContent,name);assert.equal($('filename').title,name);
      assert.equal($('dirty-state').textContent,dirty?'未保存の変更':'保存済み');assert.equal($('dirty-state').classList.contains('dirty'),dirty);
      assert.equal(app.titles.at(-1),(dirty?'● ':'')+name+' — X1 BASIC Editor');assert.equal(app.edited.at(-1),dirty);
    }};
}
test('real preload IPC connects desktop filename and dirty state across edit, Undo, Save As, open and new',async()=>{
  const app=setup(),ui=await desktopRenderer(app);try{
    ui.state('A.bas',false);ui.editor.setSelectionRange(1,1);ui.type('B');ui.state('A.bas',true);
    await ui.action('元に戻す');ui.state('A.bas',false);await ui.action('やり直す');ui.state('A.bas',true);
    await ui.action('保存');ui.state('A.bas',false);assert.deepEqual(Array.from(app.saves[0].bytes),[65,66]);assert.equal(app.saves[0].file,app.documentA.path);
    await ui.action('元に戻す');ui.state('A.bas',true);await ui.action('やり直す');ui.state('A.bas',false);
    app.controls.saveName='Renamed & 日本語.bas';await ui.action('名前を付けて保存…');ui.state('Renamed & 日本語.bas',false);
    ui.type('C');await ui.action('保存');assert.equal(app.saves.at(-1).file,path.resolve('Renamed & 日本語.bas'));ui.state('Renamed & 日本語.bas',false);
    await ui.action('開く…');ui.state('B.bas',false);assert.equal(ui.editor.value,'B');
    await ui.action('新規');ui.state('Untitled.bas',false);assert.equal(ui.editor.value,'');assert.equal(app.saves.length,3);
  }finally{ui.dom.window.close();}
});
test('real desktop bridge preserves dirty bytes and name when Save As fails or is cancelled and open is cancelled',async()=>{
  for(const failure of ['cancel','disk']){
    const app=setup(),ui=await desktopRenderer(app);try{
      ui.editor.setSelectionRange(1,1);ui.type('B');ui.state('A.bas',true);
      app.controls.saveCanceled=failure==='cancel';app.controls.failSave=failure==='disk';
      await ui.action('名前を付けて保存…');ui.state('A.bas',true);assert.equal(ui.editor.value,'AB');assert.equal(app.saves.length,0);
      if(failure==='disk')assert.ok(app.dialogs.some(dialog=>dialog.detail==='disk failure'));
      app.controls.confirmation=1;app.controls.openCanceled=true;await ui.action('開く…');ui.state('A.bas',true);assert.equal(ui.editor.value,'AB');
      app.controls.confirmation=2;app.requestClose();await ui.settle();assert.equal(app.closed,false);ui.state('A.bas',true);
    }finally{ui.dom.window.close();}
  }
});
test('native close traverses real preload and renderer Save Discard Cancel protections',async()=>{
  for(const response of [0,1,2]){
    const app=setup(response),ui=await desktopRenderer(app);try{
      ui.editor.setSelectionRange(1,1);ui.type('B');ui.state('A.bas',true);
      app.requestClose();await ui.settle();assert.equal(app.closed,response!==2);
      assert.equal(app.dialogs[0].message,'変更を保存しますか？');assert.equal(app.saves.length,response===0?1:0);
      if(response===0){ui.state('A.bas',false);assert.deepEqual(Array.from(app.saves[0].bytes),[65,66]);}else ui.state('A.bas',true);
    }finally{ui.dom.window.close();}
  }
  const app=setup(),ui=await desktopRenderer(app);try{app.requestClose();await ui.settle();assert.equal(app.closed,true);assert.equal(app.dialogs.length,0);}finally{ui.dom.window.close();}
});
test('cancelled or failed save on close keeps the actual desktop document open and dirty',async()=>{
  for(const failure of ['cancel','disk']){
    const app=setup(),ui=await desktopRenderer(app);try{
      await ui.action('新規');ui.type('A');ui.state('Untitled.bas',true);
      app.controls.saveCanceled=failure==='cancel';app.controls.failSave=failure==='disk';
      app.requestClose();await ui.settle();assert.equal(app.closed,false);ui.state('Untitled.bas',true);assert.equal(ui.editor.value,'A');assert.equal(app.saves.length,0);
    }finally{ui.dom.window.close();}
  }
});
test('native New and Open preserve dirty documents on Cancel and proceed only after Save or Discard',async()=>{
  for(const label of ['新規','開く…'])for(const response of [0,1,2]){
    const app=setup(response),ui=await desktopRenderer(app);try{
      ui.editor.setSelectionRange(1,1);ui.type('B');ui.state('A.bas',true);
      await ui.action(label);assert.equal(app.dialogs[0].message,'変更を保存しますか？');
      if(response===2){ui.state('A.bas',true);assert.equal(ui.editor.value,'AB');}
      else {ui.state(label==='新規'?'Untitled.bas':'B.bas',false);assert.equal(ui.editor.value,label==='新規'?'':'B');}
      assert.equal(app.saves.length,response===0?1:0);if(response===0)assert.deepEqual(Array.from(app.saves[0].bytes),[65,66]);
    }finally{ui.dom.window.close();}
  }
});
