'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BYTES = 2 * 1024 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function readDocument(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw Error('通常のファイルを選択してください。');
  if (stat.size > MAX_BYTES) throw Error('このエディタでは2 MiBまでのファイルを開けます。');
  const bytes = await fs.readFile(file);
  if (bytes.length > MAX_BYTES) throw Error('ファイルが大きすぎます。');
  return { path: file, name: path.basename(file), bytes: Array.from(bytes), hash: hash(bytes) };
}
async function atomicSave(file, bytes, expectedHash) {
  if (bytes.length > MAX_BYTES) throw Error('保存できるサイズは2 MiBまでです。');
  let previous = null, mode = 0o666;
  try { previous = await fs.readFile(file); mode = (await fs.stat(file)).mode; }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  if (expectedHash !== undefined && (previous === null || hash(previous) !== expectedHash)) {
    const err = Error('ファイルが他のアプリで変更、または削除されています。別名で保存してください。'); err.code = 'EXTERNAL_CHANGE'; throw err;
  }
  if (previous !== null) {
    // Keep the file as it was before the first overwrite. Never replace an existing backup.
    try { await fs.writeFile(file + '.bak', previous, { flag: 'wx', mode }); }
    catch (err) { if (err.code !== 'EEXIST') throw err; }
  }
  const temp = path.join(path.dirname(file), '.' + path.basename(file) + '.' + crypto.randomUUID() + '.tmp');
  try {
    const handle = await fs.open(temp, 'wx', mode);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    if (expectedHash !== undefined) {
      let current;
      try { current = await fs.readFile(file); } catch (err) { if (err.code !== 'ENOENT') throw err; }
      if (!current || hash(current) !== expectedHash) {
        const err = Error('保存中に元ファイルが変更されました。別名で保存してください。'); err.code = 'EXTERNAL_CHANGE'; throw err;
      }
    }
    await fs.rename(temp, file);
    const check = await fs.readFile(file);
    if (!check.equals(bytes)) throw Error('保存後のバイト検証に失敗しました。');
    return hash(bytes);
  } finally { await fs.unlink(temp).catch(err => { if (err.code !== 'ENOENT') throw err; }); }
}
module.exports = { hash, readDocument, atomicSave, MAX_BYTES };
