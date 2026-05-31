const fs = require('fs');
const path = require('path');

const content = fs.readFileSync('./tsconfig.json', 'utf-8');
console.log('Raw content length:', content.length);
console.log('First 500 chars:', JSON.stringify(content.slice(0, 500)));

try {
  const parsed = JSON.parse(content);
  console.log('Success! Paths:', parsed.compilerOptions?.paths);
} catch (e) {
  console.log('Direct parse error:', e.message);
}

// Try removing BOM
const clean = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
try {
  const parsed = JSON.parse(clean);
  console.log('Clean parse success! Paths:', parsed.compilerOptions?.paths);
} catch (e) {
  console.log('Clean parse error:', e.message);
  console.log('Content around error:');
  const pos = parseInt(e.message.match(/position (\d+)/)?.[1] || 0);
  console.log(JSON.stringify(clean.slice(Math.max(0, pos - 50), pos + 50)));
}
