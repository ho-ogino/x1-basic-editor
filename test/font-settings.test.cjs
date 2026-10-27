'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {FontSettings}=require('../src/font-settings.cjs');
const output=path.resolve(__dirname,'../test-output');
async function inDirectory(run){
  await fs.mkdir(output,{recursive:true});const dir=await fs.mkdtemp(path.join(output,'font-'));
  try{await run(dir);}finally{assert.ok(path.resolve(dir).startsWith(output+path.sep));await fs.rm(dir,{recursive:true,force:true});}
}
test('font settings survive a new instance and no longer depend on the source file',async()=>inDirectory(async dir=>{
  const file=path.join(dir,'display-settings.json'),source=path.join(dir,'FNT0808.X1');
  const rom=Buffer.from(Array.from({length:2048},(_,i)=>i%256));await fs.writeFile(source,rom);
  assert.equal(await new FontSettings(file).read(),null);
  await new FontSettings(file).write({name:'FNT0808.X1',rom:await fs.readFile(source)});
  await fs.unlink(source);
  const restored=await new FontSettings(file).read();assert.equal(restored.name,'FNT0808.X1');assert.deepEqual(restored.rom,rom);
  assert.equal((await fs.readdir(dir)).filter(name=>name.endsWith('.tmp')).length,0);
}));
test('invalid font lengths leave the previous setting intact',async()=>inDirectory(async dir=>{
  const file=path.join(dir,'display-settings.json'),settings=new FontSettings(file);
  await settings.write({name:'valid.X1',rom:Buffer.alloc(2048,0x55)});const before=await fs.readFile(file);
  for(const length of [0,2047,2049,4096])await assert.rejects(settings.write({name:'bad.X1',rom:Buffer.alloc(length)}),/2048/);
  assert.deepEqual(await fs.readFile(file),before);
}));
test('reset to built-in is persisted across instances',async()=>inDirectory(async dir=>{
  const file=path.join(dir,'display-settings.json');
  await new FontSettings(file).write({name:'font.X1',rom:Buffer.alloc(2048)});
  await new FontSettings(file).write(null);assert.equal(await new FontSettings(file).read(),null);
}));
test('corrupt settings are rejected without modifying the saved file',async()=>inDirectory(async dir=>{
  const file=path.join(dir,'display-settings.json');
  for(const text of ['{bad',JSON.stringify({version:1,font:{name:'bad',rom:'invalid!'}}),JSON.stringify({version:2,font:null})]){
    await fs.writeFile(file,text);await assert.rejects(new FontSettings(file).read());assert.equal(await fs.readFile(file,'utf8'),text);
  }
}));

test('renamed app migrates the old font once and respects a reset in the new profile',async()=>inDirectory(async dir=>{
  const legacyFile=path.join(dir,'old-profile','display-settings.json'),file=path.join(dir,'new-profile','display-settings.json');
  const rom=Buffer.alloc(2048,0x55);await new FontSettings(legacyFile).write({name:'old-font.X1',rom});
  const legacyBytes=await fs.readFile(legacyFile),migrated=await new FontSettings(file,legacyFile).read();
  assert.equal(migrated.name,'old-font.X1');assert.deepEqual(migrated.rom,rom);
  assert.deepEqual((await new FontSettings(file).read()).rom,rom);
  assert.deepEqual(await fs.readFile(legacyFile),legacyBytes);
  await new FontSettings(file,legacyFile).write(null);
  assert.equal(await new FontSettings(file,legacyFile).read(),null);
}));
