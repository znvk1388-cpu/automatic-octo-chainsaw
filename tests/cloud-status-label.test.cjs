const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/app.bundle.js'),'utf8');
function html(state,msg,autoSync=true){const a=source.indexOf('function v(){const e=Store.saveStatus'),b=source.indexOf('function g(){',a);const ctx={Store:{s:{settings:{autoSync}},saveStatus:{state:'saved'}},Cloud:{status:{state,msg},signedIn:()=>true},t:String};ctx.window=ctx;vm.runInNewContext(source.slice(a,b)+';this.result=v();',ctx);return ctx.result;}
test('signed-in alone does not claim records have synced',()=>{const s=html('signed','');assert.ok(!s.includes('云端已同步'));assert.match(s,/已登录/)});
test('a confirmed sync, pending change, failure and paused sync are distinct',()=>{assert.match(html('signed','已同步 12:30'),/云端已同步/);assert.match(html('pending',''),/待同步/);assert.match(html('error',''),/未连接/);assert.match(html('signed','',false),/已暂停/)});

test('actual cloud boot reports backend outage and leaves local records intact',async()=>{
 const data={items:[{id:'h'}],logs:{'2026-10-30':{h:{v:3}}},settings:{}};const before=JSON.stringify(data);
 const sdk={createWorkBuddyCloud(){return {auth:{onAuthStateChange(){},async handleWechatWebCallback(){return {}},async getSession(){return {data:null}}}}}};
 const ctx={console,URL,AbortController,Store:{s:data},document:{addEventListener(){}},setTimeout,clearTimeout,setInterval(){},navigator:{onLine:true},async fetch(){throw new TypeError('Failed to fetch')},WorkBuddyCloud:sdk,addEventListener(){}};ctx.window=ctx;
 vm.runInNewContext(source.slice(source.indexOf('window.Cloud='),source.indexOf('window.WebDAV=')).replace(/,\s*$/,';'),ctx);
 await ctx.Cloud.boot();assert.equal(ctx.Cloud.status.state,'down');assert.match(ctx.Cloud.status.msg,/记录保留在本机/);assert.equal(JSON.stringify(data),before);
});
