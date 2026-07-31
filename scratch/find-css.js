const fs = require('fs');
const content = fs.readFileSync('src/app/shakhmatka/Shakhmatka.module.css', 'utf-8');
const lines = content.split('\n');
const targets = ['sidePanel', 'editUnitBtn', 'deleteUnitBtn', 'closeBtn', 'header'];

console.log('Class locations in Shakhmatka.module.css:');
lines.forEach((line, idx) => {
  targets.forEach(t => {
    if (line.includes('.' + t) || line.includes(t + ':') || (line.includes(t) && line.includes('{'))) {
      console.log(`${idx + 1}: ${line.trim()}`);
    }
  });
});
