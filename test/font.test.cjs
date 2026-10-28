'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {parseFontRom,buildFont,buildFontFromRom}=require('../src/font-builder.cjs');
test('generated font has valid checksums, 257 glyphs, and exact ASCII / private-use mappings',()=>{
  const font=fs.readFileSync(path.join(__dirname,'../assets/x1-basic.ttf'));let checksum=0;
  for(let i=0;i<font.length;i+=4)checksum=(checksum+font.readUInt32BE(i))>>>0;
  assert.equal(checksum,0xb1b0afba);
  const tables={};
  for(let i=0;i<font.readUInt16BE(4);i++){
    const at=12+i*16,name=font.toString('ascii',at,at+4);
    tables[name]=font.subarray(font.readUInt32BE(at+8),font.readUInt32BE(at+8)+font.readUInt32BE(at+12));
  }
  assert.equal(tables.maxp.length,32);assert.equal(tables.maxp.readUInt16BE(4),257);
  const cmap=tables.cmap.subarray(12),segCount=cmap.readUInt16BE(6)/2;
  function glyph(code){for(let i=0;i<segCount;i++){
    const end=cmap.readUInt16BE(14+i*2),start=cmap.readUInt16BE(16+segCount*2+i*2);
    if(code>=start&&code<=end)return(code+cmap.readUInt16BE(16+segCount*4+i*2))&65535;
  }return 0;}
  for(let b=0;b<256;b++)assert.equal(glyph(0xe000+b),b+1);
  for(let b=32;b<=126;b++)assert.equal(glyph(b),b+1);
  assert.equal(tables.loca.length,258*4);
});
test('X1 raw font maps 256 consecutive 8-byte glyphs without inversion',()=>{
  const rom=Buffer.alloc(2048);rom[0x41*8]=0x80;rom[0x41*8+7]=1;rom[0xff*8+3]=0x55;
  const rows=parseFontRom(rom);assert.deepEqual(rows[0x41],[0x80,0,0,0,0,0,0,1]);assert.equal(rows[0xff][3],0x55);
  for(const length of [0,2047,2049,4096])assert.throws(()=>parseFontRom(Buffer.alloc(length)),/2048/);
});
test('a set MSB becomes the leftmost lit pixel in the first scanline',()=>{
  const rom=Buffer.alloc(2048);rom[65*8]=0x80;const font=buildFontFromRom(rom),tables={};
  for(let i=0;i<font.readUInt16BE(4);i++){
    const at=12+i*16;tables[font.toString('ascii',at,at+4)]=font.readUInt32BE(at+8);
  }
  const at=tables.glyf+font.readUInt32BE(tables.loca+66*4);
  assert.equal(font.readInt16BE(at),1);let x=0,y=0;
  const xs=Array.from({length:4},(_,i)=>(x+=font.readInt16BE(at+18+i*2)));
  const ys=Array.from({length:4},(_,i)=>(y+=font.readInt16BE(at+26+i*2)));
  assert.deepEqual(xs,[0,0,128,128]);assert.deepEqual(ys,[896,1024,1024,896]);
  let checksum=0;for(let i=0;i<font.length;i+=4)checksum=(checksum+font.readUInt32BE(i))>>>0;
  assert.equal(checksum,0xb1b0afba);
});

