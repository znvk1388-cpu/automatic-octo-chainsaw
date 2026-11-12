'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test'),path=require('node:path');
const bundle=fs.readFileSync(path.join(__dirname,'../src/app.bundle.js'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(options={}){
 const data={version:7,deviceId:'test-device',items:[],logs:{},notes:{},media:{},settings:{nickname:'模拟用户',cloudAccountId:'test-owner',cloudEnc:0,autoSync:false,cloudMedia:false}};
 const storage=options.storage||new Map(),messages=[];
 const backend=options.backend||{remote:null,revision:1,calls:[],conflict:false,failPush:false};
 const sdk={auth:{onAuthStateChange(){},async handleWechatWebCallback(){return {}},async getSession(){return {data:{user:{id:'test-owner',isAnonymous:false}}}}},database:{async rpc(name,args){
   backend.calls.push({name,payload:args.p_payload?clone(args.p_payload):null});
   if(name.endsWith('_push')){
     if(backend.failPush)throw new Error('模拟上传失败');
     if(backend.beforePush)await backend.beforePush();
     const conflict=backend.conflict||args.p_revision!==backend.revision;
     if(!conflict&&!backend.ignorePush){backend.remote=clone(args.p_payload);backend.revision++;}
     return {data:{owner_id:'test-owner',revision:backend.revision,payload:clone(backend.remote),conflict,updated_at:new Date().toISOString()}};
   }
   return {data:{owner_id:'test-owner',revision:backend.revision,payload:clone(backend.remote),conflict:backend.conflict,updated_at:new Date().toISOString()}};
 }}};
 const c={console,URL,AbortController,TextEncoder,TextDecoder,crypto:globalThis.crypto,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),setTimeout,clearTimeout,setInterval(){},navigator:{onLine:true},document:{hidden:false,addEventListener(){},dispatchEvent(){}},CustomEvent:class{constructor(type){this.type=type}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},async fetch(){return {status:200,headers:{get:()=> 'application/json'}}},WorkBuddyCloud:{createWorkBuddyCloud:()=>sdk},addEventListener(){},U:{hhmm:()=> '12:00'},UI:{render(){}},UX:{async prompt(){return 'test-password-123'},async confirm(){return true}},o:message=>messages.push(message)};
 c.window=c;
 c.Store={s:data,commit(fn){fn(data);c.SyncModel.observe(data)},async saveNow(){c.SyncModel.observe(data)},bump(){},emit(){},async saveRecovery(){}};
 vm.createContext(c);
 function run(a,z){const start=bundle.indexOf(a),end=bundle.indexOf(z,start);assert.ok(start>=0&&end>start);vm.runInContext(bundle.slice(start,end).replace(/,\s*$/,';'),c)}
 run('window.Enc=','window.Store=');run('window.SyncModel=','window.Cloud=');
 c.SyncModel.prepare(data,false);if(!backend.remote)backend.remote=clone(c.SyncModel.payload(data));run('window.Cloud=','window.WebDAV=');
 const start=bundle.indexOf('async togglecloudenc()'),end=bundle.indexOf(',newquote()',start);assert.ok(start>=0&&end>start);
 vm.runInContext('actions={'+bundle.slice(start,end)+'}',c);
 return {c,data,backend,storage,messages,pushes:()=>backend.calls.filter(x=>x.name.endsWith('_push'))};
}
async function signed(){const f=fixture();await f.c.Cloud.boot();return f}

test('开启加密且记录不变时，实际同步仍把已有明文转换为密文',async()=>{
 const f=await signed();f.c.Cloud.setEncPassphrase('test-password-123');f.data.settings.cloudEnc=1;
 await f.c.Cloud.syncNow();assert.equal(f.pushes().length,1);assert.equal(f.c.Enc.isEnvelope(f.backend.remote),true);
 const payload=JSON.parse(await f.c.Enc.decrypt(f.backend.remote,'test-password-123'));assert.equal(payload.settings.nickname,'模拟用户');
 await f.c.Cloud.syncNow();assert.equal(f.pushes().length,1,'格式和内容不变时不重复上传');
});

test('实际开关完成开启、关闭往返，并同步转换远端格式',async()=>{
 const f=await signed();await f.c.actions.togglecloudenc();assert.equal(f.data.settings.cloudEnc,1);assert.equal(f.c.Enc.isEnvelope(f.backend.remote),true);
 await f.c.actions.togglecloudenc();assert.equal(f.data.settings.cloudEnc,0);assert.equal(f.c.Enc.isEnvelope(f.backend.remote),false);assert.ok(f.backend.remote.items);
 assert.equal(f.storage.get('rgz-cloud-enc-pass'),'test-password-123','关闭后仍能读取旧备份');
});

test('旧布尔开启值与数字开启值保持同一编码策略',async()=>{
 const f=await signed();f.c.Cloud.setEncPassphrase('test-password-123');f.data.settings.cloudEnc=true;
 assert.equal(f.c.Cloud.encEnabled(),true);await f.c.Cloud.syncNow();assert.equal(f.c.Enc.isEnvelope(f.backend.remote),true);
 await f.c.actions.togglecloudenc();assert.equal(f.data.settings.cloudEnc,0);
});

test('上传失败保持本机加密策略，并明确提示云端尚未完成转换',async()=>{
 const f=await signed();f.backend.failPush=true;await f.c.actions.togglecloudenc();
 assert.equal(f.data.settings.cloudEnc,1);assert.equal(f.c.Enc.isEnvelope(f.backend.remote),false);
 assert.match(f.messages.at(-1),/未完成|未更新|失败/);assert.doesNotMatch(f.messages.at(-1),/已换用|已加密完成/);
 assert.equal(f.c.Cloud.status.state,'error');
});

test('密码未能持久化时不能把加密开关标成成功',async()=>{
 const f=await signed();f.c.localStorage.setItem=()=>{throw new Error('storage blocked')};await f.c.actions.togglecloudenc();
 assert.notEqual(f.data.settings.cloudEnc,1);assert.equal(f.pushes().length,0);assert.match(f.messages.at(-1),/失败|无法保存/);
});

test('新设备没有密码或密码错误时，不覆盖已有密文',async()=>{
 const f=await signed();const envelope=await f.c.Enc.encrypt(JSON.stringify(f.backend.remote),'test-password-123');f.backend.remote=envelope;
 await assert.rejects(()=>f.c.Cloud.syncNow(),/同一个|密码/);assert.equal(f.pushes().length,0);
 f.c.Cloud.setEncPassphrase('wrong-password');await assert.rejects(()=>f.c.Cloud.syncNow(),/密码/);assert.equal(f.pushes().length,0);assert.deepEqual(f.backend.remote,envelope);
});

test('换密码成功后新密码可恢复，旧密码不能解开当前副本',async()=>{
 const f=await signed();f.c.Cloud.setEncPassphrase('test-password-123');f.data.settings.cloudEnc=1;await f.c.Cloud.syncNow();
 await f.c.Cloud.reencrypt('test-password-123','new-password-456');
 assert.equal(f.storage.get('rgz-cloud-enc-pass'),'new-password-456');await assert.rejects(()=>f.c.Enc.decrypt(f.backend.remote,'test-password-123'));
 assert.equal(JSON.parse(await f.c.Enc.decrypt(f.backend.remote,'new-password-456')).settings.nickname,'模拟用户');
});

test('换密码遇到并发版本冲突不报成功，恢复原来的本机密码',async()=>{
 const f=await signed();f.c.Cloud.setEncPassphrase('test-password-123');f.data.settings.cloudEnc=1;f.backend.conflict=true;
 await assert.rejects(()=>f.c.Cloud.reencrypt('test-password-123','new-password-456'),/更新|冲突|重试/);
 assert.equal(f.storage.get('rgz-cloud-enc-pass'),'test-password-123');
});


test('服务器没有确认转换后的密文格式时不能提示已加密完成',async()=>{
 const f=await signed();f.backend.ignorePush=true;await f.c.actions.togglecloudenc();
 assert.equal(f.c.Enc.isEnvelope(f.backend.remote),false);assert.match(f.messages.at(-1),/未完成|未确认|失败/);assert.equal(f.c.Cloud.status.state,'error');
});

function pauseFirstPush(f){
 let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);let calls=0;
 f.backend.beforePush=async()=>{if(++calls===1){entered();await gate}};
 return {started,release};
}

