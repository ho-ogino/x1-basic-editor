'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {readDocument,atomicSave,hash}=require('../src/file-store.cjs');
const output=path.join(__dirname,'../test-output');
test('disk roundtrip, original backup, and external-change refusal',async()=>{
  await fs.mkdir(output,{recursive:true});
  const dir=await fs.mkdtemp(path.join(output,'save-'));
  try{
    const file=path.join(dir,'test.bas');
    const bytes=await fs.readFile(path.join(__dirname,'fixtures/editor-sample.bas'));
    const digest=await atomicSave(file,bytes);
    assert.deepEqual(await fs.readFile(file),bytes);
    assert.equal(digest,hash(bytes));
    const loaded=await readDocument(file);assert.equal(loaded.hash,digest);
    const changed=Buffer.from(bytes);changed[0]=0x32;
    const second=await atomicSave(file,changed,digest);
    assert.deepEqual(await fs.readFile(file+'.bak'),bytes);
    assert.deepEqual(await fs.readFile(file),changed);
    await atomicSave(file,bytes,second);
    assert.deepEqual(await fs.readFile(file+'.bak'),bytes);
    await fs.writeFile(file,Buffer.from('External change'));
    await assert.rejects(atomicSave(file,bytes,digest),{code:'EXTERNAL_CHANGE'});
    assert.equal((await fs.readFile(file)).toString(),'External change');
    assert.equal((await fs.readdir(dir)).filter(n=>n.endsWith('.tmp')).length,0);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('missing original is treated as an external change, never silently recreated',async()=>{
  await fs.mkdir(output,{recursive:true});
  const file=path.join(output,'nonexistent-'+Date.now()+'.bas');
  await assert.rejects(atomicSave(file,Buffer.from('A'),hash(Buffer.from('B'))),{code:'EXTERNAL_CHANGE'});
  await assert.rejects(fs.stat(file),{code:'ENOENT'});
});
