'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function startServer(fileSystem = fs, dataPath = path.join(root, 'tests', 'missing-fixture-data.json')) {
  let handler;
  const fakeHttp = {createServer(callback) {handler=callback;return {listen() {}};}};
  const sandbox = {
    require(name) {return name==='node:http'?fakeHttp:name==='node:fs'?fileSystem:require(name);},
    __dirname:root, Buffer, URL,
    process:{env:{PORT:'3000',DATA_PATH:dataPath},uptime:()=>0},
    console:{log(){},error(){}},setTimeout,clearTimeout,setInterval(){return {unref(){}};}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root,'server.js'),'utf8'),sandbox);
  return async (pathname, method = 'GET', body = '') => {
    let response;
    const req = require('node:stream').Readable.from(body ? [Buffer.from(body)] : []);
    Object.assign(req, {url:pathname,method,headers:{},socket:{remoteAddress:'127.0.0.1'}});
    const result=handler(req,{
      setHeader(){},
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
  assert.deepEqual(scripts,['src/history-engine.js?v=63','src/backup-confirm.js?v=63','src/app.bundle.js?v=63','src/weekly-metrics.js?v=63','src/daily-focus.js?v=63']);
  for(const resource of [...scripts,'assets/v63.css?v=63','assets/icon-192.png','manifest.webmanifest','sw.js']){
    const response=await request('/'+resource);
    assert.equal(response.status,200,resource+' is served');
    assert.ok(response.body.length>0,resource+' is nonempty');
  }
  assert.equal((await request('/data.json')).status,404);
  assert.equal((await request('/package.json')).status,404);
});


test('malformed URL returns 400 and the server continues to respond', async () => {
  const request = startServer();
  assert.equal((await request('/%zz')).status, 400);
  assert.equal((await request('/')).status, 200);
});


test('failed persistence is reported and does not create an in-memory pair', async () => {
  const disk = Object.assign({}, fs, {writeFileSync() { throw new Error('disk failure'); }});
  const request = startServer(disk);
  const result = await request('/api/create', 'POST', '{}');
  assert.equal(result.status, 503);
  assert.equal(JSON.parse((await request('/api/health')).body).pairs, 0);
});


test('saved pair remains available after the server is restarted', async () => {
  const directory = fs.mkdtempSync(path.join(root, '.pair-test-'));
  try {
    const dataPath = path.join(directory, 'pairs.json');
    const first = startServer(fs, dataPath);
    const created = JSON.parse((await first('/api/create', 'POST', JSON.stringify({nick:'测试'}))).body);
    const second = startServer(fs, dataPath);
    const result = await second('/api/state?code=' + created.code + '&token=' + created.token);
    assert.equal(result.status,200);
    assert.equal(JSON.parse(result.body).me.nick, '测试');
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});

test('corrupt stored data stops startup rather than silently replacing records', () => {
  const directory = fs.mkdtempSync(path.join(root, '.pair-test-'));
  try {
    const dataPath=path.join(directory,'pairs.json');
    fs.writeFileSync(dataPath, '{broken', 'utf8');
    assert.throws(() => startServer(fs,dataPath));
    assert.equal(fs.readFileSync(dataPath,'utf8'),'{broken');
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
