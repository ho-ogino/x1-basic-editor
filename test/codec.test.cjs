'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const X1 = require('../src/codec.js');
const fixture = fs.readFileSync(path.join(__dirname,'fixtures/editor-sample.bas'));
test('editor-sample.bas opens without changing any bytes, including final CRLF',()=>{
  const doc = new X1.ByteDocument(fixture);
  assert.equal(doc.dirty,false); assert.deepEqual(Buffer.from(doc.bytes),fixture);
  assert.equal(doc.view.counts.CRLF,77); assert.equal(doc.view.text.endsWith('\n'),true);
  assert.equal(doc.updateText(doc.view.text,[0,0]),0);
  assert.deepEqual(Buffer.from(doc.bytes),fixture); assert.equal(doc.undoStack.length,0);
});
test('all 256 byte values survive loading and unchanged input',()=>{
  const bytes=Uint8Array.from({length:256},(_,i)=>i), doc=new X1.ByteDocument(bytes);
  doc.updateText(doc.view.text,[0,0]); assert.deepEqual(doc.bytes,bytes);
  assert.equal(doc.view.offsets.at(-1),256);
});
test('editing one ASCII character changes exactly one byte; undo/redo restores selection and bytes',()=>{
  const doc=new X1.ByteDocument(fixture), start=doc.view.text.indexOf(X1.glyph(0x38));
  const expected=Buffer.from(fixture); expected[doc.view.offsets[start]]=0x39;
  doc.replace(start,start+1,Uint8Array.of(0x39),[start,start+1]);
  assert.deepEqual(Buffer.from(doc.bytes),expected); assert.equal(doc.dirty,true);
  assert.deepEqual(doc.undo([start+1,start+1]),[start,start+1]);
  assert.deepEqual(Buffer.from(doc.bytes),fixture); assert.equal(doc.dirty,false);
  doc.redo([start,start+1]); assert.deepEqual(Buffer.from(doc.bytes),expected);
});
test('native text input preserves surrounding mixed line endings and arbitrary bytes',()=>{
  const bytes=Uint8Array.of(65,13,10,135,13,66,10,247,0,26),doc=new X1.ByteDocument(bytes);
  const value=doc.view.text.slice(0,2)+'X'+doc.view.text.slice(3);
  doc.updateText(value,[2,3]); const expected=bytes.slice(); expected[3]=88;
  assert.deepEqual(doc.bytes,expected);
});
test('new Enter follows chosen newline, existing CRLF is unchanged',()=>{
  const doc=new X1.ByteDocument(Uint8Array.of(65,13,10,66)); doc.newline='\n';
  doc.updateText(doc.view.text+'\n',[3,3]); assert.deepEqual([...doc.bytes],[65,13,10,66,10]);
});
test('insertion among repeated characters retains intended caret position',()=>{
  const doc=new X1.ByteDocument(Buffer.from('AAAA'));
  assert.equal(doc.updateText('AAAAA',[1,1],'insertText'),2);
  assert.deepEqual(Buffer.from(doc.bytes),Buffer.from('AAAAA'));
});
test('deleting a specific repeated newline removes its own bytes, preserving adjacent mixed EOL',()=>{
  const doc=new X1.ByteDocument(Uint8Array.of(65,13,10,10,66));
  doc.updateText('A\nB',[2,2],'deleteContentBackward');
  assert.deepEqual([...doc.bytes],[65,10,66]);
  doc.undo([1,1]);
  doc.updateText('A\nB',[1,1],'deleteContentForward');
  assert.deepEqual([...doc.bytes],[65,10,66]);
});
test('kana IME input supports fullwidth, halfwidth, voiced and hiragana without altering ASCII',()=>{
  assert.deepEqual([...X1.encodeInput('ガﾊﾟひ')],[0xb6,0xde,0xca,0xdf,0xcb]);
  assert.deepEqual([...X1.encodeInput('ABC\\¥日─♥')],[65,66,67,92,92,0xf7,0x90,0xe3]);
});
test('unsupported input rejects the entire operation without replacing data',()=>{
  const doc=new X1.ByteDocument(fixture), original=doc.bytes.slice();
  assert.throws(()=>doc.updateText(doc.view.text+'漢🙂',[0,0]),/表現できない/);
  assert.deepEqual(doc.bytes,original); assert.equal(doc.undoStack.length,0);
});
test('escape syntax is explicit and ordinary input never interprets backslashes',()=>{
  assert.deepEqual([...X1.parseEscapes('\\x87\\{heart}\\{LEFT}')],[0x87,0xe3,0x1d]);
  assert.deepEqual([...X1.encodeInput('\\x87')],[92,120,56,55]);
  assert.throws(()=>X1.parseEscapes('\\{bad_name}'),/不明/);
});
test('exported escaped clipboard text roundtrips non-newline bytes unambiguously',()=>{
  const bytes=Uint8Array.from({length:256},(_,i)=>i).filter(n=>n!==10&&n!==13);
  assert.deepEqual(X1.parseEscapes(X1.clipboardText(bytes)),bytes);
});
test('zero bytes, EOF marker, empty file, trailing blank lines and literal escape strings survive undo',()=>{
  for(const bytes of [[],[0],[26],[65,13,10,13,10],[92,120,56,55,255]]){
    const doc=new X1.ByteDocument(bytes);doc.replace(0,0,Uint8Array.of(0x87,0x1f,0x1d));doc.undo([3,3]);
    assert.deepEqual([...doc.bytes],bytes);assert.equal(doc.dirty,false);
  }
});

test('long literal and escaped search/insert text never exceeds the argument-count limit',()=>{
  const plain='A'.repeat(2*1024*1024),bytes=X1.parseEscapes(plain);
  assert.equal(bytes.length,plain.length);assert.equal(bytes.every(byte=>byte===65),true);
  const run='B'.repeat(131072),mixed=X1.parseEscapes(run+'\\x00'+run+'\\{heart}');
  assert.equal(mixed.length,2*run.length+2);assert.equal(mixed[run.length],0);assert.equal(mixed.at(-1),0xe3);
  assert.equal(mixed.subarray(0,run.length).every(byte=>byte===66),true);
  assert.equal(mixed.subarray(run.length+1,-1).every(byte=>byte===66),true);
});
