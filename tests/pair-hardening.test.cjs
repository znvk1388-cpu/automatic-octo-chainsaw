'use strict';
/* 搭子信箱的边界加固：限流身份、文本清洗、字段最小暴露。
 * 复用 vm 沙箱启动一份 server.js，不起真实端口。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function startServer(env = {}) {
  let handler;
  /* 数据文件放临时目录：成功的写操作会真的落盘，落到仓库里会污染其它用例的基线。 */
  const directory = fs.mkdtempSync(path.join(root, '.pair-hardening-'));
  const dataPath = path.join(directory, 'pairs.json');
  const fakeHttp = { createServer(callback) { handler = callback; return { listen() {} }; } };
  const sandbox = {
    require(name) { return name === 'node:http' ? fakeHttp : require(name); },
    __dirname: root,
    Buffer,
    URL,
    process: { env: { PORT: '3000', DATA_PATH: dataPath, ...env }, uptime: () => 0 },
    console: { log() {}, error() {} },
    setTimeout, clearTimeout, setInterval() { return { unref() {} }; }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), sandbox);
  const request = async (pathname, method = 'GET', body = '', headers = {}, remoteAddress = '127.0.0.1') => {
    let response;
    const req = require('node:stream').Readable.from(body ? [Buffer.from(body)] : []);
    Object.assign(req, { url: pathname, method, headers, socket: { remoteAddress } });
    await handler(req, {
      setHeader() {},
      writeHead(status, responseHeaders) { response = { status, headers: responseHeaders }; },
      end(payload) { response.body = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload || ''); }
    });
    return response;
  };
  request.cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  return request;
}

test('伪造 X-Forwarded-For 不能绕过每分钟限流', async (t) => {
  const request = startServer({ TRUSTED_PROXIES: '127.0.0.1' });
  t.after(() => request.cleanup());
  let limited = 0;
  /* 每次都换一个「客户端自己写的」左侧条目，但真实来源（最右一跳）不变。
   * 如果限流认了最左边那一项，这里 120 次都会放行。 */
  for (let i = 0; i < 120; i++) {
    const response = await request('/api/health', 'GET', '', { 'x-forwarded-for': '10.9.' + (i % 200) + '.' + (i % 250) + ', 203.0.113.7' });
    if (response.status === 429) limited++;
  }
  assert.ok(limited > 0, '同一真实来源超过 90 次/分钟后必须开始拒绝');

  const other = await request('/api/health', 'GET', '', { 'x-forwarded-for': '198.51.100.9' });
  assert.equal(other.status, 200, '不同真实来源各自计数，不受上面的封禁影响');
});

test('搭子昵称与习惯名会清掉双向控制符和零宽字符', async (t) => {
  const request = startServer();
  t.after(() => request.cleanup());
  const created = JSON.parse((await request('/api/create', 'POST', JSON.stringify({
    nick: '小明\u202Egnp\u200b',
    habit: '读书\u2066abc\u2069'
  }))).body);
  const state = JSON.parse((await request('/api/state?code=' + created.code + '&token=' + created.token)).body);
  assert.equal(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(state.me.nick), false);
  assert.equal(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(state.me.habit), false);
  assert.ok(state.me.nick.startsWith('小明'));
});

test('邀请信息只给出昵称与习惯名，不泄露进度与令牌', async (t) => {
  const request = startServer();
  t.after(() => request.cleanup());
  const created = JSON.parse((await request('/api/create', 'POST', JSON.stringify({ nick: '甲', habit: '跑步', done: true, streak: 9 }))).body);
  const peek = JSON.parse((await request('/api/peek?code=' + created.code)).body);
  assert.deepEqual(Object.keys(peek.inviter).sort(), ['habit', 'nick']);
  assert.equal(/token/i.test((await request('/api/peek?code=' + created.code)).body), false);
  const state = JSON.parse((await request('/api/state?code=' + created.code + '&token=' + created.token)).body);
  assert.equal('token' in state.me, false);
});

test('静态服务仍然只放行白名单，穿越路径拿不到源码', async (t) => {
  const request = startServer();
  t.after(() => request.cleanup());
  assert.equal((await request('/src/app.bundle.js?v=64')).status, 200);
  for (const blocked of ['/data.json', '/server.js', '/package.json', '/src/../server.js', '/src/%2e%2e/server.js', '/.git/config']) {
    assert.equal((await request(blocked)).status, 404, blocked + ' 不该被服务');
  }
});

