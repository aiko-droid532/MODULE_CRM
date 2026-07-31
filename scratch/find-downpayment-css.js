const fs = require('fs');
const content = fs.readFileSync('src/app/shakhmatka/Shakhmatka.module.css', 'utf-8');
const lines = content.split('\n');

console.log('Search for downPayment in CSS:');
lines.forEach((line, idx) => {
  if (line.includes('downPayment')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
