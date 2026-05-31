const fs = require('fs');
const path = require('path');

function findTsConfig(dir) {
  const candidates = ['tsconfig.json', 'jsconfig.json'];
  let currentDir = dir;

  while (true) {
    for (const candidate of candidates) {
      const configPath = path.join(currentDir, candidate);
      console.log('Checking:', configPath, fs.existsSync(configPath));
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return null;
}

const baseDir = process.cwd();
console.log('Base dir:', baseDir);
const tsConfigPath = findTsConfig(baseDir);
console.log('Found tsconfig:', tsConfigPath);

if (tsConfigPath) {
  const content = fs.readFileSync(tsConfigPath, 'utf-8');
  const jsonContent = content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,(\s*[}\]])/g, '$1');
  const tsConfig = JSON.parse(jsonContent);
  console.log('Paths:', tsConfig.compilerOptions?.paths);
}
