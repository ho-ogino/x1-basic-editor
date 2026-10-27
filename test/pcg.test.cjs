'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const pcg=require('../src/pcg.js');
const sample='80402010080402010102040810204080AA55AA55AA55AA55';
const full='FF'.repeat(24),zero='00'.repeat(24);

test('PCG literal definitions support multiple lines, radix codes and STRING$(24,n)',()=>{
  const scan=pcg.scan(`7010 DEFCHR$(65)=HEXCHR$("${sample}")\r\n7020 defchr$(&HFF)=string$(24,&B10101010):DEFCHR$(&O100)=HEXCHR$("${zero}")`);
  assert.deepEqual(scan.definitions.map(d=>[d.code,d.hex,d.line]),[[65,sample,1],[255,'AA'.repeat(24),2],[64,zero,2]]);
  assert.equal(scan.raw.length,0);assert.deepEqual(scan.warnings,[]);
});

test('PCG scanner ignores comments, quoted fake definitions and DATA keyword text',()=>{
  const scan=pcg.scan(`10 REM DEFCHR$(65)=HEXCHR$("${full}")\n20 ' ${sample}\n30 PRINT "DEFCHR$(1)="\n40 DATA DEFCHR$(2),"${zero}"`);
  assert.equal(scan.definitions.length,0);assert.deepEqual(scan.raw.map(d=>d.hex),[zero]);assert.deepEqual(scan.warnings,[]);
});

test('PCG detects raw DATA and quoted HEX strings without counting explicit literals twice',()=>{
  const scan=pcg.scan(`10 DATA "${sample}",${zero}\n20 DEFCHR$(66)=HEXCHR$("${full}"):A$=HEXCHR$("${sample}")`);
  assert.equal(scan.raw.length,3);assert.equal(scan.definitions.length,1);
  const records=pcg.assignments(scan,65);
  assert.deepEqual(records.map(d=>d.code),[65,66,66,67]);
  assert.equal(new Map(records.map(d=>[d.code,d.hex])).get(66),full);
  assert.throws(()=>pcg.assignments(scan,254),/255/);
});

test('PCG unsupported expressions, invalid codes and malformed hex are skipped with warnings',()=>{
  const scan=pcg.scan(`10 DEFCHR$(I)=HEXCHR$("${full}")\n20 DEFCHR$(256)=HEXCHR$("${full}")\n30 DEFCHR$(1)=HEXCHR$("${full}")+A$\n40 DEFCHR$(2)=STRING$(24,256)\n50 DEFCHR$(3)=HEXCHR$("${'F'.repeat(47)}")`);
  assert.equal(scan.definitions.length,0);assert.equal(scan.raw.length,0);assert.equal(scan.warnings.length,5);
  assert.equal(pcg.scan('F'.repeat(49)).raw.length,0);
  assert.equal(pcg.scan('F'.repeat(96)).raw.length,0);
  for(const code of ['-1','256','65.0','1+2','&H','1%%',''])assert.throws(()=>pcg.parseCode(code));
  assert.equal(pcg.parseCode('&HFF'),255);assert.equal(pcg.parseCode('+65%'),65);
  assert.throws(()=>pcg.validateHex('GG'.repeat(24)));assert.throws(()=>pcg.validateHex('0'.repeat(47)));
});

test('PCG pixels use BRG planes by default, MSB left, and configurable permutations',()=>{
  const hex='80'+'00'.repeat(7)+'40'+'00'.repeat(7)+'20'+'00'.repeat(7);
  assert.deepEqual(pcg.pixels(hex)[0],[1,2,4,0,0,0,0,0]);
  assert.deepEqual(pcg.pixels(hex,'RGB')[0],[2,4,1,0,0,0,0,0]);
  assert.deepEqual(pcg.pixels(full),Array.from({length:8},()=>Array(8).fill(7)));
  assert.deepEqual(pcg.pixels('FF'.repeat(8)+'00'.repeat(8)+'FF'.repeat(8))[0],Array(8).fill(5));
  for(const order of pcg.ORDERS)assert.equal(new Set(pcg.pixels(hex,order)[0].slice(0,3)).size,3);
  assert.throws(()=>pcg.pixels(hex,'RRR'));assert.throws(()=>pcg.pixels(hex,'BRG','unknown'));
});

test('3x interleaved PCG takes B,R,G one byte each per scanline',()=>{
  const interleaved='AA55FF'.repeat(8),planar='AA'.repeat(8)+'55'.repeat(8)+'FF'.repeat(8);
  assert.deepEqual(pcg.pixels(interleaved,'BRG','interleaved'),pcg.pixels(planar));
  assert.deepEqual(pcg.pixels(interleaved,'BRG','interleaved')[0],[5,6,5,6,5,6,5,6]);
  assert.match(pcg.svg(interleaved,'BRG','interleaved'),/fill="#00ffff"/);
});

test('synthetic PCG fixture reads 64 definitions without modifying bytes',()=>{
  const bytes=fs.readFileSync(path.join(__dirname,'fixtures/editor-sample.bas'));
  const text=bytes.toString('latin1'),section=text.split(/\r\n/).filter(line=>/^7\d{3} /.test(line)).join('\n');
  const scan=pcg.scan(section);
  assert.equal(scan.definitions.length,64);assert.deepEqual(scan.warnings,[]);assert.equal(scan.raw.length,0);
  assert.equal(scan.definitions.find(d=>d.code===65).hex,sample);
});
