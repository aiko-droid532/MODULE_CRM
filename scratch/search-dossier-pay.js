const fs = require('fs');
const content = fs.readFileSync('src/components/Leads/LeadDossier.tsx', 'utf-8');
const lines = content.split('\n');

console.log('Payment sections in LeadDossier.tsx:');
lines.forEach((line, idx) => {
  if (line.toLowerCase().includes('payment') || line.includes('платеж') || line.includes('оплат') || line.includes('платить')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
