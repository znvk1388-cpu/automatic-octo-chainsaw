const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../src/app.bundle.js'),'utf8');
const start=src.indexOf('async installpwa(){');
const end=src.indexOf(',dismisspwa(){',start);
assert.ok(start>=0 && end>start);
test('WeChat users are told how to open in a browser and preserve local records',async()=>{
  let sheet;
  const c={window:{},navigator:{userAgent:'MicroMessenger iPhone'},UI:{sheet(title,html){sheet={title,html};}},o(){}};
  vm.createContext(c);
  vm.runInContext('this.actions={' + src.slice(start,end) + '}',c);
  await c.actions.installpwa();
  assert.match(sheet.html,/微信/);
  assert.match(sheet.html,/浏览器/);
  assert.match(sheet.html,/备份/);
});