function tablesOf(font){
  const tables={};
  for(let i=0;i<font.readUInt16BE(4);i++){
    const at=12+i*16;tables[font.toString('ascii',at,at+4)]=font.subarray(font.readUInt32BE(at+8),font.readUInt32BE(at+8)+font.readUInt32BE(at+12));
  }
  return tables;
}
test('PCG color font has sorted COLR bases, valid layer glyphs, BRG palette and checksums',()=>{
  const bitmap=parseFontRom(Buffer.alloc(2048));
  const hex='80'+'00'.repeat(7)+'40'+'00'.repeat(7)+'20'+'00'.repeat(7);
  const font=buildFont(bitmap,[{code:255,hex:'FF'.repeat(24)},{code:65,hex}]);
  const t=tablesOf(font),colr=t.COLR,cpal=t.CPAL;
  let checksum=0;for(let i=0;i<font.length;i+=4)checksum=(checksum+font.readUInt32BE(i))>>>0;
  assert.equal(checksum,0xb1b0afba);
  assert.equal(colr.readUInt16BE(0),0);assert.equal(colr.readUInt16BE(2),2);
  assert.equal(colr.readUInt32BE(4),14);assert.equal(colr.readUInt32BE(8),26);assert.equal(colr.readUInt16BE(12),4);
  assert.deepEqual(Array.from({length:6},(_,i)=>colr.readUInt16BE(14+i*2)),[66,0,3,256,3,1]);
  assert.deepEqual(Array.from({length:8},(_,i)=>colr.readUInt16BE(26+i*2)),[257,1,258,2,259,4,260,7]);
  assert.equal(t.maxp.readUInt16BE(4),261);assert.equal(t.hhea.readUInt16BE(34),261);
  assert.equal(t.hmtx.length,261*4);assert.equal(t.loca.length,262*4);
  assert.equal(cpal.readUInt16BE(2),8);assert.equal(cpal.readUInt16BE(4),1);assert.equal(cpal.readUInt32BE(8),14);
  assert.deepEqual([...cpal.subarray(18,22)],[255,0,0,255]); // Blue in BGRA.
  assert.deepEqual([...cpal.subarray(22,26)],[0,0,255,255]); // Red.
  assert.deepEqual([...cpal.subarray(30,34)],[0,255,0,255]); // Green.
  assert.deepEqual(t.cmap,tablesOf(buildFont(bitmap)).cmap);
  const base=t.glyf.subarray(t.loca.readUInt32BE(66*4),t.loca.readUInt32BE(67*4));
  assert.equal(base.readInt16BE(0),3); // Monochrome fallback silhouette.
});

test('PCG font keeps unassigned glyphs and can blank an assigned glyph without changing mappings',()=>{
  const bitmap=parseFontRom(Buffer.alloc(2048,255)),normal=tablesOf(buildFont(bitmap));
  const t=tablesOf(buildFont(bitmap,[{code:65,hex:'00'.repeat(24)}]));
  assert.equal(t.COLR,undefined);assert.equal(t.loca.readUInt32BE(66*4),t.loca.readUInt32BE(67*4));
  const glyph=(tables,id)=>tables.glyf.subarray(tables.loca.readUInt32BE(id*4),tables.loca.readUInt32BE((id+1)*4));
  assert.deepEqual(glyph(t,67),glyph(normal,67));assert.deepEqual(t.cmap,normal.cmap);
  assert.deepEqual(buildFont(require('../assets/x1-font.json')),fs.readFileSync(path.join(__dirname,'../assets/x1-basic.ttf')));
  assert.throws(()=>buildFont(bitmap,[{code:256,hex:'00'.repeat(24)}]));
  assert.throws(()=>buildFont(bitmap,[{code:65,hex:'00'.repeat(24)},{code:65,hex:'FF'.repeat(24)}]));
});

test('built-in bitmap matches the pinned redistributable X1 compatible font',()=>{
  const bitmap=require('../assets/x1-font.json'),provenance=require('../assets/x1-font-provenance.json');
  const hash=require('node:crypto').createHash('sha256').update(Buffer.from(bitmap.flat())).digest('hex');
  assert.equal(hash,provenance.sha256);
  assert.equal(provenance.repository,'https://github.com/meister68k/X1_compatible_font');
  assert.ok(fs.existsSync(path.join(__dirname,'../assets/licenses/misaki.txt')));
});

