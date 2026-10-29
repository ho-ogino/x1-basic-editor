'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.join(__dirname,'..');
function setup(confirmation=0){
  const handlers=new Map(),listeners=new Map(),events=new Map(),sent=[],saves=[],titles=[],edited=[];
  let ready,resolveInitial,menu;const dialogs=[];
  const initial=new Promise(resolve=>{resolveInitial=resolve;});
  const documentA={path:path.resolve('A.bas'),name:'A.bas',bytes:[65],hash:'a'};
  const documentB={path:path.resolve('B.bas'),name:'B.bas',bytes:[66],hash:'b'};
  const electron={
    app:{isPackaged:false,whenReady:()=>({then(fn){ready=fn;}}),on(){},quit(){},getPath:()=>base},
    BrowserWindow:class{
      constructor(){this.webContents={once:(name,fn)=>events.set(name,fn),on(){},send:(...args)=>sent.push(args),
        setWindowOpenHandler(){},session:{setPermissionRequestHandler(){},webRequest:{onBeforeRequest(){}}}};}
      once(){} on(){} loadFile(){} setDocumentEdited(value){edited.push(value);} setTitle(value){titles.push(value);} close(){}
    },
    Menu:{setApplicationMenu(value){menu=value;},buildFromTemplate:items=>items},
    dialog:{async showOpenDialog(){return {canceled:false,filePaths:[documentB.path]};},
      async showSaveDialog(){return {canceled:false,filePath:path.resolve('new.bas')};},async showMessageBox(_win,options){dialogs.push(options);return {response:confirmation};}},
    ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:(name,fn)=>listeners.set(name,fn)}
  };
  const store={MAX_BYTES:2*1024*1024,readDocument:file=>file===documentA.path?initial:Promise.resolve(documentB),
    async atomicSave(file,bytes){saves.push({file,bytes});return 'saved';}};
  const requireMock=name=>name==='electron'?electron:name==='./src/file-store.cjs'?store:require(name.startsWith('./')?path.join(base,name):name);
  vm.runInNewContext(fs.readFileSync(path.join(base,'main.cjs'),'utf8'),{
    require:requireMock,__dirname:base,Buffer,console,process:{platform:'win32',argv:['electron','.',documentA.path]}
  });
  ready();
  return {sent,saves,titles,edited,menu,dialogs,documentA,documentB,start:()=>events.get('did-finish-load')(),resolve:()=>resolveInitial(documentA),
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
