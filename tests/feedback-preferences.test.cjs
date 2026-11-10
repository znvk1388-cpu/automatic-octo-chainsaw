'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../src/app.bundle.js'),'utf8');

function effects() {
  const frames=[], pieces=[];
  let layer;
  function node(){return {className:'',style:{setProperty(){}},children:[],set id(value){this._id=value;layer=this;},get id(){return this._id;},
    appendChild(child){this.children.push(child);if(!this.fragment&&child.className==='fx-piece')pieces.push(child);if(child.fragment)child.children.forEach(c=>{if(c.className==='fx-piece')pieces.push(c);});},
    querySelectorAll(){return pieces;},remove(){this.removed=true;}};}
  const document={getElementById(){return layer;},createElement:node,createDocumentFragment(){const n=node();n.fragment=true;return n;},body:node()};
  const root={document,innerWidth:390,matchMedia:()=>({matches:false})};
  const context={window:root,document,performance:{now:()=>0},requestAnimationFrame(fn){frames.push(fn);},setTimeout(){},Math};
  vm.createContext(context);
  const start=source.indexOf('function(){var t=["#4f6bed"'),end=source.indexOf('window.UX=',start);
  assert.ok(start>=0&&end>start);
  vm.runInContext('('+source.slice(start,end).replace(/,$/,'')+');',context);
  context.FX=root.FX;
  return {FX:root.FX,frames,pieces,document};
}

test('legacy completion celebration reads the updated motion preference and keeps the completion callback',()=>{
  const f=effects();f.FX.setReduced(true);
  let completed=0;f.FX.celebrate(100,'完成',{onEnd(){completed++;}});
  assert.equal(f.FX.reduced,true);assert.equal(f.pieces.length,0);assert.equal(f.document.body.children.length,0);assert.equal(completed,1);
  f.FX.setReduced(false);f.FX.confetti(60);assert.equal(f.pieces.length,24);
});

test('queued confetti batches stop emitting immediately after reduced motion is enabled',()=>{
  const f=effects();f.FX.confetti(80);assert.equal(f.pieces.length,24);assert.equal(f.frames.length,1);
  f.FX.setReduced(true);f.frames.shift()();assert.equal(f.pieces.length,24);assert.equal(f.frames.length,0);
});

function decreaseFixture(value){
  const item={id:'water',type:'number',unit:'杯'}, events={commits:0,values:0,vibration:0,feedback:0,patches:0};
  const context={j:()=>item,U:{today:()=> '2026-11-11',vibrate(){events.vibration++;}},Engine:{getLog:()=>({v:value}),addValue(item,date,amount){events.values++;value=Math.max(0,value+amount);}},Store:{commit(){events.commits++;}},UI:{patchToday(){events.patches++;return true;},render(){throw Error('Unexpected full render');}},h:()=>0,k(){events.feedback++;}};
  vm.createContext(context);const start=source.indexOf('minus(t){'),end=source.indexOf(',async setval(t)',start);
  assert.ok(start>=0&&end>start);vm.runInContext('decrease=({'+source.slice(start,end)+'}).minus',context);
  return {run(){context.decrease({dataset:{id:item.id}});},events,value:()=>value};
}

test('decreasing zero is a no-op without save, vibration, or feedback even if invoked directly',()=>{
  const f=decreaseFixture(0);f.run();assert.equal(f.value(),0);assert.deepEqual(f.events,{commits:0,values:0,vibration:0,feedback:0,patches:0});
});

test('positive values decrease once and cannot be decremented again after reaching zero',()=>{
  const f=decreaseFixture(1);f.run();f.run();assert.equal(f.value(),0);assert.deepEqual(f.events,{commits:1,values:1,vibration:1,feedback:1,patches:1});
});
