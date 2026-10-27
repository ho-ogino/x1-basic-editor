'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {highlightLine} = require('../src/syntax.js');
const words = require('../src/keywords.js');
const X1 = require('../src/codec.js');
const ofKind = (line,kind) => highlightLine(line).filter(token=>token.kind===kind).map(token=>token.text);

test('all 186 compiler keywords are recognized case-insensitively, preserving the typed case',()=>{
  assert.equal(words.length,186);
  for (const word of words) {
    const line=word.toLowerCase(), runs=highlightLine(line);
    assert.deepEqual(runs,[{text:line,kind:word==='REM'?'comment':'keyword'}],word);
  }
});
test('packed HuBASIC syntax matches reserved prefixes without requiring spaces',()=>{
  assert.deepEqual(ofKind('10 FORI=1TO10:IFX=1THENPRINTX:NEXT','keyword'),['FOR','TO','IF','THENPRINT','NEXT']);
  // Adjacent keywords may share one color run, but variable text must stay outside it.
  assert.ok(highlightLine('LOCATE0,2:CGEN1:KEY0,""').some(token=>token.kind==='keyword'&&token.text==='LOCATE'));
});
test('identifiers consume embedded keyword text and digits without false keyword matches',()=>{
  assert.deepEqual(ofKind('10 MYPRINT=1:A1TO2=2:MYVALUE$="PRINT"','keyword'),[]);
  assert.ok(highlightLine('10 MYPRINT=1').some(token=>token.kind===''&&token.text.includes('MYPRINT')));
});
test('quoted strings protect keywords, numbers, apostrophes, and colons',()=>{
  const line='10 PRINT "IF 123 REM \' : FOR":GOTO 100';
  assert.deepEqual(ofKind(line,'keyword'),['PRINT','GOTO']);
  assert.deepEqual(ofKind(line,'string'),['"IF 123 REM \' : FOR"']);
  assert.deepEqual(ofKind(line,'comment'),[]);
});
test('REM and apostrophe consume the rest of the line, including colon-separated text',()=>{
  assert.deepEqual(ofKind('10 rEm PRINT "X":GOTO 200','comment'),['rEm PRINT "X":GOTO 200']);
  assert.deepEqual(ofKind("20 A=1:' PRINT 123:END",'keyword'),[]);
  assert.deepEqual(ofKind("20 A=1:' PRINT 123:END",'comment'),["' PRINT 123:END"]);
});
test('decimal, fractional, exponent, radix and type-suffixed numbers get one numeric run each',()=>{
  const values=['0','123','.5','12.','1.25E-3','3D+4','2!','12.5#','32768%','&HfF','&O77','&B1010'];
  assert.deepEqual(ofKind('10 PRINT '+values.join(';'),'number'),values);
  assert.deepEqual(ofKind('10 PRINT 1ELSE20','keyword'),['PRINT','ELSE']);
});
test('DATA protects unquoted words and apostrophes, and resumes code after an unquoted colon',()=>{
  const line='30 DATA 1,PRINT,"IF:REM",\' TEXT,&HFF,-2.5E-2:READ A';
  assert.deepEqual(ofKind(line,'keyword'),['DATA','READ']);
  assert.deepEqual(ofKind(line,'string'),['PRINT','"IF:REM"',"' TEXT"]);
  assert.deepEqual(ofKind(line,'number'),['1','&HFF','-2.5E-2']);
  assert.deepEqual(ofKind(line,'comment'),[]);
});
test('unterminated strings stop at the real line ending, including inside DATA',()=>{
  assert.deepEqual(ofKind('10 PRINT "IF:REM','string'),['"IF:REM']);
  assert.deepEqual(ofKind('20 DATA "A:B,PRINT','string'),['"A:B,PRINT']);
  assert.deepEqual(ofKind('30 END','keyword'),['END']);
});
test('PRINT shorthand, stream marker, I/O names, and operators follow HuLexer spelling',()=>{
  assert.deepEqual(ofKind('10 ?PEEK@(&H1A00):PRINT#0,1','keyword'),['?PEEK@','PRINT']);
  assert.deepEqual(ofKind('20 POKE@ 1,255','keyword'),['POKE@']);
  assert.deepEqual(ofKind('30 A$="X"','line-number'),['30']);
});
test('highlighting preserves every source character, including all byte values and editor-sample.bas',()=>{
  const fixture=fs.readFileSync(path.join(__dirname,'fixtures/editor-sample.bas'));
  for (const bytes of [fixture,Uint8Array.from({length:256},(_,i)=>i)]) {
    const text=X1.decode(bytes).text;
    assert.equal(text.split('\n').map(line=>highlightLine(line).map(token=>token.text).join('')).join('\n'),text);
  }
});