test('两个换密码请求串行执行，失败的旧操作不能回滚成功后的口令',async()=>{
 const f=await signed();f.c.Cloud.setEncPassphrase('test-password-123');f.data.settings.cloudEnc=1;
 const gate=pauseFirstPush(f),a=f.c.Cloud.reencrypt('test-password-123','password-A-123');await gate.started;
 const b=f.c.Cloud.reencrypt('test-password-123','password-B-456').catch(error=>error);
 await new Promise(resolve=>setImmediate(resolve));const pulls=f.backend.calls.filter(x=>x.name.endsWith('_pull')).length;
 gate.release();const results=await Promise.allSettled([a,b]);
 assert.equal(pulls,1,'第一项换密完成前，第二项不能改动口令或读取远端');assert.equal(results[0].status,'fulfilled');
 assert.ok(await f.c.Enc.decrypt(f.backend.remote,f.storage.get('rgz-cloud-enc-pass')));
});

test('换密码期间的普通同步排队，不用临时口令读取旧密文',async()=>{
 const f=await signed();f.c.Cloud.setEncPassphrase('test-password-123');f.data.settings.cloudEnc=1;await f.c.Cloud.syncNow();f.backend.calls=[];
 const gate=pauseFirstPush(f),rotation=f.c.Cloud.reencrypt('test-password-123','password-A-123');await gate.started;
 const sync=f.c.Cloud.syncNow().catch(error=>error);await new Promise(resolve=>setImmediate(resolve));
 const pulls=f.backend.calls.filter(x=>x.name.endsWith('_pull')).length;gate.release();await rotation;const result=await sync;
 assert.equal(pulls,1);assert.ok(!(result instanceof Error));assert.equal(f.c.Cloud.status.state,'signed');
 assert.ok(await f.c.Enc.decrypt(f.backend.remote,f.storage.get('rgz-cloud-enc-pass')));
});


