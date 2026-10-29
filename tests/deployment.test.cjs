const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const base = 'https://example.github.io/rigongyizhu/';
const currentCache = 'rigongyizhu-standalone-63.6';
const absolute = value => new URL(typeof value === 'string' ? value : value.url, base).href;

function worker({ fail = () => false } = {}) {
  const listeners = {};
  const stores = new Map();
  const deleted = [];
  const requested = [];
  let skips = 0;
  let claimed = 0;
  function cacheFor(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const values = stores.get(name);
    return {
      async addAll(requests) {
        const staged = await Promise.all(requests.map(async request => {
          const url = absolute(request);
          requested.push(url);
          if (fail(url)) throw new Error('failed: ' + url);
          return [url, new Response('cached ' + url)];
        }));
        staged.forEach(([url, response]) => values.set(url, response));
      },
      async add(request) {
        const url = absolute(request);
        requested.push(url);
        if (fail(url)) throw new Error('failed: ' + url);
        values.set(url, new Response('cached ' + url));
      },
      async put(request, response) { values.set(absolute(request), response); },
      async match(request) { return values.get(absolute(request)); },
    };
  }
  const sandbox = {
    self: {
      location: { href: base + 'sw.js' },
      addEventListener(name, callback) { listeners[name] = callback; },
      skipWaiting() { skips++; },
      clients: { async claim() { claimed++; } },
    },
    location: { origin: 'https://example.github.io' },
    caches: {
      async open(name) { return cacheFor(name); },
      async keys() { return [...stores.keys()]; },
      async delete(name) { deleted.push(name); return stores.delete(name); },
    },
    Request: class extends Request {
      constructor(url, options) { super(absolute(url), options); }
    },
    Response, URL, AbortController, setTimeout, clearTimeout,
    async fetch(request) {
      const url = absolute(request);
      if (fail(url)) throw new Error('offline');
      return new Response('network ' + url);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(source + '\nthis.testResources = { required: REQUIRED, optional: OPTIONAL };', sandbox);
  return {
    stores, deleted, requested, cacheFor,
    resources: sandbox.testResources,
    get skips() { return skips; },
    get claimed() { return claimed; },
    async lifecycle(name) {
      let pending;
      listeners[name]({ waitUntil(promise) { pending = promise; } });
      await pending;
    },
    message(data) { listeners.message({ data }); },
    fetch(url, mode = 'navigate') {
      let handled;
      listeners.fetch({ request: { url, mode, method: 'GET' }, respondWith(promise) { handled = promise; } });
      return handled;
    },
  };
}

test('an unavailable required script rejects installation and retains the previous offline app', async () => {
  const w = worker({ fail: url => url.includes('/src/history-engine.js') });
  w.stores.set('rigongyizhu-standalone-62', new Map([[base + 'index.html', new Response('old app')]]));
  await assert.rejects(w.lifecycle('install'), /history-engine/);
  assert.equal(w.stores.get(currentCache).size, 0, 'required writes are atomic');
  assert.equal(await w.stores.get('rigongyizhu-standalone-62').get(base + 'index.html').text(), 'old app');
  assert.deepEqual(w.deleted, []);
  assert.equal(w.skips, 0);
});

test('optional icons may fail without blocking a complete offline shell', async () => {
  const w = worker({ fail: url => url.endsWith('/assets/icon-192.png') });
  await w.lifecycle('install');
  for (const file of ['index.html', 'assets/app.css?v=63', 'assets/product.css?v=63', 'src/history-engine.js?v=63', 'src/app.bundle.js?v=63', 'src/weekly-metrics.js?v=63', 'src/chunk-diary.js?v=63', 'src/chunk-grow.js?v=63', 'src/chunk-social.js?v=63', 'src/chunk-plus.js?v=63']) {
    assert.ok(w.stores.get(currentCache).has(base + file), file + ' is precached');
  }
  assert.equal(w.skips, 0, 'install waits for user consent to switch versions');
  w.message({ type: 'SKIP_WAITING' });
  assert.equal(w.skips, 1);
});

test('activation deletes only old caches belonging to this application', async () => {
  const w = worker();
  for (const name of ['rigongyizhu-standalone-61', 'rigongyizhu-standalone-62', currentCache, 'other-project-v1', 'workbox-precache-other']) w.stores.set(name, new Map());
  await w.lifecycle('activate');
  assert.deepEqual(w.deleted.sort(), ['rigongyizhu-standalone-61', 'rigongyizhu-standalone-62']);
  assert.ok(w.stores.has(currentCache));
  assert.ok(w.stores.has('other-project-v1'));
  assert.ok(w.stores.has('workbox-precache-other'));
  assert.equal(w.claimed, 1);
});

test('offline navigation with a shortcut query falls back to the app shell under its project path', async () => {
  const w = worker({ fail: () => true });
  await w.cacheFor(currentCache).put('./index.html', new Response('offline app'));
  const response = await w.fetch(base + 'index.html?quickadd=1');
  assert.equal(await response.text(), 'offline app');
});

test('requests to another project or another origin remain untouched', () => {
  const w = worker();
  assert.equal(w.fetch('https://example.github.io/other-project/index.html'), undefined);
  assert.equal(w.fetch('https://cloud.example/api'), undefined);
});

test('first navigation without cached content gets a useful offline response', async () => {
  const w = worker({ fail: () => true });
  const response = await w.fetch(base);
  assert.equal(response.status, 503);
  assert.match(await response.text(), /首次打开需要联网/);
});

function cloudHarness(href = base + 'index.html?from=login') {
  const bundle = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.bundle.js'), 'utf8');
  const standalone = text => text.replace(/,\s*$/, ';');
  let sdkURL;
  let oauth;
  const sandbox = {
    window: { addEventListener() {} },
    location: { href, origin: new URL(href).origin, pathname: new URL(href).pathname, assign() {} },
    navigator: { onLine: true },
    document: {
      addEventListener() {},
      createElement() { return {}; },
      head: {
        appendChild(script) {
          sdkURL = new URL(script.src, href).href;
          const sdk = { createWorkBuddyCloud() { return { auth: { async signInWithOAuth(options) { oauth = options; return { data: {} }; } } }; } };
          sandbox.WorkBuddyCloud = sandbox.window.WorkBuddyCloud = sdk;
          script.onload();
        },
      },
    },
    URL, console, setTimeout, clearTimeout,
    setInterval() { return 0; },
  };
  vm.createContext(sandbox);
  vm.runInContext(standalone(bundle.slice(0, bundle.indexOf('window.ErrLog='))), sandbox);
  sandbox.U = sandbox.window.U;
  vm.runInContext(standalone(bundle.slice(bundle.indexOf('window.Cloud='), bundle.indexOf('window.WebDAV='))), sandbox);
  return { sandbox, get sdkURL() { return sdkURL; }, get oauth() { return oauth; } };
}

test('actual OAuth implementation returns to the repository subpath rather than the account root', async () => {
  for (const href of [base, base + 'index.html?from=login']) {
    const c = cloudHarness(href);
    await c.sandbox.window.Cloud.wechatLogin();
    assert.equal(c.oauth.provider, 'wechat');
    assert.equal(c.oauth.redirectTo, base);
  }
});

test('actual dynamic SDK URL uses the same version as the offline precache', async () => {
  const c = cloudHarness();
  await c.sandbox.window.Cloud.wechatLogin();
  assert.equal(c.sandbox.U.VERSION, '63');
  assert.equal(c.sdkURL, base + 'vendor/cloud-sdk.js?v=63');
  const w = worker();
  assert.ok(w.resources.optional.includes('./vendor/cloud-sdk.js?v=63'));
});

test('all precache resources exist in the release directory and use one release version', () => {
  const w = worker();
  const root = path.join(__dirname, '..');
  for (const resource of [...w.resources.required, ...w.resources.optional]) {
    const parsed = new URL(resource, base);
    const relative = decodeURIComponent(parsed.pathname.slice(new URL(base).pathname.length));
    assert.ok(fs.statSync(path.join(root, relative)).isFile(), relative + ' exists');
    if (parsed.searchParams.has('v')) assert.equal(parsed.searchParams.get('v'), '63', resource);
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const script of ['src/history-engine.js?v=63', 'src/backup-confirm.js?v=63', 'src/app.bundle.js?v=63', 'src/weekly-metrics.js?v=63', 'src/daily-focus.js?v=63']) {
    assert.ok(html.includes(script), script + ' is linked by the app shell');
    assert.ok(w.resources.required.includes('./' + script), script + ' is required offline');
  }
});
