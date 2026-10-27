'use strict';
// Preserve the Node Buffer API while sharing all font generation with browsers.
const builder=require('./font-builder.js');
module.exports={
  parseFontRom:builder.parseFontRom,
  buildFont:(...args)=>Buffer.from(builder.buildFont(...args)),
  buildFontFromRom:(...args)=>Buffer.from(builder.buildFontFromRom(...args))
};
