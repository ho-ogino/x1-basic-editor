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
