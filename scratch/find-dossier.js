const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else {
      results.push(fullPath);
    }
  });
  return results;
}

const files = walk(path.join(process.cwd(), 'src'));
console.log('Searching for files containing "dossier" or "payment"...');
files.forEach(file => {
  const content = fs.readFileSync(file, 'utf-8');
  const filename = path.basename(file);
  if (filename.toLowerCase().includes('dossier') || content.toLowerCase().includes('leaddossier')) {
    console.log(`Found LeadDossier: ${file}`);
  }
  if (content.includes('recordPaymentAction') || content.includes('recordPayment')) {
    console.log(`Found recordPayment in: ${file}`);
  }
});
