/* Notification taps open a view; explicit calendar check links retain their own handler. */
(function(factory){
  if(typeof module==='object'&&module.exports) module.exports=factory;
  else window.NotificationRouting=factory(window);
})(function(root){
  'use strict';
  var pending=null;
  function ready(){return !!(root.UI&&root.Store&&root.Store.s&&(!root.Store.isHydrated||root.Store.isHydrated()));}
  function open(value){
    if(!ready()){pending=value;return;}
    var url,base=new root.URL('./',root.location.href);
    try {
      url=new root.URL(value||'./',base);
      if(url.origin!==base.origin||(url.pathname!==base.pathname&&url.pathname!==base.pathname+'index.html')) url=base;
    } catch(_){ url=base; }
    var id=url.searchParams.get('reminder')||url.searchParams.get('check')||'';
    var snooze=url.searchParams.get('snooze');
    var items=root.Store&&root.Store.s&&root.Store.s.items||[];
    if(snooze){
      if(items.some(function(h){return h.id===snooze&&!h.deleted&&!h.archived;})&&root.Remind){
        root.Remind.snooze(snooze,30);root.U.toast('已推迟 30 分钟；网页关闭后请使用系统日历');
      } else root.U.toast('该习惯已不存在，未设置稍后提醒');
      return;
    }
    var sheet=root.document.getElementById('sheet'),confirm=root.document.getElementById('cfMask');
    if((sheet&&sheet.classList.contains('on'))||confirm){
      root.U.toast('提醒已打开，请先完成当前编辑，再查看习惯或日记');return;
    }
    var page=!id&&url.hash==='#diary'?'diary':!id&&url.hash==='#grow'?'grow':'today';
    root.UI.go(page);
    var item=id&&items.find(function(h){return h.id===id&&!h.deleted&&!h.archived;});
    if(item){
      if((item.type==='number'||item.type==='duration')&&root.UI.openQuickAdd) root.UI.openQuickAdd(id);
      else root.UI.openHabitMenu(id);
    }
  }
  function consume(){
    if(!ready()) return;
    if(pending!==null){var next=pending;pending=null;open(next);}
    var url=new root.URL(root.location.href);
    if(!url.searchParams.has('reminder')&&!url.searchParams.has('snooze')&&!['#diary','#grow'].includes(url.hash)) return;
    var target=url.href;
    url.searchParams.delete('reminder');url.searchParams.delete('snooze');
    if(['#diary','#grow'].includes(url.hash)) url.hash='';
    root.history.replaceState(root.history.state,'',url.href);
    open(target);
  }
  if(root.navigator&&root.navigator.serviceWorker){
    root.navigator.serviceWorker.addEventListener('message',function(event){
      var data=event.data||{};
      if(data.type==='remind-open'||data.type==='remind-click') open(data.url||'./');
    });
  }
  return {open:open,consume:consume};
});
