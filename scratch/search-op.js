const fs = require('fs');
const path = require('path');

const files = [
  'OP_text_outline.txt',
  'OP_outline_hits.txt',
  'pdf_pages_7_15.txt',
  'pdf_pages_16_26.txt'
];

const queries = ['платеж', 'оплат', 'финанс', 'schedule', 'payment'];

files.forEach(file => {
  const filePath = path.join(process.cwd(), file);
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  console.log(`=== Matches in ${file} ===`);
  lines.forEach((line, idx) => {
    const matched = queries.some(q => line.toLowerCase().includes(q.toLowerCase()));
    if (matched) {
      console.log(`${idx + 1}: ${line.trim()}`);
    }
  });
});
