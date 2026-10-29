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

const spacedRows=[
  '0000000000010003 0007030707020301 000000000702031D',
  '0100000700000000 2070603000000307 1E0F070007030000'
];
const compact=hex=>hex.replace(/[ \t]/g,'').toUpperCase();

test('PCG imports spaced BRG rows as bare data, DATA and quoted literals with original offsets',()=>{
  for(const newline of ['\n','\r\n','\r'])for(const wrap of [s=>s,s=>'10 DATA '+s,s=>'20 DATA "'+s+'"']){
    const lines=spacedRows.map(wrap),scan=pcg.scan(lines.join(newline));
    assert.deepEqual(scan.raw.map(d=>d.hex),spacedRows.map(compact));
    assert.deepEqual(scan.raw.map(d=>[d.line,d.offset]),[[1,lines[0].indexOf(spacedRows[0])],[2,lines[0].length+1+lines[1].indexOf(spacedRows[1])]]);
    assert.deepEqual(scan.definitions,[]);assert.deepEqual(scan.warnings,[]);
    assert.deepEqual(pcg.pixels(scan.raw[0].hex),pcg.pixels(compact(spacedRows[0])));
    assert.equal(pcg.svg(scan.raw[1].hex),pcg.svg(compact(spacedRows[1])));
  }
});

test('PCG source import removes ASCII spaces and tabs even between nibbles, but keeps canonical API strict',()=>{
  for(const source of [spacedRows[0].toLowerCase().replaceAll(' ','\t  '),sample.split('').join(' \t'), ' \t'+spacedRows[0]+' \t']){
    const expected=compact(source),scan=pcg.scan(source);
    assert.deepEqual(scan.raw.map(d=>d.hex),[expected]);
    const literal=pcg.scan(`10 DEFCHR$(&H41)=HEXCHR$("${source}"):DEFCHR$(66)=STRING$(24,255)`);
    assert.deepEqual(literal.definitions.map(d=>[d.code,d.hex]),[[65,expected],[66,full]]);
    assert.deepEqual(literal.raw,[]);assert.deepEqual(literal.warnings,[]);
    assert.throws(()=>pcg.validateHex(source),/48/);assert.throws(()=>pcg.pixels(source),/48/);
  }
});

test('PCG spaced scans preserve mixed source order, existing records and duplicate assignments',()=>{
  const text=`10 DATA ${spacedRows[0]},${full},"${spacedRows[1]}",${zero}\n20 DEFCHR$(66)=HEXCHR$("${spacedRows[1]}")`;
  const scan=pcg.scan(text),records=pcg.assignments(scan,65);
  assert.deepEqual(scan.raw.map(d=>d.hex),[compact(spacedRows[0]),full,compact(spacedRows[1]),zero]);
  assert.deepEqual(scan.raw.map(d=>d.offset),[text.indexOf(spacedRows[0]),text.indexOf(full),text.indexOf(spacedRows[1]),text.indexOf(zero)]);
  assert.deepEqual(records.map(d=>d.code),[65,66,67,68,66]);
  assert.equal(new Map(records.map(d=>[d.code,d.hex])).get(66),compact(spacedRows[1]));
  assert.throws(()=>pcg.assignments(scan,253),/255/);
  assert.equal(pcg.scan(`${full} ${spacedRows[0]} ${zero}`).raw.length,3);
  assert.deepEqual(pcg.scan(`${full} ${zero}`).raw.map(d=>d.hex),[full,zero]);
});

test('PCG rejects entire malformed spaced runs instead of padding, truncating or joining lines',()=>{
  for(const length of [1,23,24,46,47,49,50,96]){
    const source='F'.repeat(length).match(/.{1,16}/g).join(' ');
    assert.deepEqual(pcg.scan(source).raw,[],source);
    const scan=pcg.scan(`10 DEFCHR$(65)=HEXCHR$("${source}")`);
    assert.deepEqual(scan.definitions,[]);assert.deepEqual(scan.raw,[]);assert.equal(scan.warnings.length,1);
  }
  for(const gap of ['\n','\r\n','\r','\v','\f','\u00a0','\u3000']){
    assert.deepEqual(pcg.scan('F'.repeat(24)+gap+'F'.repeat(24)).raw,[],JSON.stringify(gap));
  }
  for(const source of [' \t ','G'+spacedRows[0].slice(1),spacedRows[0].replace(' ','_')]){
    const scan=pcg.scan(`10 DEFCHR$(65)=HEXCHR$("${source}")`);
    assert.deepEqual(scan.definitions,[]);assert.deepEqual(scan.raw,[]);assert.equal(scan.warnings.length,1);
  }
  assert.deepEqual(pcg.scan(`10 ${spacedRows[0]}`).raw,[]); // Including these two digits makes 50, not 48.
  // Without DATA a numeric first group is data, just as in a bare numeric PCG row.
  assert.deepEqual(pcg.scan('10 '+'F'.repeat(23)+' '+'F'.repeat(23)).raw.map(d=>d.hex),['10'+'F'.repeat(46)]);
  assert.equal(pcg.scan('F'.repeat(120000)).raw.length,0);
});

test('PCG spaced scanner respects comments and consumed definitions without masking bare numeric or DEF prefixes',()=>{
  const text=`10 REM ${spacedRows[0]}\n20 ' ${spacedRows[1]}\n30 DEFCHR$(I)=HEXCHR$("${spacedRows[0]}")\n40 DEFCHR$(65)=HEXCHR$("${spacedRows[0]}")+A$\n50 DATA "${spacedRows[1]}"`;
  const scan=pcg.scan(text);
  assert.deepEqual(scan.definitions,[]);assert.equal(scan.warnings.length,2);
  assert.deepEqual(scan.raw.map(d=>d.hex),[compact(spacedRows[1])]);
  assert.equal(scan.raw[0].line,5);
  for(const source of ['0'.repeat(16)+' '+ '1'.repeat(16)+' '+ '2'.repeat(16),'DEF'+'F'.repeat(13)+' '+ 'A'.repeat(16)+' '+ 'B'.repeat(16)]){
    assert.deepEqual(pcg.scan(source).raw.map(d=>d.hex),[compact(source)]);
  }
});
