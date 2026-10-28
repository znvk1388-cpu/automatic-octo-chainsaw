'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function startServer() {
  let handler;
  const fakeHttp = {createServer(callback) {handler=callback;return {listen() {}};}};
  const sandbox = {
    require(name) {return name==='node:http'?fakeHttp:require(name);},
    __dirname:root, Buffer, URL,
    process:{env:{PORT:'3000',DATA_PATH:path.join(root,'tests','missing-fixture-data.json')},uptime:()=>0},
    console:{log(){}},setTimeout,clearTimeout,setInterval(){return {unref(){}};}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root,'server.js'),'utf8'),sandbox);
  return async pathname => {
    let response;
    const result=handler({url:pathname,method:'GET',headers:{},socket:{remoteAddress:'127.0.0.1'}},{
      writeHead(status,headers){response={status,headers};},
      end(body){response.body=Buffer.isBuffer(body)?body.toString('utf8'):String(body||'');}
    });
    await result;
    return response;
  };
}
test('server routes deliver the complete app without exposing runtime data', async () => {
  const request=startServer();
  const page=await request('/');
  assert.equal(page.status,200);
  const scripts=[...page.body.matchAll(/<script defer src="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(scripts,['src/history-engine.js?v=63','src/app.bundle.js?v=63','src/weekly-metrics.js?v=63','src/daily-focus.js?v=63']);
  for(const resource of [...scripts,'assets/v63.css?v=63','assets/icon-192.png','manifest.webmanifest','sw.js']){
    const response=await request('/'+resource);
    assert.equal(response.status,200,resource+' is served');
    assert.ok(response.body.length>0,resource+' is nonempty');
  }
  assert.equal((await request('/data.json')).status,404);
  assert.equal((await request('/package.json')).status,404);
});
