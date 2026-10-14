// A new entry URL bypasses old workers that cached the previous app.js graph.
import('./releases/naac-v10/app.js').catch(() => {
 const notice=document.getElementById('appLoadError');
 if(notice){notice.hidden=false;notice.textContent='EcoLens could not finish loading. Reconnect and refresh this page. Your saved progress stays in this browser.';}
});
