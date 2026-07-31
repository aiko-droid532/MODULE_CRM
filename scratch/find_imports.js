const fs = require('fs');
const path = require('path');

function walk(dir, results = []) {
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      if (!file.includes('node_modules') && !file.includes('.next') && !file.includes('.git')) {
        walk(file, results);
      }
    } else {
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('c:/Users/Сулпак/Documents/MODULE/src');
files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  if (content.includes('getLeads') || content.includes('getLeadsKanban') || content.includes('getLeadsBoard')) {
    console.log(`Match in ${f}`);
  }
});
