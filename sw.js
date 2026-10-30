/* 日拱一卒 · 独立部署版 Service Worker（GitHub Pages）
 *
 * 与原版 sw.js 的关键区别：
 * 1. 导航请求「网络优先 3 秒超时，失败回退缓存的应用壳」——
 *    平台休眠、断网、5xx 时老用户照样能打开应用，本地数据照常用。
 * 2. 静态资源缓存优先（文件名自带 ?v= 版本号）。
 * 3. 只管同源；云后端（workbuddy.host）等跨域请求原样放行。
 *
 * v45：版本号随发布升到 45；导航兜底同时命中 './' 与 './index.html' 两个键。
 * v47：健康数据自动勾选。
 * v48：不注册也能用（空态信任行 / 一键打卡快捷入口）。
 * v49：断签不可怕（每周休息额度 / 本月完成度 / 断签安抚 / 累计次数）。
 * v50：提醒会闭嘴（学会闭嘴 / 年度型排程 / 一句人话）。
 * v51：别让今天白过（部分完成 / 每月休息额度 / 日历导出 / 打印打卡纸）。
 * v52：第一分钟（刷新不再闪空态 / 首帧主题 / 隐私口径 / 首屏减卡）。
 * v53：你说了算（新版装好停在 waiting 等用户点刷新 / 色盲模式补形状通道 /
 *      空态恢复入口降为页脚文字链 / 状态条按钮终于点得动）。
 * v54：少即是多（「我的」页收成 3 个分组 / 首屏拆包：日记·回顾·社交·积分
 *      拆成 4 个按需 chunk，core 首屏跑完空闲时再拉，离线清单里照常预缓存）。
 * v62：细节顺一点（按钮不再断字 / 模板包不再裁字 / 深色层次拉开 /
 *      窄屏计数器不被压扁 / 「更多功能」补齐 8 个工具）。
 * v64：破戒后可记触发原因；戒断习惯可先撑 90 秒再决定。
 * v63：核心资源完整才安装新版；缓存清理限于本应用；支持独立历史、
 *      周统计与今日重点模块，离线使用同一版本。
 */
const CACHE_PREFIX = 'rigongyizhu-standalone-';
const VERSION = CACHE_PREFIX + '64.4';
const APP_BASE = new URL('./', self.location.href);
// An incomplete new shell must not replace the last working offline version.
// Cache.addAll writes this group atomically and rejects the installation on failure.
const REQUIRED = [
  './index.html',
  './assets/app.css?v=64',
  './assets/product.css?v=64',
  './assets/v63.css?v=64',
  './assets/v64.css?v=64',
  './assets/diary-conflicts.css?v=64',
  './assets/icons.svg',
  './src/history-engine.js?v=64',
  './src/backup-confirm.js?v=64',
  './src/notification-routing.js?v=64',
  './src/diary-conflicts.js?v=64',
  './src/app.bundle.js?v=64',
  './src/weekly-metrics.js?v=64',
  './src/daily-focus.js?v=64',
  './src/habit-drafts.js?v=64',
  './src/sheet-navigation.js?v=64',
  './src/habit-trash.js?v=64',
  './src/relapse-reason.js?v=64',
  './src/urge-relief.js?v=64',
  './src/chunk-diary.js?v=64',
  './src/chunk-grow.js?v=64',
  './src/chunk-social.js?v=64',
  './src/chunk-plus.js?v=64',
];
const OPTIONAL = [
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './vendor/cloud-sdk.js?v=64',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(REQUIRED.map((u) => new Request(u, { cache: 'reload' })));
    await Promise.allSettled(OPTIONAL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    // v53：不再自动 skipWaiting。装好的新版停在 waiting，由页面弹「新版本已就绪」，
    // 用户点了才让路 —— 否则正在写日记的人会被静默换版本。
  })());
});

// 页面点「刷新」后发来 SKIP_WAITING，这时才激活
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (!url.pathname.startsWith(APP_BASE.pathname)) return;

  // 页面导航：网络优先（3 秒），失败回退缓存壳
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const fresh = await fetch(req, { signal: controller.signal });
        if (fresh && fresh.ok) {
          await cache.put('./index.html', fresh.clone()).catch(() => {});
          return fresh;
        }
        throw new Error('bad response');
      } catch (err) {
        const cached = (await cache.match('./index.html')) || (await cache.match('./'));
        if (cached) return cached;
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>日拱一卒</title>' +
          '<div style="font-family:system-ui;text-align:center;padding:48px 16px">' +
          '<h1>日拱一卒</h1><p>首次打开需要联网，请稍后重试。</p></div>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      } finally {
        clearTimeout(timeout);
      }
    })());
    return;
  }

  // 其余同源资源：缓存优先，未命中再走网络并补缓存
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) await cache.put(req, fresh.clone()).catch(() => {});
      return fresh;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});


// Reuse app windows without reloading an in-progress editor.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data || {};
    let original;
    try { original = new URL(data.url || './', APP_BASE); } catch (_) { original = APP_BASE; }
    if (original.origin !== APP_BASE.origin || ![APP_BASE.pathname, APP_BASE.pathname + 'index.html'].includes(original.pathname)) original = APP_BASE;
    const target = new URL(APP_BASE.href);
    const id = original.searchParams.get('reminder') || original.searchParams.get('check') || '';
    if (event.action === 'snooze' && id) target.searchParams.set('snooze', id);
    else if (id) target.searchParams.set('reminder', id);
    else if (['#diary', '#grow'].includes(original.hash)) target.hash = original.hash;
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      const url = new URL(client.url);
      if (url.origin !== APP_BASE.origin || ![APP_BASE.pathname, APP_BASE.pathname + 'index.html'].includes(url.pathname)) continue;
      try {
        await client.focus();
        client.postMessage({ type: 'remind-open', url: target.href });
        return;
      } catch (_) { /* A closing window should not swallow the notification. */ }
    }
    await self.clients.openWindow(target.href);
  })());
});