test('browser font builder runs without Node and matches deterministic CJS bytes in every PCG mode',()=>{
  const vm=require('node:vm'),context=vm.createContext({});
  for(const file of ['keywords.js','syntax.js','pcg.js','font-builder.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),context);
  assert.equal(vm.runInContext('typeof Buffer + ":" + typeof require',context),'undefined:undefined');
  context.bitmap=require('../assets/x1-font.json');
  const browserFont=vm.runInContext('X1FontBuilder.buildFont(bitmap)',context);
  assert.equal(browserFont.constructor.name,'Uint8Array');
  assert.deepEqual(Buffer.from(browserFont),buildFont(context.bitmap));
  assert.equal(Buffer.isBuffer(buildFont(context.bitmap)),true);
  const rom=vm.runInContext('new Uint8Array(2048)',context);rom[65*8]=128;
  context.rom=rom;
  assert.deepEqual(Buffer.from(vm.runInContext('X1FontBuilder.buildFontFromRom(rom)',context)),buildFontFromRom(Buffer.from(rom)));
  for(const size of [0,2047,2049])assert.throws(()=>vm.runInContext(`X1FontBuilder.parseFontRom(new Uint8Array(${size}))`,context),/2048/);
  assert.throws(()=>vm.runInContext('X1FontBuilder.parseFontRom(new Array(2048).fill(0))',context),/2048/);
  context.entries=[{code:255,hex:'80402010080402010102040810204080AA55AA55AA55AA55'}];
  for(const order of ['BRG','BGR','RGB','RBG','GBR','GRB'])for(const layout of ['planar','interleaved']){
    context.order=order;context.layout=layout;
    const bytes=Buffer.from(vm.runInContext('X1FontBuilder.buildFont(bitmap,entries,order,layout)',context));
    assert.deepEqual(bytes,buildFont(context.bitmap,context.entries,order,layout));
    let sum=0;for(let at=0;at<bytes.length;at+=4)sum=(sum+bytes.readUInt32BE(at))>>>0;
    assert.equal(sum,0xb1b0afba);
  }
});

test('runtime bitmap and builtin TTF derive from exactly the same original font rows',()=>{
  const vm=require('node:vm'),context=vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/font-bitmap.js'),'utf8'),context);
  const runtime=JSON.parse(JSON.stringify(context.X1FontBitmap)),bitmap=require('../assets/x1-font.json');
  assert.deepEqual(runtime,bitmap);
  const font=fs.readFileSync(path.join(__dirname,'../assets/x1-basic.ttf'));
  assert.deepEqual(buildFont(runtime),font);
  assert.deepEqual(require('../src/font-builder.cjs').readFontBitmap(font),runtime);
});
test('source bitmap recovery roundtrips all 256 codes and patterned custom ROMs without rasterization',()=>{
  const builder=require('../src/font-builder.cjs'),vm=require('node:vm'),context=vm.createContext({});
  for(const file of ['pcg.js','font-builder.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),context);
  for(const rom of [Buffer.alloc(2048),Buffer.alloc(2048,255),Buffer.from(Array.from({length:2048},(_,i)=>(i*73^(i>>3))&255))]){
    const expected=parseFontRom(rom),font=buildFontFromRom(rom);
    assert.deepEqual(builder.readFontBitmap(font),expected);
    context.data=Array.from(font);
    assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('X1FontBuilder.readFontBitmap(Uint8Array.from(data))',context))),expected);
  }
});
test('source bitmap recovery rejects malformed tables, mappings, contours and non-dot outlines',()=>{
  const read=require('../src/font-builder.cjs').readFontBitmap;
  const bitmap=parseFontRom(Buffer.alloc(2048));bitmap[0]=[0xc0,0,0,0,0,0,0,0];
  const original=buildFont(bitmap);
  const table=name=>{
    for(let i=0;i<original.readUInt16BE(4);i++){const at=12+i*16;if(original.toString('ascii',at,at+4)===name)return {at,start:original.readUInt32BE(at+8)};}
  };
  const glyph=table('glyf').start+original.readUInt32BE(table('loca').start+4);
  const corrupt=fn=>{const bytes=Buffer.from(original);fn(bytes);assert.equal(read(bytes),null);};
  for(const size of [0,11,original.length-1])assert.equal(read(original.subarray(0,size)),null);
  assert.equal(read(Array.from(original)),null);
  corrupt(b=>b.writeUInt16BE(65535,4));
  corrupt(b=>b.writeUInt32BE(0xffffffff,table('glyf').at+8));
  corrupt(b=>b.writeUInt16BE(512,table('head').start+18));
  corrupt(b=>b.writeInt16BE(0,table('head').start+50));
  corrupt(b=>b.writeUInt32BE(0xffffffff,table('loca').start+8));
  corrupt(b=>b.writeUInt16BE(12,table('cmap').start+12));
  corrupt(b=>b.writeUInt16BE(1,table('cmap').start+12+16+3*6)); // unsupported idRangeOffset
  corrupt(b=>b.writeInt16BE(-1,glyph)); // composite
  corrupt(b=>b.writeInt16BE(65,glyph)); // excessive contours
  corrupt(b=>b.writeUInt16BE(1,glyph+14)); // instructions
  corrupt(b=>b.writeUInt8(9,glyph+16)); // compressed point flags
  corrupt(b=>b.writeInt16BE(1,glyph+24)); // off-grid left x
  corrupt(b=>b.writeInt16BE(-128,glyph+32)); // second rectangle duplicates first dot
});
