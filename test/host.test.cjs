'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/host.js'),'utf8');
test('host selection supports Electron and injected browser hosts with custom precedence',()=>{
  for(const window of [{desktop:{}},{X1Host:{}},{desktop:{},X1Host:{}}]){
    const expected=window.X1Host??window.desktop;vm.runInNewContext(source,{window});assert.equal(window.X1Host,expected);
  }
  assert.throws(()=>vm.runInNewContext(source,{window:{}}),/requires a host/);
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
