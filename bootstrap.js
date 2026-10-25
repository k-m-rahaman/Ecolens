// A new entry URL bypasses old workers that cached the previous app.js graph.
// Repeat the redirect here so cached HTML also reaches the supported app.
if (location.hostname === 'k-m-rahaman.github.io' && /^\/Ecolens(?:\/|$)/.test(location.pathname)) {
 const hash=['#scan','#journey','#reports','#settings'].includes(location.hash)?location.hash:'#scan';
 location.replace(`https://ecolens-live.web.app/${hash}`);
} else {
 import('./releases/naac-v19/app.js').catch(() => {
  const notice=document.getElementById('appLoadError');
  if(notice){notice.hidden=false;notice.textContent='EcoLens could not finish loading. Reconnect and refresh this page. Your saved progress stays in this browser.';}
 });
}
