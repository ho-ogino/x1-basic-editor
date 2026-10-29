'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../src/host.js'),'utf8');
test('host selection supports Electron and injected browser hosts with custom precedence',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
  for(const hosts of [{desktop:{}},{X1Host:{}},{desktop:{},X1Host:{}},{desktop:{},X1Host:null}]){
    const dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window;
    try{
      Object.assign(w,hosts);const expected=hosts.X1Host??hosts.desktop,injected=hosts.X1Host!=null;
      w.eval(source);assert.equal(w.X1Host,expected);
      const buttons=[...w.document.querySelectorAll('[data-command="new"],[data-command="save-as"]')];
      assert.ok(buttons.every(button=>button.hidden===injected));
      assert.ok([...w.document.querySelectorAll('[data-command="open"]')].every(button=>button.textContent===(injected?'インポート…':'開く…')));
      assert.equal(w.document.querySelector('[data-command="save"]').textContent,injected?'エクスポート':'保存');
      assert.match(w.document.getElementById('empty-file-hint').textContent,injected?/インポート/:/開いて/);
      assert.equal(w.document.getElementById('document-bar').hidden,injected);
    }finally{dom.window.close();}
  }
  const dom=new JSDOM(html,{runScripts:'outside-only'});
  try{
    for(const [,script] of html.matchAll(/<script src="([^"]+)"/g)){
      const code=fs.readFileSync(path.join(__dirname,'../src',script),'utf8');
      if(script==='host.js')assert.throws(()=>dom.window.eval(code),/requires a host/);else dom.window.eval(code);
    }
    assert.equal(dom.window.document.getElementById('document-bar').hidden,true);
    assert.equal(dom.window.document.getElementById('filename').textContent,'');assert.equal(dom.window.document.getElementById('dirty-state').textContent,'');
  }finally{dom.window.close();}
});
test('packaged Electron files contain all HTML scripts and shared font runtime dependencies',()=>{
  const root=path.join(__dirname,'..'),config=require('../package.json');
  const html=fs.readFileSync(path.join(root,'src/index.html'),'utf8');
  const files=new Set([...html.matchAll(/<script src="([^"]+)"/g)].map(match=>'src/'+match[1]));
  files.add('src/font-builder.cjs');
  for(const file of [...files]){
    const content=fs.readFileSync(path.join(root,file),'utf8');
    for(const [,relative] of content.matchAll(/require\(['"](\.[^'"]+)['"]\)/g))files.add(path.posix.join(path.posix.dirname(file),relative));
  }
  for(const file of files){
    assert.ok(fs.existsSync(path.join(root,file)),file+' exists');
    assert.ok(config.build.files.some(pattern=>path.matchesGlob(file,pattern)),file+' is packaged');
  }
});
