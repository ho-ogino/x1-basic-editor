'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { readDocument, atomicSave, MAX_BYTES } = require('./src/file-store.cjs');
const {buildFontFromRom,buildFont,parseFontRom} = require('./src/font-builder.cjs');
const {FontSettings} = require('./src/font-settings.cjs');
let win, current = null, dirty = false, allowClose = false, saving = false;
let pendingFont = null;
// A user action supersedes a pending command-line document load, even after Undo.
let documentRevision = 0;
const fontSettings = () => new FontSettings(path.join(app.getPath('userData'),'display-settings.json'),
  path.join(app.getPath('appData'),'X1 Byte Editor','display-settings.json'));
const command = name => win?.webContents.send('command', name);
function checkedBytes(value) {
  if (!Array.isArray(value) || value.length > MAX_BYTES || value.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw Error('不正なバイトデータです。');
  return Buffer.from(value);
}
async function errorBox(err) { await dialog.showMessageBox(win, { type:'error', message:'処理を完了できませんでした', detail:err.message }); }
function buildMenu() {
  const item = (label, accelerator, cmd) => ({ label, accelerator, click:() => command(cmd) });
  const menu = [
    ...(process.platform === 'darwin' ? [{role:'appMenu'}] : []),
    { label:'ファイル', submenu:[item('新規','CmdOrCtrl+N','new'), item('開く…','CmdOrCtrl+O','open'),
      item('保存','CmdOrCtrl+S','save'), item('名前を付けて保存…','CmdOrCtrl+Shift+S','save-as'),
      {type:'separator'}, item('閉じる','CmdOrCtrl+W','close')] },
    { label:'編集', submenu:[item('元に戻す','CmdOrCtrl+Z','undo'), item('やり直す','CmdOrCtrl+Shift+Z','redo'),
      {type:'separator'}, {role:'cut',label:'切り取り'},{role:'copy',label:'コピー'}, {role:'paste',label:'貼り付け'},
      {role:'selectAll',label:'すべて選択'}, {type:'separator'}, item('コード・記号名で挿入…','CmdOrCtrl+I','insert'),
      item('選択からPCG設定','CmdOrCtrl+Shift+P','pcg-setup')] },
    { label:'検索', submenu:[item('検索・置換','CmdOrCtrl+F','find'),item('次を検索','F3','find-next'),item('前を検索','Shift+F3','find-prev')] },
    { label:'表示', submenu:[item('拡大','CmdOrCtrl+Plus','zoom-in'),item('縮小','CmdOrCtrl+-','zoom-out'),
      {type:'separator'}, {label:'X1フォントを読み込む…',click:()=>command('font-load')},
      {label:'内蔵フォントに戻す',click:()=>command('font-reset')}, {type:'separator'},
      {role:'togglefullscreen',label:'全画面'}] },
    { label:'ヘルプ', submenu:[{label:'使い方',click:() => command('help')}] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
}
app.whenReady().then(() => {
  win = new BrowserWindow({ width:1180, height:820, minWidth:780, minHeight:560, title:'X1 BASIC Editor',
    backgroundColor:'#172023', webPreferences:{ preload:path.join(__dirname,'preload.cjs'), contextIsolation:true,
      nodeIntegration:false, sandbox:true, spellcheck:false } });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('console-message', event => {
    if (event.level === 'error' || event.level === 'warning') console.error('Renderer:', event.message);
  });
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({cancel:!details.url.startsWith('file:') && !details.url.startsWith('devtools:')}));
  win.on('close', event => { if (!allowClose && dirty) { event.preventDefault(); command('close'); } });
  buildMenu();
  // Explicit command-line filename, useful for launchers / file associations.
  const requested = process.argv.slice(app.isPackaged ? 1 : 2).find(arg => !arg.startsWith('-'));
  const startupRevision = documentRevision;
  if (requested) win.webContents.once('did-finish-load', async () => {
    try {
      const loaded = await readDocument(path.resolve(requested));
      if (startupRevision !== documentRevision || dirty) return;
      current = loaded; win.webContents.send('loaded', current);
    } catch (err) { if (startupRevision === documentRevision) await errorBox(err); }
  });
  win.loadFile(path.join(__dirname,'src/index.html'));
});
app.on('window-all-closed', () => app.quit());

ipcMain.handle('open', async () => {
  documentRevision++;
  const result = await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'BASIC / テキスト',extensions:['bas','txt','lst']},{name:'すべてのファイル',extensions:['*']}]});
  if (result.canceled) return null;
  try { current = await readDocument(result.filePaths[0]); dirty = false; return current; }
  catch (err) { await errorBox(err); return null; }
});
ipcMain.handle('save', async (_event, payload) => {
  if (saving) return null;
  documentRevision++;
  saving = true;
  try {
    const bytes = checkedBytes(payload.bytes);
    let target = current?.path, expected = current?.hash;
    if (payload.saveAs || !target) {
      const result = await dialog.showSaveDialog(win,{defaultPath:target || 'Untitled.bas', filters:[{name:'BASIC',extensions:['bas']},{name:'すべてのファイル',extensions:['*']}]});
      if (result.canceled) return null;
      target = result.filePath;
      if (target !== current?.path) expected = undefined;
    }
    const digest = await atomicSave(target, bytes, expected);
    current = {path:target, name:path.basename(target), hash:digest};
    dirty = false;
    return {...current, bytes:Array.from(bytes)};
  } catch (err) { await errorBox(err); return null; }
  finally { saving = false; }
});
ipcMain.handle('confirm-dirty', async () => {
  const result = await dialog.showMessageBox(win,{type:'question',message:'変更を保存しますか？',
    detail:'保存していない変更は失われます。', buttons:['保存','保存しない','キャンセル'],defaultId:0,cancelId:2,noLink:true});
  return ['save','discard','cancel'][result.response];
});
ipcMain.on('state', (_event, state) => {
  if (state.dirty) documentRevision++;
  dirty = Boolean(state.dirty); win.setDocumentEdited(dirty);
  win.setTitle((dirty ? '● ' : '') + (current?.name || 'Untitled.bas') + ' — X1 BASIC Editor');
});
ipcMain.on('new-document', () => { documentRevision++; current = null; dirty = false; });
ipcMain.on('close-now', () => { documentRevision++; allowClose = true; win.close(); });
ipcMain.handle('message', (_event, message) => dialog.showMessageBox(win,{type:'info',message:String(message).slice(0,4000)}));
ipcMain.handle('font-current', async () => {
  try {
    const font = await fontSettings().read();
    return font ? {name:font.name,data:Array.from(buildFontFromRom(font.rom))} : {name:'内蔵フォント',data:null};
  } catch (err) { return {error:'保存されたフォントを読み込めませんでした。内蔵フォントを使います。\n'+err.message}; }
});
ipcMain.handle('font-choose', async () => {
  pendingFont = null;
  const result = await dialog.showOpenDialog(win,{title:'8×8 X1フォントを読み込む',properties:['openFile'],
    filters:[{name:'X1 ANKフォント（2048バイト）',extensions:['x1','X1']},{name:'すべてのファイル',extensions:['*']}]});
  if (result.canceled) return null;
  try {
    const file = result.filePaths[0];
    if ((await fs.stat(file)).size !== 2048) throw Error('8×8 ANKフォントは2048バイト（8バイト×256文字）のファイルを指定してください。');
    const rom = await fs.readFile(file), data = buildFontFromRom(rom);
    const token = crypto.randomUUID();
    pendingFont = {token,name:path.basename(file),rom};
    return {token,name:pendingFont.name,data:Array.from(data)};
  } catch (err) { await errorBox(err); return null; }
});
ipcMain.handle('font-commit', async (_event, token) => {
  try {
    if (!pendingFont || pendingFont.token !== token) throw Error('読み込み中のフォントが見つかりません。選択し直してください。');
    await fontSettings().write(pendingFont);
    pendingFont = null; return true;
  } catch (err) { await errorBox(err); return false; }
});
ipcMain.handle('font-reset', async () => {
  try { await fontSettings().write(null); pendingFont = null; return true; }
  catch (err) { await errorBox(err); return false; }
});
ipcMain.handle('pcg-font',async (_event,payload)=>{
  // Match font-current's fallback when stored settings cannot be read.
  const font=await fontSettings().read().catch(()=>null);
  const bitmap=font?parseFontRom(font.rom):require('./assets/x1-font.json');
  return Array.from(buildFont(bitmap,payload.entries,payload.order,payload.layout));
});
