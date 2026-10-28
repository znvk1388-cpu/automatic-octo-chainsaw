'use strict';

// The lazy Insights chunk has a private completion helper. Route it through
// Engine so its correlations, timing samples and series obey the same history
// snapshots, step completion and minimum-dose semantics as the main screens.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function patchSource(source) {
  if (source.includes('/* grow-history-hooks-v1 */')) return source;
  const before = 'function r(t,e){var r=(n()[e]||{})[t.id];return!!r&&("check"===t.type||"avoid"===t.type?!!r.d:(r.v||0)>=(t.target||1))}';
  const after = 'function r(t,e){return Engine.isDone(t,e)}';
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error('Insights history patch mismatch: expected one completion helper, found ' + count);
  const result = source.replace(before, after) + '\n/* grow-history-hooks-v1 */\n';
  new vm.Script(result);
  return result;
}

module.exports = {patchSource};
if (require.main === module) {
  const filename = process.argv[2] || path.join(__dirname, '../src/chunk-grow.js');
  fs.writeFileSync(filename, patchSource(fs.readFileSync(filename, 'utf8')));
  console.log('Installed Insights history hook');
}
