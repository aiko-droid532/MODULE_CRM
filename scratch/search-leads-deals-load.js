const fs = require('fs');
const path = require('path');

const contentLeads = fs.readFileSync('src/app/actions/leads.ts', 'utf-8');
const contentDeals = fs.readFileSync('src/app/actions/deals.ts', 'utf-8');

console.log('--- Leads Action file search: ---');
const linesLeads = contentLeads.split('\n');
linesLeads.forEach((line, idx) => {
  if (line.includes('SELECT') && (line.includes('Deal') || line.includes('PaymentSchedule'))) {
    console.log(`leads.ts line ${idx + 1}: ${line.trim()}`);
  }
  if (line.includes('getLeadById')) {
    console.log(`leads.ts line ${idx + 1}: ${line.trim()}`);
  }
});

console.log('--- Deals Action file search: ---');
const linesDeals = contentDeals.split('\n');
linesDeals.forEach((line, idx) => {
  if (line.includes('SELECT') && (line.includes('Deal') || line.includes('PaymentSchedule'))) {
    console.log(`deals.ts line ${idx + 1}: ${line.trim()}`);
  }
});
