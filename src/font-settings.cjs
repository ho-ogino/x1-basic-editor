'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {parseFontRom} = require('./font-builder.cjs');

class FontSettings {
  constructor(file, legacyFile = null) { this.file = file; this.legacyFile = legacyFile; }
  async read() {
    let text;
    try {
      const stat = await fs.stat(this.file);
      if (stat.size > 16384) throw Error('保存されたフォント設定のサイズが不正です。');
      text = await fs.readFile(this.file,'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      if (!this.legacyFile) return null;
      // Migrate only the font setting, without copying old caches or changing the old app.
      const font = await new FontSettings(this.legacyFile).read();
      if (font) await this.write(font);
      return font;
    }
    const settings = JSON.parse(text);
    if (settings.version !== 1) throw Error('保存されたフォント設定の形式が不正です。');
    if (settings.font === null) return null;
    const font = settings.font;
    if (!font || typeof font.name !== 'string' || font.name.length > 255 || typeof font.rom !== 'string') throw Error('保存されたフォント設定が不正です。');
    const rom = Buffer.from(font.rom,'base64');
    if (rom.toString('base64') !== font.rom) throw Error('保存されたフォントデータが不正です。');
    parseFontRom(rom);
    return {name:font.name,rom};
  }
  async write(font) {
    if (font) {
      parseFontRom(font.rom);
      if (typeof font.name !== 'string' || !font.name.length || font.name.length > 255) throw Error('フォント名が不正です。');
    }
    const settings = {version:1,font:font ? {name:font.name,rom:Buffer.from(font.rom).toString('base64')} : null};
    const dir = path.dirname(this.file);
    await fs.mkdir(dir,{recursive:true});
    const temp = path.join(dir,'.font-settings-'+crypto.randomUUID()+'.tmp');
    try {
      const handle = await fs.open(temp,'wx',0o600);
      try { await handle.writeFile(JSON.stringify(settings)); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temp,this.file);
    } finally { await fs.unlink(temp).catch(err=>{if(err.code!=='ENOENT')throw err;}); }
  }
}
module.exports = {FontSettings};
