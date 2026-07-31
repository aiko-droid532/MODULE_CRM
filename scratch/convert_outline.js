const fs = require('fs');

function convertFile(src, dest) {
  if (!fs.existsSync(src)) {
    console.log(`Source file ${src} does not exist.`);
    return;
  }
  const buffer = fs.readFileSync(src);
  const decoder = new TextDecoder('windows-1251');
  const text = decoder.decode(buffer);
  fs.writeFileSync(dest, text, 'utf-8');
  console.log(`Converted ${src} to ${dest}`);
}

convertFile('OP_text_outline.txt', 'scratch/OP_text_outline_utf8.txt');
convertFile('OP_outline_hits.txt', 'scratch/OP_outline_hits_utf8.txt');
convertFile('pdf_pages_7_15.txt', 'scratch/pdf_pages_7_15_utf8.txt');
convertFile('pdf_pages_16_26.txt', 'scratch/pdf_pages_16_26_utf8.txt');
