const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('../src/habit-drafts.js');
function fixture() {
 const fields = [{id:'fName',value:'',type:'text'},{id:'fTarget',value:'30',type:'number'}];
 const body = {querySelectorAll:()=>fields,insertAdjacentHTML(){}};
 const state = {deviceId:'device-a',settings:{cloudAccountId:'owner-a'},items:[{id:'h1',name:'阅读',target:30}]};
 const root = {document:{getElementById:id=>id==='sheetBody'?body:fields.find(f=>f.id===id),addEventListener(){}},addEventListener(){},Store:{s:state,commit:fn=>fn(state)},UI:{openHabit(item){fields[0].value=item?.name||'';fields[1].value=String(item?.target||30)},collectHabit(){return {name:fields[0].value.trim(),target:Number(fields[1].value),type:'number',schedule:{type:'daily'}}}}};
 const api=create(root);api.install();return {api,root,state,fields};
}
test('habit draft survives closing and reopening without mutating habit',()=>{
 const {api,root,state,fields}=fixture();root.UI.openHabit(state.items[0]);fields[0].value='读书草稿';fields[1].value='';api.beforeSheetChange();
 assert.equal(state.items[0].name,'阅读');root.UI.openHabit(state.items[0]);assert.equal(fields[0].value,'读书草稿');assert.equal(fields[1].value,'');
});
test('new drafts do not create habits, unchanged forms do not create drafts',()=>{
 const {api,root,state,fields}=fixture();root.UI.openHabit();api.beforeSheetChange();assert.equal(Object.keys(state._habitDrafts||{}).length,0);
 root.UI.openHabit();fields[0].value='新习惯';api.beforeSheetChange();root.UI.openHabit();assert.equal(fields[0].value,'新习惯');assert.equal(state.items.length,1);
});
test('save and explicit discard remove a draft; close does not recreate it',()=>{
 const {api,root,state,fields}=fixture();root.UI.openHabit(state.items[0]);fields[0].value='草稿';api.flush();api.clearSaved('h1');api.beforeSheetChange();root.UI.openHabit(state.items[0]);assert.equal(fields[0].value,'阅读');
 fields[0].value='另一个草稿';api.flush();api.discard();assert.equal(fields[0].value,'阅读');api.beforeSheetChange();assert.equal(Object.keys(state._habitDrafts||{}).length,0);
});
test('drafts are device and account scoped, switching scope cannot save old form',()=>{
 const {api,root,state,fields}=fixture();root.UI.openHabit(state.items[0]);fields[0].value='A的草稿';state.settings.cloudAccountId='owner-b';api.beforeSheetChange();root.UI.openHabit(state.items[0]);assert.equal(fields[0].value,'阅读');assert.equal(Object.keys(state._habitDrafts||{}).length,0);
});

test('hydration must finish before opening an editable draft',()=>{
 const {root,fields}=fixture();root.Store.isHydrated=()=>false;let calls=0;root.U={toast(){calls++}};fields[0].value='未打开';root.UI.openHabit();assert.equal(fields[0].value,'未打开');assert.equal(calls,1);
 root.Store.isHydrated=()=>true;root.UI.openHabit();assert.equal(fields[0].value,'');
});