test('POST /api/read 用请求体里的 token 读取，鉴权行为与 GET 一致', async (t) => {
  const request = startServer();
  t.after(() => request.cleanup());
  const created = JSON.parse((await request('/api/create', 'POST', JSON.stringify({ nick: '甲', habit: '跑步', done: true, streak: 3 }))).body);

  const good = await request('/api/read', 'POST', JSON.stringify({ code: created.code, token: created.token }));
  assert.equal(good.status, 200);
  const body = JSON.parse(good.body);
  assert.equal(body.ok, true);
  assert.equal(body.me.nick, '甲');
  assert.equal('token' in body.me, false, '对外字段里永远不该有 token');

  /* 错 token 走 POST 也必须 403 */
  const bad = await request('/api/read', 'POST', JSON.stringify({ code: created.code, token: 'deadbeef' }));
  assert.equal(bad.status, 403);

  /* 空 body 也不该 500 */
  const empty = await request('/api/read', 'POST', '');
  assert.equal(empty.status, 404);
});

test('GET /api/state（旧通道）与 POST /api/read 返回一致', async (t) => {
  const request = startServer();
  t.after(() => request.cleanup());
  const created = JSON.parse((await request('/api/create', 'POST', JSON.stringify({ nick: '乙', habit: '喝水' }))).body);
  const joined = JSON.parse((await request('/api/join', 'POST', JSON.stringify({ code: created.code, nick: '丙', habit: '读书' }))).body);
  const viaGet = JSON.parse((await request('/api/state?code=' + created.code + '&token=' + joined.token)).body);
  const viaPost = JSON.parse((await request('/api/read', 'POST', JSON.stringify({ code: created.code, token: joined.token }))).body);
  assert.deepEqual(viaPost, viaGet);
});

test('页面响应带 nosniff 与 X-Frame-Options，不可被第三方嵌套', async (t) => {
  const request = startServer();
  t.after(() => request.cleanup());
  const page = await request('/index.html');
  assert.equal(page.status, 200);
  assert.equal(page.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(page.headers['X-Frame-Options'], 'SAMEORIGIN');
  assert.match(String(page.headers['Content-Security-Policy'] || ''), /script-src 'self'/);
  /* 接口响应不该被缓存 */
  const api = await request('/api/health');
  assert.equal(api.headers['Cache-Control'], 'no-store');
});


test('直连来源不能轮换自填 XFF 来绕过限流',async t=>{
 const request=startServer();t.after(()=>request.cleanup());let limited=0;
 for(let i=0;i<120;i++)if((await request('/api/health','GET','',{'x-forwarded-for':'198.51.100.'+(i+1)})).status===429)limited++;
 assert.equal(limited,30);
});

test('显式可信多层代理从右向左找到第一个非可信地址',async t=>{
 const request=startServer({TRUSTED_PROXIES:'127.0.0.1,10.0.0.0/8'});t.after(()=>request.cleanup());let limited=0;
 for(let i=0;i<120;i++)if((await request('/api/health','GET','',{'x-forwarded-for':'198.51.100.'+(i+1)+', 203.0.113.7, 10.2.0.8'})).status===429)limited++;
 assert.equal(limited,30);
 assert.equal((await request('/api/health','GET','',{'x-forwarded-for':'203.0.113.8, 10.2.0.8'})).status,200);
});

test('代理链中不合法的地址退回连接来源，不成为新限流钥匙',async t=>{
 const request=startServer({TRUSTED_PROXIES:'127.0.0.1'});t.after(()=>request.cleanup());let limited=0;
 for(let i=0;i<120;i++)if((await request('/api/health','GET','',{'x-forwarded-for':'not-an-ip-'+i})).status===429)limited++;
 assert.equal(limited,30);
});

test('IPv6 可信网段和映射 IPv4 的识别不依赖左侧声明',async t=>{
 const request=startServer({TRUSTED_PROXIES:'2001:db8:1::/48'});t.after(()=>request.cleanup());let limited=0;
 for(let i=0;i<120;i++)if((await request('/api/health','GET','',{'x-forwarded-for':'198.51.100.'+(i+1)+', ::ffff:203.0.113.7'},'2001:db8:1::2')).status===429)limited++;
 assert.equal(limited,30);
 assert.equal((await request('/api/health','GET','',{'x-forwarded-for':'203.0.113.8'},'2001:db8:1::2')).status,200);
});
