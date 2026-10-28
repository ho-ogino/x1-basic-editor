'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const base=path.join(__dirname,'../src');
const X1=require('../src/codec.js');
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/editor-sample.bas'));
function setup(bytes=fixture,options={}){
  const dom=new JSDOM(fs.readFileSync(path.join(base,'index.html'),'utf8'),{runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;let onLoad,onCommand,saved,latestState;
  if(options.styles){const style=w.document.createElement('style');style.textContent=fs.readFileSync(path.join(base,'style.css'),'utf8');w.document.head.append(style);}
  if(options.resizeObserver)w.ResizeObserver=class{constructor(){}observe(){}};
  w.desktop={state(value){latestState=value;},onLoaded(fn){onLoad=fn;},onCommand(fn){onCommand=fn;},
    async save(payload){saved=Uint8Array.from(payload.bytes);return {name:'test.bas',bytes:payload.bytes};},
    async confirmDirty(){return 'cancel';},async open(){return null;},newDocument(){},close(){},
    async pcgFont(payload){return Array.from(require('../src/font-builder.cjs').buildFont(require('../assets/x1-font.json'),payload.entries,payload.order,payload.layout));},...options.desktop};
  if(options.hostOnly){w.X1Host=w.desktop;delete w.desktop;}
  const faces=new Set();
  w.FontFace=class {
    constructor(family,data){this.family=family;this.data=data;}
    async load(){if(options.failFont)throw Error('Font rejected');return this;}
  };
  Object.defineProperty(w.document,'fonts',{value:{ready:Promise.resolve(),add:face=>faces.add(face),delete:face=>faces.delete(face)}});
  const highlights=new Map();
  if(!options.noHighlights){
    w.CSS??={};w.CSS.highlights=highlights;w.Highlight=class extends Set{constructor(...ranges){super(ranges);}};
  }
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.eval(fs.readFileSync(path.join(base,'codec.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(base,'keywords.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(base,'syntax.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(base,'pcg.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(base,'pcg-preview.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(base,'font-builder.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(base,'host.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(base,'sidebar-resize.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(base,'editor.js'),'utf8'));
  onLoad({name:'test.bas',bytes:Array.from(bytes)});
  const $=id=>w.document.getElementById(id),editor=$('editor');
  function type(text){
    editor.dispatchEvent(new w.InputEvent('beforeinput',{inputType:'insertText',bubbles:true}));
    editor.setRangeText(text,editor.selectionStart,editor.selectionEnd,'end');
    editor.dispatchEvent(new w.InputEvent('input',{inputType:'insertText',bubbles:true}));
  }
  const save=async()=>{await onCommand('save');return Buffer.from(saved);};
  return {dom,w,$,editor,type,save,faces,highlights,command:onCommand,load:onLoad,get dirty(){return latestState?.dirty;}};
}
test('renderer shows readable ASCII, X1 symbols, line count and exact unchanged save',async()=>{
  const ui=setup();try{
    assert.ok(ui.editor.value.startsWith("10 ' X1 BASIC EDITOR SYNTHETIC TEST DATA"));
    assert.ok(ui.editor.value.includes(String.fromCharCode(0xe087)));
    assert.equal(ui.$('mirror').querySelectorAll('.source-line').length,78);
    assert.deepEqual(await ui.save(),fixture);
  }finally{ui.dom.window.close();}
});
test('renderer typing, palette controls and undo restore original bytes',async()=>{
  const ui=setup();try{
    ui.editor.setSelectionRange(0,1);ui.type('2');
    let expected=Buffer.from(fixture);expected[0]=50;assert.deepEqual(await ui.save(),expected);
    await ui.command('undo');assert.deepEqual(await ui.save(),fixture);
    ui.editor.setSelectionRange(0,0);
    ui.w.document.querySelector('[data-group="controls"]').click();
    ui.w.document.querySelector('[data-code="29"]').click();
    assert.deepEqual(await ui.save(),Buffer.concat([Buffer.from([0x1d]),fixture]));
    await ui.command('undo');assert.deepEqual(await ui.save(),fixture);
  }finally{ui.dom.window.close();}
});
test('IME composition converts voiced kana and duplicate input does not move caret to EOF',async()=>{
  const ui=setup();try{
    ui.editor.setSelectionRange(0,0);
    ui.editor.dispatchEvent(new ui.w.CompositionEvent('compositionstart'));
    ui.editor.setRangeText('ガ',0,0,'end');
    ui.editor.dispatchEvent(new ui.w.InputEvent('input',{isComposing:true}));
    ui.editor.dispatchEvent(new ui.w.CompositionEvent('compositionend'));
    assert.equal(ui.editor.selectionStart,2);
    ui.editor.dispatchEvent(new ui.w.InputEvent('input'));
    assert.equal(ui.editor.selectionStart,2);
    assert.deepEqual(await ui.save(),Buffer.concat([Buffer.from([0xb6,0xde]),fixture]));
  }finally{ui.dom.window.close();}
});
test('copy/paste preserves raw bytes including mixed newlines; unsupported paste is atomic',async()=>{
  const original=Buffer.from([65,13,10,0x87,0x1f,0,26,10,0xf7,13,66]);
  const ui=setup(original);try{
    const data=new Map(),clipboardData={setData:(k,v)=>data.set(k,v),getData:k=>data.get(k)||''};
    const event=type=>{const e=new ui.w.Event(type,{cancelable:true});Object.defineProperty(e,'clipboardData',{value:clipboardData});return e;};
    ui.editor.select();ui.editor.dispatchEvent(event('copy'));
    assert.ok(data.get('text/plain').includes('\\{vfill8}'));
    assert.equal(data.get('application/x-x1-basic-editor'),data.get('application/x-x1-byte-editor'));
    data.delete('application/x-x1-basic-editor'); // Old releases only supply this legacy MIME type.
    ui.editor.setSelectionRange(ui.editor.value.length,ui.editor.value.length);ui.editor.dispatchEvent(event('paste'));
    assert.deepEqual(await ui.save(),Buffer.concat([original,original]));
    await ui.command('undo');
    data.clear();data.set('text/plain','A漢B');ui.editor.dispatchEvent(event('paste'));
    assert.match(ui.$('notice').textContent,/表現できない/);assert.deepEqual(await ui.save(),original);
  }finally{ui.dom.window.close();}
});
test('case-insensitive find and replace all preserve surrounding bytes and undo as one operation',async()=>{
  const original=Buffer.from([65,98,13,10,0x87,65,66,10,0,26]);
  const ui=setup(original);try{
    ui.$('find-text').value='ab';ui.$('replace-text').value='\\{heart}';ui.$('case-sensitive').checked=false;
    ui.$('replace-all').click();
    assert.deepEqual(await ui.save(),Buffer.from([0xe3,13,10,0x87,0xe3,10,0,26]));
    assert.match(ui.$('find-status').textContent,/2件/);
    await ui.command('undo');assert.deepEqual(await ui.save(),original);
    ui.editor.setSelectionRange(0,0);ui.$('find-next').click();
    assert.equal(ui.editor.selectionStart,0);assert.equal(ui.editor.selectionEnd,2);
  }finally{ui.dom.window.close();}
});
test('unsupported typed text leaves selection, document, and dirty state unchanged',async()=>{
  const ui=setup();try{
    ui.editor.setSelectionRange(3,5);ui.type('🙂');
    assert.equal(ui.editor.selectionStart,3);assert.equal(ui.editor.selectionEnd,5);
    assert.equal(ui.dirty,false);assert.deepEqual(await ui.save(),fixture);
  }finally{ui.dom.window.close();}
});
test('actual beforeinput selection disambiguates repeated input and mixed-EOL backspace',async()=>{
  const ui=setup(Buffer.from('AAAA'));try{
    ui.editor.setSelectionRange(1,1);ui.type('A');assert.equal(ui.editor.selectionStart,2);
    assert.deepEqual(await ui.save(),Buffer.from('AAAAA'));
  }finally{ui.dom.window.close();}
  const other=setup(Buffer.from([65,13,10,10,66]));try{
    other.editor.setSelectionRange(2,2);
    other.editor.dispatchEvent(new other.w.InputEvent('beforeinput',{inputType:'deleteContentBackward'}));
    other.editor.value='A\nB';other.editor.setSelectionRange(1,1);
    other.editor.dispatchEvent(new other.w.InputEvent('input',{inputType:'deleteContentBackward'}));
    assert.deepEqual(await other.save(),Buffer.from([65,10,66]));
  }finally{other.dom.window.close();}
});
test('soft wrap toggles without changing bytes, selection, dirty state or real newlines',async()=>{
  const ui=setup();try{
    const originalText=ui.editor.value;
    ui.editor.setSelectionRange(40,57);
    ui.$('word-wrap').checked=true;ui.$('word-wrap').dispatchEvent(new ui.w.Event('change'));
    assert.equal(ui.editor.wrap,'soft');assert.equal(ui.$('text-area').classList.contains('wrapped'),true);
    assert.equal(ui.editor.value,originalText);assert.equal(ui.editor.selectionStart,40);assert.equal(ui.editor.selectionEnd,57);
    assert.equal(ui.dirty,false);assert.deepEqual(await ui.save(),fixture);
    ui.$('word-wrap').checked=false;ui.$('word-wrap').dispatchEvent(new ui.w.Event('change'));
    assert.equal(ui.editor.wrap,'off');assert.equal(ui.editor.value,originalText);
    assert.equal(ui.$('line-numbers').textContent.split('\n').length,78);
    assert.deepEqual(await ui.save(),fixture);
  }finally{ui.dom.window.close();}
});
test('wrapped line-number rows follow pane width and font scale; search reveals a wrapped match',async()=>{
  const original=Buffer.from('ABCDEFGHIJKL\r\nB');
  const ui=setup(original);try{
    ui.editor.style.fontSize='24px';ui.editor.style.lineHeight='30px';
    Object.defineProperty(ui.editor,'clientWidth',{value:132,configurable:true}); // 4 glyphs + 36px padding.
    Object.defineProperty(ui.editor,'clientHeight',{value:30,configurable:true});
    ui.$('word-wrap').checked=true;ui.$('word-wrap').dispatchEvent(new ui.w.Event('change'));
    assert.equal(ui.$('mirror').style.width,'132px');assert.equal(ui.$('line-numbers').textContent,'1\n↪\n↪\n2');
    ui.$('find-text').value='KL';ui.$('find-next').click();
    assert.equal(ui.editor.selectionStart,10);assert.ok(ui.editor.scrollTop>0);
    Object.defineProperty(ui.editor,'clientWidth',{value:180,configurable:true}); // 6 glyphs.
    ui.w.dispatchEvent(new ui.w.Event('resize'));assert.equal(ui.$('line-numbers').textContent,'1\n↪\n2');
    ui.editor.style.fontSize='32px';ui.editor.style.lineHeight='40px';
    ui.$('scale').value='4';ui.$('scale').dispatchEvent(new ui.w.Event('change')); // 4 glyphs again.
    assert.equal(ui.$('line-numbers').textContent,'1\n↪\n↪\n2');
    assert.deepEqual(await ui.save(),original);
  }finally{ui.dom.window.close();}
});
test('syntax colors update after editing and undo without changing X1 bytes or glyph markers',async()=>{
  const original=Buffer.concat([Buffer.from('10 PRINT "IF '),Buffer.from([0xe3,0x1d]),Buffer.from('";123:\' GOTO 20\r\n')]);
  const ui=setup(original);try{
    const mirror=ui.$('mirror');
    assert.equal(mirror.querySelector('.syntax-keyword').textContent,'PRINT');
    assert.equal(mirror.querySelector('.syntax-number').textContent,'123');
    assert.equal(mirror.querySelector('.syntax-comment').textContent,"' GOTO 20");
    assert.ok(mirror.querySelector('.syntax-string .special'));
    assert.ok(mirror.querySelector('.syntax-string .control'));
    assert.deepEqual([...mirror.querySelectorAll('.source-line')].map(line=>line.textContent),ui.editor.value.split('\n'));
    assert.deepEqual(await ui.save(),original);
    ui.editor.setSelectionRange(3,8);ui.type('REM');
    assert.equal(mirror.querySelector('.syntax-keyword'),null);
    assert.ok(mirror.querySelector('.syntax-comment').textContent.startsWith('REM'));
    await ui.command('undo');
    assert.equal(mirror.querySelector('.syntax-keyword').textContent,'PRINT');
    assert.deepEqual(await ui.save(),original);
  }finally{ui.dom.window.close();}
});
test('new display defaults are 2x with soft wrap; zoom supports 1x through 4x without changing bytes',async()=>{
  const ui=setup();try{
    assert.equal(ui.$('scale').value,'2');assert.equal(ui.$('word-wrap').checked,true);assert.equal(ui.editor.wrap,'soft');
    assert.equal(ui.w.document.documentElement.style.getPropertyValue('--cell'),'16px');
    assert.equal(ui.w.document.documentElement.style.getPropertyValue('--line-height'),'20px');
    await ui.command('zoom-out');assert.equal(ui.$('scale').value,'1');
    await ui.command('zoom-out');assert.equal(ui.$('scale').value,'1');
    assert.equal(ui.w.document.documentElement.style.getPropertyValue('--cell'),'8px');
    for(let i=0;i<5;i++)await ui.command('zoom-in');assert.equal(ui.$('scale').value,'4');
    assert.deepEqual(await ui.save(),fixture);
  }finally{ui.dom.window.close();}
});
test('loading a font commits only after validation and preserves text, selection and dirty state',async()=>{
  let committed=null;const data=Array.from(require('../src/font-builder.cjs').buildFontFromRom(Buffer.alloc(2048)));
  const ui=setup(fixture,{desktop:{async chooseFont(){return {name:'FNT0808.X1',data,token:'candidate'};},async commitFont(token){committed=token;return true;}}});
  try{
    ui.editor.setSelectionRange(27,43);await ui.command('font-load');
    assert.equal(committed,'candidate');assert.equal(ui.$('font-name').textContent,'FNT0808.X1');assert.equal(ui.faces.size,1);
    assert.equal(ui.editor.selectionStart,27);assert.equal(ui.editor.selectionEnd,43);
    assert.equal(ui.dirty,false);assert.deepEqual(await ui.save(),fixture);
  }finally{ui.dom.window.close();}
});
test('saved font is restored on startup, cancel keeps it, and built-in reset clears it',async()=>{
  let reset=false;const data=Array.from(require('../src/font-builder.cjs').buildFontFromRom(Buffer.alloc(2048)));
  const ui=setup(fixture,{desktop:{async currentFont(){return {name:'saved.X1',data};},async chooseFont(){return null;},async resetFont(){reset=true;return true;}}});
  try{
    await new Promise(resolve=>setImmediate(resolve));assert.equal(ui.$('font-name').textContent,'saved.X1');
    await ui.command('font-load');assert.equal(ui.$('font-name').textContent,'saved.X1');assert.equal(ui.faces.size,1);
    await ui.command('font-reset');assert.equal(reset,true);assert.equal(ui.$('font-name').textContent,'内蔵フォント');assert.equal(ui.faces.size,0);
    assert.equal(ui.w.document.documentElement.style.getPropertyValue('--x1-font'),'X1');assert.deepEqual(await ui.save(),fixture);
  }finally{ui.dom.window.close();}
});
test('font rendering or persistence failure leaves the active font and document unchanged',async()=>{
  for(const failFont of [false,true]){
    let commits=0;
    const ui=setup(fixture,{failFont,desktop:{async chooseFont(){return {name:'bad.X1',data:[1,2,3],token:'candidate'};},async commitFont(){commits++;return false;}}});
    try{
      await ui.command('font-load');assert.equal(commits,failFont?0:1);assert.equal(ui.faces.size,0);
      assert.equal(ui.$('font-name').textContent,'内蔵フォント');assert.deepEqual(await ui.save(),fixture);
    }finally{ui.dom.window.close();}
  }
});

const pcgHex='80402010080402010102040810204080AA55AA55AA55AA55';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('PCG setup fills 16x16 grid and switches fonts without changing selection, bytes or dirty state',async()=>{
  const original=Buffer.from(`7010 DEFCHR$(65)=HEXCHR$("${pcgHex}")\r\n7020 DEFCHR$(66)=STRING$(24,255)\r\n`);
  const ui=setup(original);try{
    ui.editor.select();const end=ui.editor.selectionEnd;await ui.command('pcg-setup');
    assert.equal(ui.$('pcg-grid').querySelectorAll('button').length,256);
    assert.equal(ui.$('pcg-grid').querySelectorAll('button.defined').length,2);
    assert.equal(ui.$('pcg-hex').value,pcgHex);assert.equal(ui.$('pcg-enabled').checked,true);
    assert.equal(ui.$('pcg-order').value,'BRG');assert.equal(ui.$('pcg-panel').hidden,false);
    assert.equal(ui.faces.size,1);assert.match(ui.w.document.documentElement.style.getPropertyValue('--x1-font'),/^X1Custom/);
    assert.equal(ui.editor.selectionStart,0);assert.equal(ui.editor.selectionEnd,end);
    assert.equal(ui.dirty,false);assert.deepEqual(await ui.save(),original);
    ui.$('pcg-enabled').checked=false;ui.$('pcg-enabled').dispatchEvent(new ui.w.Event('change'));await settle();
    assert.equal(ui.faces.size,0);assert.equal(ui.w.document.documentElement.style.getPropertyValue('--x1-font'),'X1');
    assert.equal(ui.$('pcg-grid').querySelectorAll('button.defined').length,2);
    ui.$('pcg-enabled').checked=true;ui.$('pcg-enabled').dispatchEvent(new ui.w.Event('change'));await settle();assert.equal(ui.faces.size,1);
    ui.$('pcg-remove').click();await settle();assert.equal(ui.$('pcg-count').textContent,'1 / 256 文字を定義');
    ui.$('pcg-clear').click();await settle();assert.equal(ui.$('pcg-count').textContent,'0 / 256 文字を定義');assert.equal(ui.faces.size,0);
  }finally{ui.dom.window.close();}
});

test('PCG DATA import previews assignment, rejects overflow and supports interleaved BRG',async()=>{
  const original=Buffer.from(`10 DATA "${pcgHex}","${'AA55FF'.repeat(8)}"\r\n`);
  const ui=setup(original);try{
    ui.editor.select();await ui.command('pcg-setup');assert.equal(ui.$('pcg-import-dialog').open,true);
    assert.equal(ui.$('pcg-count').textContent,'0 / 256 文字を定義');
    ui.$('pcg-start').value='255';ui.$('pcg-start').dispatchEvent(new ui.w.Event('input'));
    assert.equal(ui.$('pcg-import-confirm').disabled,true);assert.match(ui.$('pcg-import-error').textContent,/255/);
    ui.$('pcg-start').value='&HC8';ui.$('pcg-start').dispatchEvent(new ui.w.Event('input'));
    ui.$('pcg-import-layout').value='interleaved';ui.$('pcg-import-layout').dispatchEvent(new ui.w.Event('change'));
    assert.equal(ui.$('pcg-import-preview').querySelectorAll('figure').length,2);
    ui.$('pcg-import-confirm').click();await settle();
    assert.equal(ui.$('pcg-import-dialog').open,false);assert.equal(ui.$('pcg-layout').value,'interleaved');
    assert.equal(ui.$('pcg-grid').querySelectorAll('button.defined').length,2);
    assert.deepEqual(await ui.save(),original);ui.editor.setSelectionRange(ui.editor.value.length,ui.editor.value.length);
    ui.w.document.querySelector('[data-pcg-code="201"]').click();assert.equal(ui.$('pcg-hex').value,'AA55FF'.repeat(8));
    assert.match(decodeURIComponent(ui.$('pcg-preview').src),/#00ffff/);assert.deepEqual(await ui.save(),Buffer.concat([original,Buffer.from([201])]));
  }finally{ui.dom.window.close();}
});

test('PCG cancel leaves state untouched; format choices and definitions survive a new document',async()=>{
  const calls=[],ui=setup(Buffer.from(`10 DATA "${pcgHex}"`),{desktop:{async pcgFont(p){calls.push(p);return [0];}}});
  try{
    ui.editor.select();await ui.command('pcg-setup');ui.$('pcg-import-dialog').close();
    assert.equal(ui.$('pcg-count').textContent,'0 / 256 文字を定義');assert.equal(calls.length,0);
    ui.editor.select();await ui.command('pcg-setup');ui.$('pcg-import-confirm').click();await settle();
    ui.$('pcg-order').value='RGB';ui.$('pcg-order').dispatchEvent(new ui.w.Event('change'));await settle();
    assert.equal(calls.at(-1).order,'RGB');assert.equal(calls.at(-1).entries[0].hex,pcgHex);
    await ui.command('new');assert.equal(ui.editor.value,'');assert.equal(ui.$('pcg-enabled').checked,true);
    assert.equal(ui.$('pcg-order').value,'RGB');assert.equal(ui.$('pcg-grid').querySelectorAll('button.defined').length,1);assert.equal(ui.faces.size,1);
  }finally{ui.dom.window.close();}
});

test('PCG font generation can finish after changing documents and retains the definition',async()=>{
  let resolveFont;
  const ui=setup(Buffer.from(`10 DEFCHR$(65)=HEXCHR$("${pcgHex}")`),{desktop:{pcgFont(){return new Promise(resolve=>{resolveFont=resolve;});}}});
  try{
    ui.editor.select();const pending=ui.command('pcg-setup');await settle();await ui.command('new');
    resolveFont([0]);await pending;
    assert.equal(ui.faces.size,1);assert.equal(ui.$('pcg-count').textContent,'1 / 256 文字を定義');assert.equal(ui.editor.value,'');
  }finally{ui.dom.window.close();}
});

test('PCG font failure retains inspectable definitions, restores base display and shows error',async()=>{
  const ui=setup(Buffer.from(`10 DEFCHR$(65)=HEXCHR$("${pcgHex}")`),{desktop:{async pcgFont(){throw Error('test font failure');}}});
  try{
    ui.editor.select();await ui.command('pcg-setup');assert.equal(ui.$('pcg-enabled').checked,false);
    assert.equal(ui.$('pcg-count').textContent,'1 / 256 文字を定義');assert.equal(ui.faces.size,0);
    assert.match(ui.$('notice').textContent,/test font failure/);assert.equal(ui.$('notice').classList.contains('error'),true);
    assert.equal(ui.w.document.documentElement.style.getPropertyValue('--x1-font'),'X1');
  }finally{ui.dom.window.close();}
});

test('PCG overlay rebuilds on custom font changes and OFF restores the selected base font',async()=>{
  const data=Array.from(require('../src/font-builder.cjs').buildFontFromRom(Buffer.alloc(2048)));
  const ui=setup(Buffer.from(`10 DEFCHR$(65)=HEXCHR$("${pcgHex}")`),{desktop:{
    async chooseFont(){return {name:'custom.X1',data,token:'test'};},async commitFont(){return true;},async resetFont(){return true;}
  }});
  try{
    ui.editor.select();await ui.command('pcg-setup');await ui.command('font-load');await settle();
    assert.equal(ui.faces.size,2);assert.equal(ui.$('font-name').textContent,'custom.X1');
    const overlay=ui.w.document.documentElement.style.getPropertyValue('--x1-font');
    assert.notEqual(ui.w.document.documentElement.style.getPropertyValue('--x1-base-font'),overlay);
    ui.$('pcg-strings-only').checked=false;ui.$('pcg-strings-only').dispatchEvent(new ui.w.Event('change'));
    assert.equal(ui.$('text-area').classList.contains('pcg-strings-only'),false);
    ui.$('pcg-strings-only').checked=true;ui.$('pcg-strings-only').dispatchEvent(new ui.w.Event('change'));
    assert.equal(ui.$('text-area').classList.contains('pcg-strings-only'),true);
    assert.equal(ui.w.document.documentElement.style.getPropertyValue('--x1-font'),overlay);assert.equal(ui.faces.size,2);
    ui.$('pcg-enabled').checked=false;ui.$('pcg-enabled').dispatchEvent(new ui.w.Event('change'));await settle();
    const [baseFace]=ui.faces;assert.equal(ui.faces.size,1);
    assert.equal(ui.w.document.documentElement.style.getPropertyValue('--x1-font'),baseFace.family);
    ui.$('pcg-enabled').checked=true;ui.$('pcg-enabled').dispatchEvent(new ui.w.Event('change'));await settle();
    await ui.command('font-reset');await settle();assert.equal(ui.faces.size,1);assert.equal(ui.$('pcg-enabled').checked,true);
    ui.$('pcg-enabled').checked=false;ui.$('pcg-enabled').dispatchEvent(new ui.w.Event('change'));await settle();
    assert.equal(ui.faces.size,0);assert.equal(ui.w.document.documentElement.style.getPropertyValue('--x1-font'),'X1');
  }finally{ui.dom.window.close();}
});

test('PCG defaults to quoted strings only and switches scope without touching bytes or selection',async()=>{
  const original=Buffer.from(`10 PRINT "A":A=1:' "A"\r\n20 DATA "A",A\r\n30 REM "A"\r\n40 PRINT "A`);
  const ui=setup(original);try{
    assert.equal(ui.$('pcg-strings-only').checked,true);assert.equal(ui.$('text-area').classList.contains('pcg-strings-only'),true);
    const marked=[...ui.$('mirror').querySelectorAll('.pcg-string')];
    assert.deepEqual(marked.map(span=>span.textContent),['A','A','A']);
    assert.equal(ui.$('mirror').querySelectorAll('.syntax-comment .pcg-string').length,0);
    assert.ok(marked.every(span=>span.closest('.syntax-string')));
    const style=ui.w.document.createElement('style');style.textContent=fs.readFileSync(path.join(base,'style.css'),'utf8');ui.w.document.head.append(style);
    assert.equal(ui.w.getComputedStyle(ui.$('mirror')).fontFamily,'var(--x1-base-font,X1),monospace');
    assert.equal(ui.w.getComputedStyle(marked[0]).fontFamily,'var(--x1-font),monospace');
    ui.editor.setSelectionRange(3,8);
    ui.$('pcg-strings-only').checked=false;ui.$('pcg-strings-only').dispatchEvent(new ui.w.Event('change'));
    assert.equal(ui.$('text-area').classList.contains('pcg-strings-only'),false);
    assert.equal(ui.editor.selectionStart,3);assert.equal(ui.editor.selectionEnd,8);
    assert.equal(ui.dirty,false);assert.deepEqual(await ui.save(),original);
    ui.$('pcg-strings-only').checked=true;ui.$('pcg-strings-only').dispatchEvent(new ui.w.Event('change'));
    assert.equal(ui.$('text-area').classList.contains('pcg-strings-only'),true);
    ui.editor.setSelectionRange(9,12);ui.type('A');
    assert.equal(ui.$('mirror').querySelector('.source-line').querySelector('.pcg-string'),null);
    await ui.command('undo');assert.deepEqual(await ui.save(),original);
  }finally{ui.dom.window.close();}
});

test('PCG definitions, layout, order, disabled display and scope survive opening another BASIC file',async()=>{
  const program=Buffer.from('10 PRINT "A"\r\n');
  const ui=setup(Buffer.from(`10 DEFCHR$(65)=HEXCHR$("${pcgHex}")`),{desktop:{async open(){return {name:'program.bas',bytes:Array.from(program)};}}});
  try{
    ui.editor.select();await ui.command('pcg-setup');
    ui.$('pcg-layout').value='interleaved';ui.$('pcg-layout').dispatchEvent(new ui.w.Event('change'));
    ui.$('pcg-order').value='RGB';ui.$('pcg-order').dispatchEvent(new ui.w.Event('change'));await settle();
    ui.$('pcg-enabled').checked=false;ui.$('pcg-enabled').dispatchEvent(new ui.w.Event('change'));
    ui.$('pcg-strings-only').checked=false;ui.$('pcg-strings-only').dispatchEvent(new ui.w.Event('change'));
    await ui.command('open');
    assert.equal(ui.editor.value,program.toString('ascii').replaceAll('\r\n','\n'));assert.equal(ui.$('pcg-count').textContent,'1 / 256 文字を定義');
    assert.equal(ui.$('pcg-layout').value,'interleaved');assert.equal(ui.$('pcg-order').value,'RGB');
    assert.equal(ui.$('pcg-enabled').checked,false);assert.equal(ui.$('pcg-strings-only').checked,false);
    ui.$('pcg-enabled').checked=true;ui.$('pcg-enabled').dispatchEvent(new ui.w.Event('change'));await settle();assert.equal(ui.faces.size,1);
    assert.equal(ui.dirty,false);assert.deepEqual(await ui.save(),program);
    const fresh=setup();try{assert.equal(fresh.$('pcg-count').textContent,'0 / 256 文字を定義');assert.equal(fresh.$('pcg-strings-only').checked,true);}finally{fresh.dom.window.close();}
  }finally{ui.dom.window.close();}
});

test('PCG grid inserts exact codes, replaces a selection and supports undo with mixed newlines',async()=>{
  const original=Buffer.from('10 DEFCHR$(0)=STRING$(24,255):DEFCHR$(255)=STRING$(24,255)\r\n20 PRINT "AB"\n');
  const ui=setup(original);try{
    ui.editor.select();await ui.command('pcg-setup');
    const at=ui.editor.value.indexOf('AB');ui.editor.setSelectionRange(at,at+2);
    ui.w.document.querySelector('[data-pcg-code="255"]').click();
    const expected=Buffer.concat([original.subarray(0,at+1),Buffer.from([255]),original.subarray(at+3)]); // CRLF is one extra byte before AB.
    assert.deepEqual(await ui.save(),expected);assert.equal(ui.w.document.activeElement,ui.editor);
    assert.equal(ui.$('pcg-code').textContent,'$FF / 255');
    await ui.command('undo');assert.deepEqual(await ui.save(),original);
    ui.editor.setSelectionRange(0,0);ui.w.document.querySelector('[data-pcg-code="0"]').click();
    assert.deepEqual(await ui.save(),Buffer.concat([Buffer.from([0]),original]));
    await ui.command('undo');assert.deepEqual(await ui.save(),original);
  }finally{ui.dom.window.close();}
});

test('clearing PCG still cancels pending font results after definitions become session state',async()=>{
  let resolveFont;
  const ui=setup(Buffer.from(`10 DEFCHR$(65)=HEXCHR$("${pcgHex}")`),{desktop:{pcgFont(){return new Promise(resolve=>{resolveFont=resolve;});}}});
  try{
    ui.editor.select();const pending=ui.command('pcg-setup');await settle();ui.$('pcg-clear').click();resolveFont([0]);await pending;
    assert.equal(ui.faces.size,0);assert.equal(ui.$('pcg-enabled').checked,false);assert.equal(ui.$('pcg-count').textContent,'0 / 256 文字を定義');
  }finally{ui.dom.window.close();}
});

test('PCG selection highlights the actual mirror glyphs and follows replacement, focus and collapse',async()=>{
  const original=Buffer.from(`10 DEFCHR$(65)=STRING$(24,255)\r\n20 PRINT "AB"\r\n30 PRINT "BA"\n`);
  const ui=setup(original);try{
    ui.editor.select();await ui.command('pcg-setup');
    const at=ui.editor.value.indexOf('AB');ui.editor.setSelectionRange(at,at+2);ui.editor.dispatchEvent(new ui.w.Event('select'));
    assert.equal(ui.$('text-area').classList.contains('mirror-selection'),true);
    let [range]=ui.highlights.get('x1-selection');assert.equal(range.toString(),'AB');
    assert.equal(range.startContainer.parentElement.classList.contains('pcg-string'),true);
    assert.equal(range.startContainer.parentElement.closest('#mirror'),ui.$('mirror'));
    assert.equal(ui.$('pcg-strings-only').checked,true);
    const end=ui.editor.value.indexOf('BA')+2;
    ui.editor.setSelectionRange(at,end);ui.w.document.dispatchEvent(new ui.w.Event('selectionchange'));
    [range]=ui.highlights.get('x1-selection');assert.equal(range.toString(),'AB"30 PRINT "BA');
    await ui.command('find');assert.equal(ui.w.document.activeElement,ui.$('find-text'));assert.equal(ui.highlights.has('x1-selection'),false);
    ui.editor.focus();assert.equal(ui.highlights.has('x1-selection'),true);
    ui.editor.setSelectionRange(at,at+2);ui.type('BA');
    assert.equal(ui.highlights.has('x1-selection'),false);
    await ui.command('undo');assert.deepEqual(await ui.save(),original);
    [range]=ui.highlights.get('x1-selection');assert.equal(range.toString(),'AB');
    assert.ok(ui.$('mirror').contains(range.startContainer)); // Must not retain detached nodes after render.
    ui.editor.setSelectionRange(at,at);ui.editor.dispatchEvent(new ui.w.Event('select'));
    assert.equal(ui.highlights.has('x1-selection'),false);
  }finally{ui.dom.window.close();}
});

test('selection at blank lines and EOF is valid and unsupported highlight engines keep native selection',async()=>{
  const ui=setup(Buffer.from('A\r\n\r\nB\r\n'));try{
    ui.editor.focus();ui.editor.setSelectionRange(2,5);ui.editor.dispatchEvent(new ui.w.Event('select'));
    const [range]=ui.highlights.get('x1-selection');assert.equal(range.toString(),'B');
    assert.ok(ui.$('mirror').contains(range.endContainer));
  }finally{ui.dom.window.close();}
  const fallback=setup(Buffer.from('ABC'),{noHighlights:true});try{
    fallback.editor.select();fallback.editor.dispatchEvent(new fallback.w.Event('select'));
    assert.equal(fallback.$('text-area').classList.contains('mirror-selection'),false);
    assert.deepEqual(await fallback.save(),Buffer.from('ABC'));
  }finally{fallback.dom.window.close();}
});

test('browser-only host can load, edit, save and generate PCG fonts without desktop or Node',async()=>{
  const original=Buffer.from(`10 DEFCHR$(65)=STRING$(24,255)\r\n20 PRINT "A"\n`);
  const events=[];
  const ui=setup(original,{hostOnly:true,desktop:{contentChanged:payload=>events.push(payload)}});
  try{
    assert.equal(ui.w.desktop,undefined);assert.equal(ui.w.Buffer,undefined);assert.equal(ui.w.require,undefined);
    const bitmap=JSON.parse(JSON.stringify(require('../assets/x1-font.json')));
    ui.w.X1Host.pcgFont=p=>ui.w.X1FontBuilder.buildFont(bitmap,p.entries,p.order,p.layout);
    ui.editor.select();await ui.command('pcg-setup');assert.equal(ui.faces.size,1);
    assert.equal(events.length,2);assert.equal(events[0].bytes.length,0);assert.deepEqual(Buffer.from(events[1].bytes),original);
    ui.editor.setSelectionRange(0,0);ui.type('1');assert.equal(events.at(-1).dirty,true);
    assert.deepEqual(await ui.save(),Buffer.concat([Buffer.from('1'),original]));
    assert.equal(ui.dirty,false);assert.equal(events.length,3);
    await ui.command('new');assert.equal(ui.editor.value,'');assert.equal(events.at(-1).bytes.length,0);
  }finally{ui.dom.window.close();}
});

test('contentChanged covers edits, undo/redo, load/new/open and suppresses byte-equal and display changes',async()=>{
  const original=Buffer.from([65,13,10,0,0x87,10,66,13]);
  const events=[],ui=setup(original,{desktop:{contentChanged:p=>events.push({bytes:Buffer.from(p.bytes),dirty:p.dirty}),
    async confirmDirty(){return 'discard';},async open(){return {bytes:[90]};}}});
  try{
    assert.equal(events.length,2);assert.deepEqual(events[1],{bytes:original,dirty:false});
    ui.load({bytes:Array.from(original)});assert.equal(events.length,2); // Different array, identical bytes.
    ui.editor.setSelectionRange(0,1);ui.type('A');assert.equal(events.length,2);
    ui.editor.setSelectionRange(0,1);ui.type('Z');assert.equal(events.length,3);assert.equal(events.at(-1).dirty,true);
    await ui.command('undo');assert.deepEqual(events.at(-1),{bytes:original,dirty:false});
    await ui.command('redo');assert.equal(events.length,5);
    await ui.save();assert.equal(events.length,5);assert.equal(ui.dirty,false);
    ui.editor.setSelectionRange(0,1);ui.type('漢');assert.equal(events.length,5);
    ui.$('word-wrap').click();await ui.command('zoom-in');ui.editor.dispatchEvent(new ui.w.Event('select'));
    ui.w.document.querySelector('[data-sidebar="pcg"]').click();assert.equal(events.length,5);
    ui.editor.setSelectionRange(0,1);ui.type('Z');assert.equal(events.length,5); // Byte-equal replacement.
    await ui.command('new');assert.equal(events.length,6);assert.equal(events.at(-1).bytes.length,0);
    await ui.command('open');assert.equal(events.length,7);assert.deepEqual(events.at(-1),{bytes:Buffer.from('Z'),dirty:false});
    ui.load({bytes:Array.from({length:256},(_,i)=>i)});assert.deepEqual(events.at(-1).bytes,Buffer.from(Array.from({length:256},(_,i)=>i)));
  }finally{ui.dom.window.close();}
});

test('contentChanged reports IME, palette, paste/cut and replace-all with isolated snapshots',async()=>{
  const events=[],ui=setup(Buffer.from('ABAB\r\n'),{desktop:{contentChanged:p=>{events.push(Buffer.from(p.bytes));p.bytes.fill(255);}}});
  try{
    assert.deepEqual(await ui.save(),Buffer.from('ABAB\r\n'));
    ui.editor.setSelectionRange(0,0);ui.w.document.querySelector('[data-code="135"]').click();
    assert.equal(events.at(-1)[0],135);await ui.command('undo');
    ui.editor.setSelectionRange(0,0);ui.editor.dispatchEvent(new ui.w.CompositionEvent('compositionstart'));
    ui.editor.setRangeText('ガ',0,0,'end');ui.editor.dispatchEvent(new ui.w.CompositionEvent('compositionend'));
    assert.deepEqual(events.at(-1).subarray(0,2),Buffer.from([0xb6,0xde]));await ui.command('undo');
    const clipboardData={setData(){},getData:type=>type==='text/plain'?'C':''};
    function clipboard(type){const event=new ui.w.Event(type,{cancelable:true});Object.defineProperty(event,'clipboardData',{value:clipboardData});ui.editor.dispatchEvent(event);}
    ui.editor.setSelectionRange(0,1);clipboard('cut');assert.deepEqual(events.at(-1),Buffer.from('BAB\r\n'));
    clipboard('paste');assert.deepEqual(events.at(-1),Buffer.from('CBAB\r\n'));await ui.command('undo');await ui.command('undo');
    ui.$('find-text').value='AB';ui.$('replace-text').value='Z';ui.$('replace-all').click();assert.deepEqual(events.at(-1),Buffer.from('ZZ\r\n'));
    assert.deepEqual(await ui.save(),Buffer.from('ZZ\r\n'));await ui.command('undo');assert.deepEqual(await ui.save(),Buffer.from('ABAB\r\n'));
  }finally{ui.dom.window.close();}
});

test('throwing and rejecting content callbacks cannot prevent rendering, subsequent edits or save',async()=>{
  for(const asynchronous of [false,true]){
    let calls=0;
    const ui=setup(Buffer.from('A'),{desktop:{contentChanged(){calls++;if(asynchronous)return Promise.reject(Error('host failure'));throw Error('host failure');}}});
    try{
      await settle();assert.equal(ui.editor.value,'A');assert.match(ui.$('notice').textContent,/host failure/);
      ui.editor.setSelectionRange(0,1);ui.type('B');await settle();assert.equal(calls,3);
      assert.deepEqual(await ui.save(),Buffer.from('B'));assert.equal(ui.dirty,false);
    }finally{ui.dom.window.close();}
  }
});

test('import/export presentation hides New and Save As only for preconfigured hosts',async()=>{
  for(const hostOnly of [false,true]){
    const calls=[],original=Buffer.from([65,13,10,0x87]);
    const ui=setup(original,{hostOnly,styles:true,desktop:{
      async open(){calls.push('open');return {bytes:[66]};},
      async save(payload){calls.push({bytes:payload.bytes,saveAs:payload.saveAs});return true;}
    }});
    try{
      const button=name=>ui.w.document.querySelector(`[data-command="${name}"]`);
      for(const name of ['new','save-as']){
        assert.equal(button(name).hidden,hostOnly);
        assert.equal(ui.w.getComputedStyle(button(name)).display==='none',hostOnly);
      }
      assert.equal(button('open').textContent,'インポート…');assert.equal(button('save').textContent,'エクスポート');
      assert.notEqual(ui.w.getComputedStyle(button('open')).display,'none');assert.notEqual(ui.w.getComputedStyle(ui.$('sidebar-toggle')).display,'none');
      button('save').click();await settle();assert.deepEqual(Array.from(calls[0].bytes),Array.from(original));assert.equal(calls[0].saveAs,false);
      button('open').click();await settle();assert.equal(calls[1],'open');assert.equal(ui.editor.value,'B');
      if(!hostOnly){button('save-as').click();await settle();assert.equal(calls.at(-1).saveAs,true);button('new').click();await settle();assert.equal(ui.editor.value,'');}
      else {await ui.command('save-as');assert.equal(calls.at(-1).saveAs,true);await ui.command('new');assert.equal(ui.editor.value,'');}
    }finally{ui.dom.window.close();}
  }
});

test('sidebar collapse reflows wrapped rows directly with and without ResizeObserver without editing',async()=>{
  for(const resizeObserver of [false,true]){
    const changes=[],original=Buffer.from('ABCDEFGHIJKL\r\nB'),ui=setup(original,{styles:true,resizeObserver,desktop:{contentChanged:p=>changes.push(p)}});
    try{
      ui.editor.style.fontSize='24px';ui.editor.style.lineHeight='30px';
      Object.defineProperty(ui.editor,'clientWidth',{get:()=>ui.$('sidebar').hidden?324:132});
      ui.$('word-wrap').dispatchEvent(new ui.w.Event('change'));assert.equal(ui.$('line-numbers').textContent,'1\n↪\n↪\n2');
      ui.editor.setSelectionRange(2,5);const before=changes.length;ui.$('sidebar-toggle').click();
      assert.equal(ui.$('sidebar').hidden,true);assert.equal(ui.$('sidebar-resizer').hidden,true);
      assert.equal(ui.$('mirror').style.width,'324px');assert.equal(ui.$('line-numbers').textContent,'1\n2');
      ui.$('sidebar-toggle').click();assert.equal(ui.$('mirror').style.width,'132px');assert.equal(ui.$('line-numbers').textContent,'1\n↪\n↪\n2');
      assert.equal(ui.editor.selectionStart,2);assert.equal(ui.editor.selectionEnd,5);assert.equal(ui.dirty,false);assert.equal(changes.length,before);
      ui.type('Z');await ui.command('undo');assert.deepEqual(await ui.save(),original);
      ui.editor.setSelectionRange(0,1);ui.type('Z');const editedChanges=changes.length;
      ui.$('sidebar-toggle').click();ui.$('sidebar-toggle').click();
      assert.equal(ui.dirty,true);assert.equal(changes.length,editedChanges);
      await ui.command('undo');assert.deepEqual(await ui.save(),original);
    }finally{ui.dom.window.close();}
  }
});

test('PCG tab, definitions and display settings survive collapsing without content notifications',async()=>{
  const original=Buffer.from('10 DEFCHR$(65)=STRING$(24,255)\r\n'),changes=[];
  const ui=setup(original,{desktop:{contentChanged:p=>changes.push(p)}});
  try{
    ui.editor.select();await ui.command('pcg-setup');const before=changes.length;
    const font=ui.w.document.documentElement.style.getPropertyValue('--x1-font');
    ui.$('sidebar-toggle').click();assert.equal(ui.$('sidebar').hidden,true);
    await ui.command('pcg-setup');assert.equal(ui.$('sidebar').hidden,true);assert.equal(ui.$('pcg-panel').hidden,false);
    ui.$('sidebar-toggle').click();assert.equal(ui.$('sidebar').hidden,false);assert.equal(ui.$('pcg-enabled').checked,true);
    assert.equal(ui.$('pcg-count').textContent,'1 / 256 文字を定義');assert.equal(ui.$('pcg-strings-only').checked,true);
    assert.equal(ui.faces.size,1);assert.ok(font);assert.equal(ui.dirty,false);assert.equal(changes.length,before);assert.deepEqual(await ui.save(),original);
  }finally{ui.dom.window.close();}
});

const hoverFixture=Buffer.concat([
  Buffer.from(Array.from({length:6},(_,i)=>'10'+i+' DEFCHR$('+(128+i)+')=STRING$(24,255)\r\n').join('')),
  Buffer.from('200 B$="'),Buffer.from([128,129,130,31,29,29,29,131,132,133]),Buffer.from('":C$="'),
  Buffer.from([128]),Buffer.from('":REM "fake quoted PCG"\n210 PRINT "unterminated')
]);
async function hoverSetup(bytes=hoverFixture,register=true){
  const events=[],ui=setup(bytes,{styles:true,desktop:{contentChanged:p=>events.push(p)}});
  if(register){ui.editor.select();await ui.command('pcg-setup');}await settle();
  const drawn=[],ctx={fillRect(){},fillText(text){drawn.push({text,color:this.fillStyle});}};ui.$('pcg-string-image').getContext=()=>ctx;
  const lines=[...ui.$('mirror').querySelectorAll('.source-line')],literals=[...ui.$('mirror').querySelectorAll('.pcg-literal')];
  const rect=(left,top,right,bottom)=>({left,top,right,bottom,width:right-left,height:bottom-top});
  lines.forEach((line,index)=>{line.getBoundingClientRect=()=>rect(0,index*20,500,index*20+20);});
  const row=lines.indexOf(literals[0].closest('.source-line')),y=row*20;
  literals[0].getClientRects=()=>[rect(10,y,170,y+16),rect(10,y+20,70,y+36)];
  literals[1].getClientRects=()=>[rect(200,y+20,240,y+36)];
  // The first literal is deliberately wrapped in this geometry fixture.
  lines[row].getBoundingClientRect=()=>rect(0,y,500,y+40);
  lines.slice(row+1).forEach((line,index)=>{line.getBoundingClientRect=()=>rect(0,y+40+index*20,500,y+60+index*20);});
  ui.editor.getBoundingClientRect=()=>rect(0,0,500,600);
  let timer,next=1000000,time=0;
  const nativeSet=ui.w.setTimeout.bind(ui.w),nativeClear=ui.w.clearTimeout.bind(ui.w);
  ui.w.setTimeout=(fn,delay,...args)=>delay===600?(timer={id:++next,fn,due:time+delay}).id:nativeSet(fn,delay,...args);
  ui.w.clearTimeout=id=>{if(timer?.id===id)timer=null;else nativeClear(id);};
  ui.hover=(x=20,vertical=y+5)=>ui.editor.dispatchEvent(new ui.w.MouseEvent('mousemove',{clientX:x,clientY:vertical}));
  ui.tick=async(ms=600)=>{time+=ms;if(timer&&timer.due<=time){const fn=timer.fn;timer=null;fn();}await settle();};
  return Object.assign(ui,{events,literals,y,drawn});
}
test('renderer hover uses exact inner byte ranges for each wrapped literal and leaves bytes, selection and notifications intact',async()=>{
  const ui=await hoverSetup();try{
    assert.equal(ui.literals.length,2,'comments and unterminated strings are not targets');
    ui.editor.setSelectionRange(10,12);const before=ui.events.length;
    ui.hover(20,ui.y+25);await ui.tick(599);assert.equal(ui.$('pcg-string-preview').hidden,true);
    await ui.tick(1);assert.equal(ui.$('pcg-string-preview').hidden,false);
    assert.equal(ui.$('pcg-string-image').width,24);assert.equal(ui.$('pcg-string-image').height,16);
    assert.equal(ui.editor.selectionStart,10);assert.equal(ui.editor.selectionEnd,12);assert.equal(ui.dirty,false);assert.equal(ui.events.length,before);
    ui.hover(210,ui.y+25);assert.equal(ui.$('pcg-string-preview').hidden,true);await ui.tick();
    assert.equal(ui.$('pcg-string-image').width,8);assert.equal(ui.$('pcg-string-image').height,8);
    assert.deepEqual(await ui.save(),hoverFixture);assert.equal(ui.$('pcg-string-preview').hidden,true);
    ui.editor.setSelectionRange(0,1);ui.type('2');await ui.command('undo');assert.deepEqual(await ui.save(),hoverFixture);
  }finally{ui.dom.window.close();}
});
test('renderer cancels pending or shown hover on scope, PCG, layout, render and command changes',async()=>{
  const ui=await hoverSetup();try{
    ui.hover();await ui.tick();assert.equal(ui.$('pcg-string-preview').hidden,false);
    ui.$('pcg-strings-only').checked=false;ui.$('pcg-strings-only').dispatchEvent(new ui.w.Event('change'));
    assert.equal(ui.$('pcg-string-preview').hidden,true);ui.hover();await ui.tick();assert.equal(ui.$('pcg-string-preview').hidden,false);
    ui.$('pcg-strings-only').checked=true;ui.$('pcg-strings-only').dispatchEvent(new ui.w.Event('change'));
    ui.hover();ui.$('pcg-order').value='RGB';ui.$('pcg-order').dispatchEvent(new ui.w.Event('change'));await ui.tick();assert.equal(ui.$('pcg-string-preview').hidden,true);
    await settle();ui.hover();await ui.tick();assert.equal(ui.$('pcg-string-preview').hidden,false);
    ui.$('sidebar-toggle').click();assert.equal(ui.$('pcg-string-preview').hidden,true);
    ui.hover();ui.$('pcg-enabled').checked=false;ui.$('pcg-enabled').dispatchEvent(new ui.w.Event('change'));await ui.tick();assert.equal(ui.$('pcg-string-preview').hidden,true);
    ui.hover();await ui.tick();assert.equal(ui.$('pcg-string-preview').hidden,false);
    ui.$('pcg-enabled').checked=true;ui.$('pcg-enabled').dispatchEvent(new ui.w.Event('change'));await settle();
    ui.hover();await ui.command('new');await ui.tick();assert.equal(ui.$('pcg-string-preview').hidden,true);assert.equal(ui.editor.value,'');
  }finally{ui.dom.window.close();}
});
test('renderer previews ordinary-only strings without PCG registration or PCG ON',async()=>{
  const bytes=Buffer.concat([Buffer.from('200 B$="ABC'),Buffer.from([31,29,29,29]),Buffer.from('DEF":C$="Z"\r\n')]);
  const ui=await hoverSetup(bytes,false);try{
    assert.equal(ui.$('pcg-enabled').checked,false);assert.equal(ui.$('pcg-count').textContent,'0 / 256 文字を定義');
    ui.hover();await ui.tick();assert.equal(ui.$('pcg-string-preview').hidden,false);
    assert.equal(ui.$('pcg-string-image').width,24);assert.equal(ui.$('pcg-string-image').height,16);
    assert.deepEqual(ui.drawn.map(item=>item.text),['A','B','C','D','E','F']);assert.ok(ui.drawn.every(item=>item.color==='#FFFFFF'));
    assert.deepEqual(await ui.save(),bytes);
  }finally{ui.dom.window.close();}
});
