/* Event-driven UI polish: no animation loop, layout changes or hidden content. */
export function initMotion(document, {reduceMotion=()=>false}={}) {
 const window=document.defaultView;
 const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
 const cards='.page-heading,.home-identity,.camera-card,.status-banner,.scan-scope,.card,.metric,.level-card,.tutorial-card,.history-item,.campus-overview-card,.public-report-banner,.report-shortcut,.component';
 const values='#xpTop,#journeyXp,.quick-stats b,.metric strong';
 const seen=new WeakSet(),previous=new WeakMap(),timers=new Map();
 const quiet=()=>reduceMotion()||media?.matches||document.hidden;
 function pulse(node,name,delay=0){
  if(quiet()||!node.isConnected)return;
  const running=timers.get(node);if(running){window.clearTimeout(running);node.classList.remove('motion-enter','motion-feedback','motion-value');}
  node.style.setProperty('--motion-delay',`${delay}ms`);node.classList.add(name);
  timers.set(node,window.setTimeout(()=>{node.classList.remove(name);node.style.removeProperty('--motion-delay');timers.delete(node);},650+delay));
 }
 const observer=typeof window.IntersectionObserver==='function'?new window.IntersectionObserver(entries=>{
  let order=0;
  for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);pulse(entry.target,'motion-enter',Math.min(order++,4)*35);}
 },{threshold:0.06}):null;
 function rememberValue(node){
  const value=node.textContent;
  if(previous.has(node)&&previous.get(node)!==value)pulse(node,'motion-value');
  previous.set(node,value);
 }
 function refresh(scope=document,restart=false){
  if(!scope?.querySelectorAll)return;
  const nodes=[...(scope.matches?.(cards)?[scope]:[]),...scope.querySelectorAll(cards)];
  let order=0;
  for(const node of nodes){
   if(!node.closest('.tab.active')||node.closest('[hidden]'))continue;
   if(restart){seen.delete(node);observer?.unobserve(node);}
   if(seen.has(node))continue;
   seen.add(node);
   if(quiet())continue;
   if(observer)observer.observe(node);else if(node.getClientRects().length)pulse(node,'motion-enter',Math.min(order++,4)*35);
  }
  for(const node of scope.querySelectorAll(values))rememberValue(node);
 }
 function clicked(event){
  const node=event.target.closest?.('button,.button');
  if(node&&!node.disabled)pulse(node,'motion-feedback');
 }
 const changes=typeof window.MutationObserver==='function'?new window.MutationObserver(records=>{
  for(const record of records){
   const target=record.target.nodeType===1?record.target:record.target.parentElement;
   const value=target?.closest(values);if(value)rememberValue(value);
   for(const node of record.addedNodes)if(node.nodeType===1)refresh(node);
   for(const node of record.removedNodes)if(node.nodeType===1){
    for(const removed of [node,...node.querySelectorAll(cards)])if(!removed.isConnected){
     observer?.unobserve(removed);const timer=timers.get(removed);if(timer)window.clearTimeout(timer);timers.delete(removed);
    }
   }
  }
 }):null;
 changes?.observe(document.body,{childList:true,subtree:true,characterData:true});
 document.addEventListener('click',clicked,{passive:true});
 refresh();
 return {refresh,disconnect(){observer?.disconnect();changes?.disconnect();document.removeEventListener('click',clicked);for(const [node,timer] of timers){window.clearTimeout(timer);node.classList.remove('motion-enter','motion-feedback','motion-value');}timers.clear();}};
}
