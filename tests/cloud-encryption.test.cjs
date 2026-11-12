'use strict';
// 云端备份加密（端到端）测试：
// 1) Enc 信封（PBKDF2 + AES-GCM）在 Node WebCrypto 下的加解密往返
// 2) 云同步模块确实在 push 前加密、pull 后解密、跳过对密文的校验
// 3) 设置入口与默认关闭
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const bundle = fs.readFileSync(path.join(root, 'src', 'app.bundle.js'), 'utf8');

// 提取 window.Enc=function(){...}() 并在沙箱中执行
function loadEnc() {
  const start = bundle.indexOf('window.Enc=function()');
  assert.ok(start >= 0, '找不到 Enc 模块');
  let i = bundle.indexOf('{', start), depth = 0, end = -1;
  for (; i < bundle.length; i++) {
    if (bundle[i] === '{') depth++;
    else if (bundle[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > 0, 'Enc 模块边界解析失败');
  const src = bundle.slice(start, end) + '()';
  const sandbox = {
    window: { crypto: globalThis.crypto },
    crypto: globalThis.crypto,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    TextEncoder, TextDecoder, console
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.Enc;
}

function cloudModule() {
  const i = bundle.indexOf('window.Cloud=function()');
  const j = bundle.indexOf('window.WebDAV=');
  assert.ok(i >= 0 && j > i, '找不到 Cloud 模块');
  return bundle.slice(i, j);
}

test('Enc 加密 → 解密往返一致（Node WebCrypto）', async () => {
  const Enc = loadEnc();
  assert.ok(Enc.available(), 'WebCrypto 应可用');
  const payload = JSON.stringify({ version: 7, items: [{ id: 'a1', name: '喝水' }], logs: { '2026-11-11': { a1: { v: 1 } } }, notes: {}, settings: { nickname: '测试' } });
  const env = await Enc.encrypt(payload, 'cloud-pass-123');
  assert.equal(env.format, 'rigongyizhu-enc-v1');
  assert.equal(env.cipher, 'AES-GCM-256');
  assert.equal(env.kdf, 'PBKDF2-SHA256');
  assert.ok(Number(env.iter) >= 210000, '迭代次数不应低于 21 万');
  assert.ok(Enc.isEnvelope(env), '信封应被识别');
  assert.equal(JSON.stringify(env).includes('喝水'), false, '密文不应包含明文内容');
  const back = await Enc.decrypt(env, 'cloud-pass-123');
  assert.equal(back, payload, '解密结果应与原文一致');
});

test('Enc 错误密码解密必须失败', async () => {
  const Enc = loadEnc();
  const env = await Enc.encrypt('{"a":1}', 'cloud-pass-123');
  await assert.rejects(() => Enc.decrypt(env, 'wrong-pass-1'), /密码不对|改动过/);
});

test('Enc 对损坏信封给出明确错误', async () => {
  const Enc = loadEnc();
  await assert.rejects(() => Enc.decrypt({ format: 'rigongyizhu-enc-v1', data: 'x', salt: 'y', iv: 'z' }, 'cloud-pass-123'), /密码不对|损坏|改动过/);
  await assert.rejects(() => Enc.decrypt({ format: 'rigongyizhu-enc-v1' }, 'p'), /不完整/);
});

test('云同步 push 前加密：p_payload 走 encPayload', () => {
  const cloud = cloudModule();
  const pushFn = cloud.match(/async function P\(t,e,n,pass\)\{[^}]*p_payload[^}]*\}/);
  assert.ok(pushFn, '找不到 push 函数');
  assert.match(pushFn[0], /encPayload\(t,pass\)/, 'push 前必须先加密载荷');
  assert.match(pushFn[0], /p_payload:p[,}]/, '上传的应是加密后的载荷');
});

test('云同步 pull 后解密：密文先解密再校验', () => {
  const cloud = cloudModule();
  const lFn = cloud.match(/async function L\(t,e,n,pass\)\{[\s\S]*?\}let T=/);
  assert.ok(lFn, '找不到读取函数 L');
  assert.match(lFn[0], /Enc\.isEnvelope\(s\.payload\)/, '应识别信封');
  assert.match(lFn[0], /decPayload\(s\.payload,pass\)/, '密文应解密');
  assert.match(lFn[0], /SyncModel\.validate\(s\.payload\)/, '解密后仍要过结构校验');
  assert.ok(!/return s\.payload&&SyncModel\.validate/.test(lFn[0]), '不能对密文直接校验后原样返回');
});

test('加密开启但没设密码时，拒绝上传并给出可读错误', () => {
  const cloud = cloudModule();
  assert.match(cloud, /function encOn\(\)/, '加密策略由统一入口读取；数字和布尔兼容由行为测试覆盖');
  assert.match(cloud, /云端备份加密已开启，但本机还没设置密码/);
  assert.match(cloud, /云端备份密码不对，无法解密/);
});

test('口令只存本机 localStorage，不进同步载荷', () => {
  const cloud = cloudModule();
  assert.match(cloud, /rgz-cloud-enc-pass/, '口令应存 localStorage');
  const sync = bundle.indexOf('window.SyncModel=function()');
  const syncEnd = sync >= 0 ? sync + 6000 : 0;
  const syncSeg = bundle.slice(sync, syncEnd);
  assert.ok(!/rgz-cloud-enc-pass/.test(syncSeg), '同步载荷构造不应包含口令');
  // settings 白名单只同步 nickname/seedPts，cloudEnc 不会上云
  assert.match(syncSeg, /\["nickname","seedPts"\]/);
});

test('更换密码必须先用旧密码解开云端再重新上传', () => {
  const cloud = cloudModule();
  assert.match(cloud, /async function reEncRemote\(oldPass,newPass\)/);
  assert.match(cloud, /reencrypt:reEncRemote/, '应导出为 Cloud.reencrypt');
  // 临时口令作为显式参数，不写共享存储；并发冲突由真实行为测试覆盖。
  assert.match(cloud, /M\(ctx,oldPass\)/);
  assert.match(cloud, /P\(pl,remote,ctx,newPass\)/);
});

test('设置入口存在且默认关闭', () => {
  assert.match(bundle, /data-act="togglecloudenc"/, '设置页应有加密开关');
  assert.match(bundle, /data-act="cloudencpass"/, '开启后应有更换密码入口');
  assert.match(bundle, /a\.settings\.cloudEnc\?" on":""/, '开关默认应为关');
  assert.match(bundle, /async togglecloudenc\(\)/, '处理器存在');
  assert.match(bundle, /async cloudencpass\(\)/, '换密码处理器存在');
});