test('开关变化等待换密结束，不在进行中的上传期间改写策略',async()=>{
 const f=await signed();f.c.Cloud.setEncPassphrase('test-password-123');f.data.settings.cloudEnc=1;await f.c.Cloud.syncNow();
 const gate=pauseFirstPush(f),rotation=f.c.Cloud.reencrypt('test-password-123','password-A-123');await gate.started;
 const off=f.c.Cloud.changeEncryption(false);await new Promise(resolve=>setImmediate(resolve));const during=f.data.settings.cloudEnc;
 gate.release();await rotation;await off;assert.equal(during,1);assert.equal(f.data.settings.cloudEnc,0);assert.equal(f.c.Enc.isEnvelope(f.backend.remote),false);
});

test('换密码也必须收到密文确认，不能把未转换的旧明文当作成功',async()=>{
 const f=await signed();f.c.Cloud.setEncPassphrase('test-password-123');f.data.settings.cloudEnc=1;f.backend.ignorePush=true;
 await assert.rejects(()=>f.c.Cloud.reencrypt('test-password-123','password-A-123'),/未确认|未完成/);
 assert.equal(f.storage.get('rgz-cloud-enc-pass'),'test-password-123');
});


test('另一设备沿用关闭设置时，普通同步不能把已有密文降级成明文',async()=>{
 const a=await signed();a.c.Cloud.setEncPassphrase('test-password-123');a.data.settings.cloudEnc=1;await a.c.Cloud.syncNow();
 const b=await signed();b.backend.remote=clone(a.backend.remote);b.c.Cloud.setEncPassphrase('test-password-123');assert.equal(b.data.settings.cloudEnc,0);
 await b.c.Cloud.syncNow();assert.equal(b.c.Enc.isEnvelope(b.backend.remote),true);assert.equal(b.data.settings.cloudEnc,1);
 b.data.settings.nickname='第二台设备编辑';b.c.SyncModel.observe(b.data);await b.c.Cloud.syncNow();assert.equal(b.c.Enc.isEnvelope(b.backend.remote),true);
 assert.equal(JSON.parse(await b.c.Enc.decrypt(b.backend.remote,'test-password-123')).settings.nickname,'第二台设备编辑');
});

test('关闭加密后到达的旧换密请求必须拒绝，不改动保留的旧密码',async()=>{
 const f=await signed();f.c.Cloud.setEncPassphrase('test-password-123');
 await assert.rejects(()=>f.c.Cloud.reencrypt('test-password-123','password-A-123'),/先开启|已关闭/);
 assert.equal(f.storage.get('rgz-cloud-enc-pass'),'test-password-123');assert.equal(f.pushes().length,0);
});


test('同源两个标签换密冲突时，失败标签不能覆盖另一标签成功保存的密码',async()=>{
 const a=await signed();a.c.Cloud.setEncPassphrase('test-password-123');a.data.settings.cloudEnc=1;await a.c.Cloud.syncNow();
 const b=fixture({storage:a.storage,backend:a.backend});b.data.settings.cloudEnc=1;await b.c.Cloud.boot();
 const gate=pauseFirstPush(a);const first=a.c.Cloud.reencrypt('test-password-123','password-A-123').catch(error=>error);await gate.started;
 await b.c.Cloud.reencrypt('test-password-123','password-B-456');gate.release();await first;
 assert.equal(a.storage.get('rgz-cloud-enc-pass'),'password-B-456');assert.ok(await a.c.Enc.decrypt(a.backend.remote,a.storage.get('rgz-cloud-enc-pass')));
});
