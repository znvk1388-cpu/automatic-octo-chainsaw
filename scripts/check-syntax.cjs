'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
function collect(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
    if (['node_modules','.git'].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? collect(full) : /\.(?:js|cjs)$/.test(entry.name) ? [full] : [];
  });
}
for (const file of collect(root)) {
  const result = spawnSync(process.execPath, ['--check', file], {encoding:'utf8'});
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(result.status || 1); }
}
console.log('All JavaScript files passed syntax checks.');
