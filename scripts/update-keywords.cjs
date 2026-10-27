'use strict';
// Refresh the shipped keyword snapshot from the HuBASIC compiler, without a runtime dependency.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const source = process.argv[2];
if (!source) throw Error('Usage: node scripts/update-keywords.cjs path/to/HuKeywords.cs');
const text = fs.readFileSync(source, 'utf8');
const table = text.match(/\bAll\s*=\s*new\[\]\s*\{([\s\S]*?)\};/);
if (!table) throw Error('HuKeywords.All was not found');
const words = [...table[1].matchAll(/"([A-Z][A-Z0-9$]*)"/g)].map(match => match[1]);
if (words.length < 100 || new Set(words).size !== words.length) throw Error('Invalid keyword table');
const hash = crypto.createHash('sha256').update(text).digest('hex');
const output = `// Generated from SLANGCompiler.HuBasic/Lexing/HuKeywords.cs.\n// Source SHA-256: ${hash}\n` +
  `(function (root) {\n  'use strict';\n  const words = Object.freeze(${JSON.stringify(words, null, 2)});\n` +
  `  if (typeof module === 'object' && module.exports) module.exports = words;\n  else root.X1Keywords = words;\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n`;
fs.writeFileSync(path.join(__dirname, '../src/keywords.js'), output);
console.log('Imported', words.length, 'HuBASIC keywords.');
