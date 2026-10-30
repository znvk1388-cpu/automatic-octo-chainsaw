/* Load the existing statistics chunk on demand, with a retryable sheet. */
(function(factory){
  if(typeof module==='object'&&module.exports) module.exports=factory;
  else window.FeatureLoading=factory(window);
})(function(root){
  'use strict';
  var pending=null,sequence=0;
  function preload(){
    if(root.Chart) return Promise.resolve();
    if(pending) return pending;
    pending=new Promise(function(resolve,reject){
      var script=root.document.createElement('script'),done=false;
      var timer=root.setTimeout(function(){finish(new Error('统计模块加载超时'));},10000);
      function finish(error){
        if(done)return;done=true;root.clearTimeout(timer);script.onload=script.onerror=null;
        if(error){script.remove();reject(error);}else resolve();
      }
      script.src='src/chunk-grow.js?v='+root.U.VERSION;script.async=true;
      script.onload=function(){finish(root.Chart?null:new Error('统计模块尚未就绪'));};
      script.onerror=function(){finish(new Error('统计模块下载失败'));};
      root.document.head.appendChild(script);
    }).finally(function(){pending=null;});
    return pending;
  }
  function habit(id){
    var token=String(++sequence);
    root.UI.sheet('习惯统计','<div data-feature-loading="'+token+'" role="status">正在加载统计…</div>');
    function current(){
      var sheet=root.document.getElementById('sheet');
      var panel=root.document.querySelector('[data-feature-loading]');
      return sheet&&sheet.classList.contains('on')&&panel&&panel.getAttribute('data-feature-loading')===token;
    }
    return preload().then(function(){if(current())root.UI.openHabitDetail(id);}).catch(function(){
      if(current())root.UI.sheet('统计暂时打不开','<p role="status">请检查网络后重试，已有记录仍保留在本机。</p><button type="button" class="btn block" data-feature-retry="'+root.U.esc(id)+'">重新加载统计</button>');
    });
  }
  root.document.addEventListener('click',function(event){
    var button=event.target&&event.target.closest&&event.target.closest('[data-feature-retry]');
    if(button){event.preventDefault();habit(button.dataset.featureRetry);}
  });
  return {preload:preload,habit:habit};
});
