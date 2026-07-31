const fs = require('fs');
const content = fs.readFileSync('src/app/shakhmatka/ShakhmatkaClient.tsx', 'utf-8');
const lines = content.split('\n');

console.log('Search for SERVICE in ShakhmatkaClient.tsx:');
lines.forEach((line, idx) => {
  if (line.includes('SERVICE') || line.includes('служеб') || line.includes('Служеб')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
