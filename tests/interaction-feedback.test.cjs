'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createFeedback = require('../src/interaction-feedback.js');

function fixture() {
  const animations = [], rings = [], listeners = {};
  function element() {
    return {
      isConnected:true, dataset:{id:'habit'}, children:[], removed:false,
      setAttribute(name,value){this[name]=value;},
      appendChild(child){this.children.push(child);},
      remove(){this.removed=true;},
      animate(frames,options){
        let resolve,reject;
        const animation={frames,options,cancelled:false,finished:new Promise((yes,no)=>{resolve=yes;reject=no;}),
          cancel(){if(!this.cancelled){this.cancelled=true;reject(new Error('cancelled'));}},finish(){resolve();}};
        animations.push(animation);return animation;
      }
    };
  }
  const mark=element(),anchor=element(),value=element(),row=element();
  row.querySelector=selector=>selector.startsWith('.stepper')?value:selector==='.tick,.p-tile-ring'?anchor:mark;
  const doc={hidden:false,querySelectorAll:()=>[row],createElement(){const ring=element();rings.push(ring);return ring;},
    addEventListener(name,handler){(listeners[name]??=[]).push(handler);}};
  const media={matches:false,addEventListener(name,handler){this.changed=handler;}};
  const root={document:doc,matchMedia:()=>media,Store:{commit(){throw Error('Feedback must not write data');}}};
  return {feedback:createFeedback(root),root,row,mark,anchor,value,animations,rings,listeners,media};
}

test('confirmed completion animates the mark and one decorative ring, then removes it',async()=>{
  const f=fixture();f.feedback.update('habit',true);
  assert.equal(f.animations.length,2);assert.equal(f.rings.length,1);assert.equal(f.rings[0]['aria-hidden'],'true');
  for(const animation of f.animations){
    assert.equal(animation.options.fill,'none');
    for(const frame of animation.frames)assert.ok(Object.keys(frame).every(key=>['transform','opacity','offset'].includes(key)));
    animation.finish();
  }
  await Promise.resolve();assert.equal(f.rings[0].removed,true);
});

test('rapid updates cancel the previous feedback without removing the new ring',async()=>{
  const f=fixture();f.feedback.update('habit',true);const first=[...f.animations];
  f.feedback.update('habit',true);
  assert.ok(first.every(a=>a.cancelled));assert.equal(f.rings[0].removed,true);
  await Promise.resolve();assert.equal(f.rings[1].removed,false);
  f.feedback.cancelAll();assert.equal(f.rings[1].removed,true);
});

test('a value update produces one short feedback and no success decoration',()=>{
  const f=fixture();f.feedback.update('habit',false);
  assert.equal(f.animations.length,1);assert.equal(f.animations[0].options.duration,140);assert.equal(f.rings.length,0);
  f.feedback.cancelAll();
});

test('reduced motion prevents effects and cancels effects when changed at runtime',()=>{
  const f=fixture();f.feedback.install();f.feedback.install();
  assert.equal(f.listeners['rigong:before-render'].length,1);
  f.feedback.update('habit',true);f.media.matches=true;f.media.changed();
  assert.ok(f.animations.every(a=>a.cancelled));assert.equal(f.rings[0].removed,true);
  f.feedback.update('habit',true);assert.equal(f.animations.length,2);
});

test('hidden pages, detached rows, and unavailable animation APIs remain safe',()=>{
  const f=fixture();f.root.document.hidden=true;f.feedback.update('habit',true);assert.equal(f.animations.length,0);
  f.root.document.hidden=false;f.row.isConnected=false;f.feedback.update('habit',true);assert.equal(f.animations.length,0);
  f.row.isConnected=true;f.mark.animate=undefined;f.anchor.animate=undefined;
  assert.doesNotThrow(()=>f.feedback.update('habit',true));assert.equal(f.rings.length,0);
});

test('navigation and backgrounding clean up feedback before the next screen',()=>{
  const f=fixture();f.feedback.install();f.feedback.update('habit',true);
  f.listeners['rigong:before-render'][0]();assert.ok(f.animations.every(a=>a.cancelled));
  f.feedback.update('habit',true);f.root.document.hidden=true;f.listeners.visibilitychange[0]();
  assert.ok(f.animations.every(a=>a.cancelled));assert.ok(f.rings.every(r=>r.removed));
});
