'use strict';
/* 联网默认值守卫：天气请求会把 IP（甚至 GPS 坐标）交给第三方，
 * 因此必须「用户显式开启后才自动发」。这里用静态断言锁住这条规则，
 * 避免以后一次重构把默认值悄悄改回「默认联网」。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('天气自动获取默认关闭，只有显式开启（settings.weatherAuto 为真）才联网', () => {
  const diary = read('src/chunk-diary.js');
  const guard = diary.match(/ensureWeather:function\(t\)\{[^}]*?return Promise\.resolve\(null\)/);
  assert.ok(guard, '找不到 ensureWeather 的守卫代码');
  const code = guard[0];
  /* 旧写法 !1===n.settings.weatherAuto 只在值为 false 时跳过，未设置时等于默认开启 */
  assert.equal(/!1===n\.settings\.weatherAuto/.test(code), false, '不能再把「未设置」当成开启');
  assert.match(code, /!n\.settings\.weatherAuto/, '必须是「为假就跳过」，未设置时默认关闭');
});

test('设置页提供「自动记录天气」开关，且能写回 weatherAuto', () => {
  const bundle = read('src/app.bundle.js');
  assert.match(bundle, /data-act="toggleweather"/, '设置页缺少自动记录天气开关');
  assert.match(bundle, /自动记录天气/, '设置页缺少开关文案');
  const handler = bundle.match(/toggleweather\(\)\{[\s\S]{0,220}?\},/);
  assert.ok(handler, '找不到 toggleweather 处理函数');
  assert.match(handler[0], /settings\.weatherAuto/, '开关必须落在 settings.weatherAuto 上');
});

test('手动「加天气」入口保留：关掉自动获取后仍能补记天气', () => {
  const bundle = read('src/app.bundle.js');
  assert.match(bundle, /data-act="dyweather"/, '日记页缺少手动加天气按钮');
  const diary = read('src/chunk-diary.js');
  assert.match(diary, /fetchWeather:i/, '手动获取天气的底层方法丢了');
});

test('定位能力只出现在天气模块，且只作为天气失败的兜底', () => {
  const files = fs.readdirSync(path.join(root, 'src')).filter((name) => name.endsWith('.js'));
  const hits = [];
  for (const name of files) {
    const text = read(path.join('src', name));
    const count = (text.match(/getCurrentPosition/g) || []).length;
    if (count) hits.push({ name, count });
  }
  assert.deepEqual(hits, [{ name: 'chunk-diary.js', count: 1 }], '定位只能有天气一个入口，避免其它模块偷偷取位置');
  const diary = read('src/chunk-diary.js');
  const index = diary.indexOf('getCurrentPosition');
  const before = diary.slice(Math.max(0, index - 600), index);
  assert.match(before, /wttr/, '定位应作为 wttr.in 失败后的兜底，而不是首选');
  assert.match(before, /\.catch\(/, '定位必须挂在失败回调里，不能主动触发');
});

test('服务端只保留一个带 token 的读取入口在 URL 上，且新增的读取接口走请求体', () => {
  const server = read('server.js');
  assert.match(server, /p === '\/api\/read'/, '缺少 POST /api/read');
  const route = server.match(/if \(req\.method === 'POST' && p === '\/api\/read'\)[^\n]*/);
  assert.ok(route && !/searchParams/.test(route[0]), 'POST /api/read 不能从 URL 取 token');
  /* GET /api/state 是给旧客户端留的兼容通道，注释里必须写明可以删除 */
  assert.match(server, /GET \/api\/state 只是旧版本 PWA 的兼容通道/, '兼容通道缺少说明，容易被误当成正式接口');
});
