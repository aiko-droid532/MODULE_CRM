const fs = require('fs');
const content = fs.readFileSync('src/app/actions/leads.ts', 'utf-8');
const lines = content.split('\n');

console.log('recordPaymentAction in src/app/actions/leads.ts:');
lines.forEach((line, idx) => {
  if (line.includes('recordPaymentAction') || (idx > 920 && idx < 970)) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
