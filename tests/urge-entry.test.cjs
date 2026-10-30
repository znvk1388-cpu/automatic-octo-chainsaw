'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/app.bundle.js'), 'utf8');
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function section(start, end, offset=0) {
  const a=source.indexOf(start,offset), b=source.indexOf(end,a);
  assert.ok(a>=0 && b>a, 'actual home markup exists'); return source.slice(a,b);
}
function fixture(item) {
  const data={items:[item],logs:{}};
  const Engine={isDone:()=>false,isPartial:()=>false,getLog:()=>({}),progress:()=>0,isMiniDone:()=>false,slipped:()=>false};
  const context={U:{today:()=> '2026-10-29',esc,numShort:String},Engine,Extra:{isSkipped:()=>false},Product:{habitIcon:()=>'',icon:()=>''},t:()=>data,e:esc,n:()=>'',h:()=>'',b:()=>''};
  context.window=context;vm.createContext(context);
  vm.runInContext(section('function y(a){','let w=null,k=null;')+';this.list=y;',context);
  // The product grid uses its own local escaping helper.
  const grid=vm.createContext({U:context.U,Engine,Extra:context.Extra,t:esc,e:()=>'',window:context});
  vm.runInContext(section('function m(n){','function v(){',source.indexOf('window.Product='))+';this.grid=m;',grid);
  return {list:()=>context.list(item),grid:()=>grid.grid(item),data};
}
for (const view of ['list','grid']) {
  test(view+' exposes breathing directly only for avoid habits and leaves logs untouched',()=>{
    for (const type of ['avoid','check','duration','number']) {
      const item={id:'h1',name:'少刷手机',type,steps:[],target:1};const f=fixture(item),before=JSON.stringify(f.data);
      const html=f[view]();
      assert.equal((html.match(/data-rg-urge="open"/g)||[]).length,type==='avoid'?1:0,type);
      if(type==='avoid') assert.match(html,/先缓 90 秒/);
      assert.equal(JSON.stringify(f.data),before);
    }
  });
  test(view+' gives the breathing action a habit-specific escaped accessible name',()=>{
    const f=fixture({id:'h"<1',name:'<手机>"',type:'avoid',steps:[]});
    const button=f[view]().match(/<button[^>]*data-rg-urge="open"[^>]*>/)?.[0];
    assert.ok(button);assert.ok(button.includes('data-id="h&quot;&lt;1"'));
    assert.ok(button.includes('aria-label="先缓 90 秒：&lt;手机&gt;&quot;"'));
    assert.ok(!button.includes('<手机>'));
  });
}
