'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/app.bundle.js'), 'utf8');
const begin = source.indexOf('obstart(){');
const end = source.indexOf(',obskip(){', begin);
assert.ok(begin >= 0 && end > begin);

function fixture(selected = true) {
  const data = {items:[], logs:{}, settings:{}};
  const Store = {s:data, commit(fn){if(fn) fn(data);}};
  const Feat = {LIB:[{name:'阅读', type:'check'}], addItem(item){data.items.push({...item, id:'new'});}};
  const calls = [];
  const context = {Store, Feat, document:{querySelectorAll(){return selected ? [{dataset:{i:'0'}}] : [];}},
    UI:{closeSheet(){calls.push('close');},go(page){calls.push(page);}}, o(message){calls.push(message);}};
  vm.createContext(context);
  vm.runInContext('this.actions = {' + source.slice(begin,end) + '};', context);
  return {data, context, calls};
}

test('onboarding does not delete habits that arrive after the guide opened', () => {
  const f=fixture();
  f.data.items.push({id:'synced', name:'已有习惯', deleted:false});
  f.data.logs['2026-10-27']={synced:{d:true,v:1}};
  f.context.actions.obstart();
  assert.equal(f.data.items[0].deleted,false);
  assert.equal(f.data.logs['2026-10-27'].synced.d,true);
  assert.equal(f.data.items[1].name,'阅读');
  assert.equal(f.data.settings.onboarded,1);
  assert.deepEqual(f.calls.slice(0,2),['close','today']);
});

test('onboarding with no selected habit does not change data', () => {
  const f=fixture(false);
  f.data.items.push({id:'synced', deleted:false});
  f.context.actions.obstart();
  assert.equal(f.data.items.length,1);
  assert.equal(f.data.items[0].deleted,false);
  assert.equal(f.data.settings.onboarded,undefined);
});
