import {INSTITUTIONS,LEVELS,ROUTES,UPCYCLE,t} from './data.js';
import {loadAppState,persistState,addProfile,activeProfile,normalizeAnalysis,completeQuest,personalStats,campusStats,campusContributions,campusSummaries,exportState,importState} from './core.js';
import {initOffline,warmupOffline,getOfflineStatus} from './inference.js';
import {runScan,resetOnlineCooldown,resolveOnlineEndpoint,FIREBASE_ONLINE_ENDPOINT,cloudConsentAllowed,rememberFirebasePhotoConsent} from './scan-flow.js';
import {cameraConstraints,decodePhoto,captureGeometry} from './media.js';
import {contributionsCSV,institutionReportDirectory,institutionSummaryCSV} from './report.js';
import {createPublicSync,validatePublicEndpoint} from './public-sync.js';
import {createFirebasePublishTransport} from './firebase-sync.js';
import {DEFAULT_PUBLIC_NAAC_URL} from './public-config.js';
import {initMotion} from './motion.js';

const $=id=>document.getElementById(id);
let motion;
let state=loadAppState(),analysis=null,quest=null,rawCanvas=null,stream=null,request=null,requestId=0,busy=false,currentTutorial=null,modelReady=false,scannerWarmupScheduled=false,toastTimer,offlinePromise,pendingOnline=false,pendingLocal=false,acceptLocalAction=null,scanTicker=null,cameraRequestId=0,cameraDevices=[],selectedCamera=0,currentFacing='environment',photoWasCamera=false,reportSelection='*',publicSyncTimer=null,publicBusy=false,publicStatusText='';
const publicSync=createPublicSync({storage:globalThis.localStorage,publishTransport:createFirebasePublishTransport({storage:globalThis.localStorage})});
const language=()=>state.settings.language;
const prefersReducedMotion=()=>state.settings.reduceMotion||matchMedia('(prefers-reduced-motion: reduce)').matches;
const tr=(key,vars={})=>t(language(),key,vars);
const local=value=>typeof value==='string'?value:value?.[language()]||value?.en||'';
const el=(tag,className='',text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const save=()=>{try{persistState(state);schedulePublicSync();}catch{toast(tr('invalidImport'));}};
const uuid=()=>crypto.randomUUID();
const institutionName=profile=>profile?.customInstitution||INSTITUTIONS.find(x=>x.id===profile?.institutionId)?.name||tr('institution');
const locale=()=>({en:'en-IN',bn:'bn-IN',hi:'hi-IN'}[language()]);
const cloudUploadAllowed=()=>cloudConsentAllowed(state.settings);
let cloudConsentRecipient=resolveOnlineEndpoint(state.settings.endpoint);
let cloudFallbackKey='';
function renderCloudFallback(){
 const notice=$('cloudFallbackNotice');
 notice.hidden=!cloudFallbackKey||analysis?.source!=='offline';
 notice.textContent=notice.hidden?'':tr(cloudFallbackKey);
}
function cloudFallbackReason(code){
 if(['PROVIDER_QUOTA','RATE_LIMIT','DAILY_LIMIT'].includes(code))return 'cloudFallbackQuota';
 if(['ONLINE_TIMEOUT','PROVIDER_TIMEOUT'].includes(code))return 'cloudFallbackTimeout';
 return 'cloudFallbackUnavailable';
}
function renderCloudSettings(endpoint=state.settings.endpoint){
 const target=resolveOnlineEndpoint(endpoint),firebase=target===FIREBASE_ONLINE_ENDPOINT;
 cloudConsentRecipient=target;
 $('cloudStatus').textContent=tr(firebase?'firebaseCloudConnected':target?'cloudPrivacy':'cloudNotConnected');
 document.querySelector('[data-i18n="endpointHint"]').textContent=tr(firebase?'firebaseCloudHint':target?'endpointHint':'hostedEndpointHint');
 $('cloudConsentLabel').textContent=tr(firebase?'firebaseUploadConsent':'uploadConsent');
 $('cloudProviderPrivacy').hidden=!firebase;$('cloudProviderPrivacy').textContent=tr('firebaseCloudPrivacy');
}
function revokePhotoConsent(){
 if(busy){abortScan();analysis=null;quest=null;$('resultCard').hidden=true;$('questCard').hidden=true;}
 state.settings.cloudConsent=false;rememberFirebasePhotoConsent(false);$('cloudConsent').checked=false;save();
}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4300);}
function showTab(name){const changed=!$(`tab-${name}`)?.classList.contains('active');document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.id===`tab-${name}`));document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));history.replaceState(null,'',`#${name}`);window.scrollTo({top:0,behavior:prefersReducedMotion()?'instant':'smooth'});if(name==='scan')prepareScannerInBackground();motion?.refresh($(`tab-${name}`),changed);}
function refreshLanguage(){document.documentElement.lang=language();applyTheme();document.querySelectorAll('[data-i18n]').forEach(node=>node.textContent=tr(node.dataset.i18n));document.querySelectorAll('[data-placeholder]').forEach(node=>node.placeholder=tr(node.dataset.placeholder));$('languageSelect').value=language();document.querySelectorAll('[data-tab]').forEach(node=>{const label=tr(node.dataset.tab==='reports'?'naacReports':node.dataset.tab);node.setAttribute('aria-label',label);node.title=label;});refreshScene();document.body.classList.toggle('reduce-motion',state.settings.reduceMotion);renderAll();renderInstitutions();if(analysis)renderAnalysis();if(quest)renderQuest(true);if(currentTutorial)renderTutorial(currentTutorial);updateStatus();}
function renderInstitutions(){const previous=$('institutionSelect').value||activeProfile(state)?.institutionId||'brainware';const filter=$('institutionSearch').value.trim().toLowerCase();$('institutionSelect').replaceChildren();for(const kind of ['university','college','school']){const list=INSTITUTIONS.filter(x=>x.type===kind&&`${x.name} ${x.area}`.toLowerCase().includes(filter));if(!list.length)continue;const group=el('optgroup');group.label=tr(kind);for(const institution of list){const option=el('option','',`${institution.name} · ${institution.area}`);option.value=institution.id;group.append(option);}$('institutionSelect').append(group);}const other=el('option','',tr('other'));other.value='OTHER';$('institutionSelect').append(other);if([...$('institutionSelect').options].some(x=>x.value===previous))$('institutionSelect').value=previous;$('customInstitutionField').hidden=$('institutionSelect').value!=='OTHER';}
function openProfiles(){const profile=activeProfile(state);$('existingProfiles').replaceChildren();const createOption=el('option','',tr('enter'));createOption.value='';$('existingProfiles').append(createOption);for(const item of state.profiles){const option=el('option','',`${item.name} · ${institutionName(item)}`);option.value=item.id;$('existingProfiles').append(option);} $('existingProfileField').hidden=!state.profiles.length;$('nameInput').value=profile?.name||'';$('institutionSearch').value='';renderInstitutions();$('institutionSelect').value=profile?.customInstitution?'OTHER':profile?.institutionId||'brainware';$('customInstitutionInput').value=profile?.customInstitution||'';$('customInstitutionField').hidden=$('institutionSelect').value!=='OTHER';$('closeProfileDialog').hidden=!profile;$('profileDialog').showModal();}
function currentLevel(stats){let index=0;LEVELS.forEach((level,i)=>{if(stats.xp>=level.xp)index=i;});return {level:LEVELS[index],next:LEVELS[index+1],index};}
function metric(label,value){const node=el('div','metric');node.append(el('span','',label),el('strong','',value));return node;}
function renderAll(){const profile=activeProfile(state);$('homeIdentity').hidden=!profile;$('homeName').textContent=profile?.name||'';$('homeInstitution').textContent=profile?institutionName(profile):'';$('homeAvatar').textContent=profile?.name.slice(0,1).toUpperCase()||'';const stats=personalStats(state);const {level,next}=currentLevel(stats);$('profileInitial').textContent=profile?.name.slice(0,1).toUpperCase()||'E';$('profileLabel').textContent=profile?.name||tr('welcomeTitle');$('institutionLabel').textContent=institutionName(profile);$('xpTop').textContent=`✦ ${stats.xp} XP`;$('statXp').textContent=stats.xp;$('statStreak').textContent=stats.streak;$('statQuests').textContent=stats.quests;$('levelIcon').textContent=level.icon;$('levelName').textContent=local(level.name);$('nextLevelLabel').textContent=next?`${next.xp-stats.xp} XP → ${local(next.name)}`:tr('maxLevel');$('levelFill').style.width=next?`${Math.max(0,Math.min(100,(stats.xp-level.xp)/(next.xp-level.xp)*100))}%`:'100%';$('journeyXp').textContent=`✦ ${stats.xp} XP`;
 $('binLegend').replaceChildren();for(const id of ['organic','recycle','ewaste','residual','inert']){const route=ROUTES[id];const row=el('div','bin-row');const icon=el('span','bin-icon',route.icon);icon.style.background=`${route.color}18`;row.append(icon,el('span','',local(route.title)));const dot=el('span','bin-dot');dot.style.background=route.color;row.append(dot);$('binLegend').append(row);}
 $('levelGrid').replaceChildren();LEVELS.forEach((item,i)=>{const card=el('button',`level-card ${stats.xp>=item.xp?'unlocked':'locked'} ${item===level?'current':''}`);card.append(el('span','level-emoji',item.icon),el('h3','',local(item.name)),el('small','',`${stats.xp>=item.xp?'✓':'🔒'} ${item.xp} XP`));card.addEventListener('click',()=>toast(stats.xp>=item.xp?`${tr('level')} ${i+1} · ${local(item.name)}`:`${tr('locked')} · ${Math.max(0,item.xp-stats.xp)} XP`));$('levelGrid').append(card);});
 $('tutorialGrid').replaceChildren();UPCYCLE.forEach(tutorial=>{const button=el('button','tutorial-card');button.append(el('span','',tutorial.icon),el('h3','',local(tutorial.title)),el('p','',`${tr('startQuest')} ↗`));button.addEventListener('click',()=>openTutorial(tutorial));$('tutorialGrid').append(button);});
 const kg=n=>`${n.toFixed(2)} kg`;$('personalMetrics').replaceChildren(metric(tr('estimatedMass'),kg(stats.estimatedKg)),metric(tr('estimatedCo2'),kg(stats.estimatedCo2Kg)),metric(tr('sortingCount'),String(stats.sortCount)));
 renderCampusReport();renderPublicSharing();
 renderHistory('recentHistory',stats.events.slice().reverse().slice(0,3));renderHistory('fullHistory',stats.events.slice().reverse().slice(0,100));$('themeSelect').value=state.settings.theme||'system';$('endpointInput').value=state.settings.endpoint;$('voiceToggle').checked=state.settings.voice;$('motionToggle').checked=state.settings.reduceMotion;$('cloudConsent').checked=cloudUploadAllowed();$('cloudStatus').textContent=tr('cloudPrivacy');document.querySelectorAll('[data-mode]').forEach(node=>node.classList.toggle('selected',node.dataset.mode===state.settings.mode));
}
function renderHistory(target,events){$(target).replaceChildren();if(!events.length){$(target).append(el('div','empty-state',tr('emptyHistory')));return;}for(const event of events){const node=el('article','history-item');const icon=el('span','history-icon',event.kind==='upcycle'?'✂':ROUTES[event.components[0]?.route]?.icon||'♻');const body=el('div');const names=event.components.map(x=>translatedName(x.name)).join(', ');body.append(el('h3','',event.kind==='upcycle'?local(UPCYCLE.find(x=>x.id===event.tutorialId)?.title)||tr('upcycle'):names),el('p','',`${new Date(event.timestamp).toLocaleString(locale(),{dateStyle:'medium',timeStyle:'short'})} · ${tr('selfReported')}`));node.append(icon,body,el('span','history-xp',`+${event.xp} XP`));$(target).append(node);}}
const knownNames={plastic:['Plastic','প্লাস্টিক','प्लास्टिक'],paper:['Paper','কাগজ','कागज़'],cardboard:['Cardboard','কার্ডবোর্ড','गत्ता'],glass:['Glass','কাচ','काँच'],metal:['Metal','ধাতু','धातु'],bag:['Bag','ব্যাগ','थैला'],yard:['Garden waste','বাগানের বর্জ্য','बगीचे का कचरा'],banana:['Banana','কলা','केला'],apple:['Apple','আপেল','सेब'],bottle:['Bottle','বোতল','बोतल'],'cell phone':['Phone','ফোন','फ़ोन'],laptop:['Laptop','ল্যাপটপ','लैपटॉप'],unknown:['Unidentified item','অজানা বস্তু','अज्ञात वस्तु']};
function translatedName(name){return knownNames[name?.toLowerCase()]?.[['en','bn','hi'].indexOf(language())]||name||tr('unknown');}
function tentativeItem(item){return item.route!=='nonwaste'&&item.confirmedByUser!==true&&Number.isFinite(item.confidence)&&(item.confidence<0.55||(item.route==='unknown'&&!item.requiresMaterialConfirmation));}
function displayItemName(item){const name=translatedName(item.name);return tentativeItem(item)?tr('possibleItem',{name}):name;}
function updateStatus(message){
 $('networkDot').classList.toggle('disconnected',!navigator.onLine);
 $('networkDot').title=tr(navigator.onLine?'connected':'disconnected');
 const endpoint=resolveOnlineEndpoint(state.settings.endpoint);
 const firebase=endpoint===FIREBASE_ONLINE_ENDPOINT;
 const cloudReady=Boolean(endpoint)&&state.settings.mode==='online'&&cloudUploadAllowed()&&navigator.onLine;
 $('engineLabel').textContent=tr(analysis?.source==='online'?'modelCloud':analysis||!cloudReady?'modelLocal':'modelCloud');
 renderCloudSettings();
 if(!busy){const scanner=getOfflineStatus();const status=scanner.loading||scanner.warming?'loadingOffline':modelReady||scanner.ready?'readyToScan':'scannerIdle';$('statusTitle').textContent=message||tr(status);$('statusText').textContent=tr(state.settings.mode==='online'?(firebase?'firebaseCloudHint':endpoint?'onlineHint':'cloudNotConnected'):'offlineHint');}
}
async function ensureModel(){
 if(!offlinePromise)offlinePromise=initOffline({onProgress:showScanProgress}).then(result=>{modelReady=result.ready;updateStatus();return result;}).catch(error=>{offlinePromise=null;updateStatus(tr('modelError'));throw error;});
 return offlinePromise;
}
function abortScan(){
 requestId++;request?.abort();request=null;busy=false;pendingOnline=false;pendingLocal=false;acceptLocalAction=null;
 cloudFallbackKey='';renderCloudFallback();
 clearInterval(scanTicker);scanTicker=null;$('busyOverlay').hidden=true;$('useLocalNow').hidden=true;
 $('imageInput').disabled=false;$('uploadBtn').disabled=false;$('captureBtn').disabled=!stream&&!rawCanvas;
}
function stopCamera(){cameraRequestId++;if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;$('cameraFeed').srcObject=null;$('cameraFeed').hidden=true;$('cameraFeed').classList.remove('front-camera');$('reticle').hidden=true;$('cameraSwitch').disabled=true;}
async function openCamera({switching=false}={}){
 abortScan();stopCamera();const token=cameraRequestId;
 if(!navigator.mediaDevices?.getUserMedia){toast(tr('cameraSecureUpload'));$('cameraEmpty').hidden=false;return;}
 try{
  const deviceId=switching&&cameraDevices[selectedCamera]?.deviceId;
  let nextStream;
  try{nextStream=await navigator.mediaDevices.getUserMedia(cameraConstraints({deviceId,facingMode:currentFacing}));}
  catch(error){if(!['OverconstrainedError','NotFoundError'].includes(error.name))throw error;nextStream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});}
  if(token!==cameraRequestId){nextStream.getTracks().forEach(track=>track.stop());return;}
  stream=nextStream;$('cameraFeed').srcObject=stream;await $('cameraFeed').play();
  if(token!==cameraRequestId)return;
  $('cameraFeed').hidden=false;$('photoCanvas').hidden=true;$('cameraEmpty').hidden=true;$('reticle').hidden=false;
  $('captureBtn').disabled=false;rawCanvas=null;analysis=null;quest=null;photoWasCamera=true;$('resultCard').hidden=true;$('questCard').hidden=true;
  const settings=stream.getVideoTracks?.()[0]?.getSettings?.()||{};
  $('cameraFeed').classList.toggle('front-camera',settings.facingMode==='user');
  try{cameraDevices=(await navigator.mediaDevices.enumerateDevices()).filter(x=>x.kind==='videoinput');selectedCamera=Math.max(0,cameraDevices.findIndex(x=>x.deviceId===settings.deviceId));}catch{cameraDevices=[];}
  $('cameraSwitch').disabled=cameraDevices.length<2;fitReticle();ensureModel().catch(()=>{});
 }catch{toast(tr('cameraDenied'));$('cameraEmpty').hidden=false;}
}
function refreshScene(){
 const group=state.settings.scanScene==='group';
 document.querySelectorAll('[data-scene]').forEach(node=>{const selected=node.dataset.scene===(group?'group':'single');node.classList.toggle('selected',selected);node.setAttribute('aria-pressed',String(selected));});
 $('sceneHint').textContent=tr(group?'groupScanTip':'scanTip');$('cameraHint').textContent=tr(group?'groupScanLabel':'scanTip');fitReticle();
}
function fitReticle(){
 const video=$('cameraFeed'),stage=$('cameraStage');if(!video.videoWidth)return;
 const scale=Math.min(stage.clientWidth/video.videoWidth,stage.clientHeight/video.videoHeight);
 const group=state.settings.scanScene==='group',side=Math.min(video.videoWidth,video.videoHeight)*.78;
 const width=(group?video.videoWidth*.96:side)*scale,height=(group?video.videoHeight*.96:side)*scale;
 $('reticle').style.width=`${width}px`;$('reticle').style.height=`${height}px`;$('reticle').style.left=`${(stage.clientWidth-width)/2}px`;$('reticle').style.top=`${(stage.clientHeight-height)/2}px`;
}
function snapshot(){
 const video=$('cameraFeed');const crop=captureGeometry(video.videoWidth,video.videoHeight,{scene:state.settings.scanScene});
 const canvas=document.createElement('canvas');canvas.width=crop.width;canvas.height=crop.height;
 canvas.getContext('2d').drawImage(video,crop.x,crop.y,crop.w,crop.h,0,0,crop.width,crop.height);return canvas;
}
function displayPhoto(){const canvas=$('photoCanvas');canvas.width=rawCanvas.width;canvas.height=rawCanvas.height;canvas.getContext('2d').drawImage(rawCanvas,0,0);canvas.hidden=false;$('cameraFeed').hidden=true;$('reticle').hidden=true;$('cameraEmpty').hidden=true;}
async function scan(canvas){
 if(busy)return;if(!activeProfile(state)){openProfiles();return;}if(!canvas){toast(tr('noImage'));return;}
 rawCanvas=canvas;analysis=null;quest=null;pendingOnline=false;pendingLocal=false;cloudFallbackKey='';renderCloudFallback();displayPhoto();const myId=++requestId;
 request=new AbortController();const signal=request.signal;busy=true;
 $('captureBtn').disabled=true;$('imageInput').disabled=true;$('uploadBtn').disabled=true;$('resultCard').hidden=true;$('questCard').hidden=true;
 $('busyOverlay').hidden=false;$('useLocalNow').hidden=true;$('scanProgress').value=5;
 const started=performance.now();scanTicker=setInterval(()=>$('scanElapsed').textContent=tr('scanTime',{seconds:((performance.now()-started)/1000).toFixed(1)}),200);
 const acceptLocal=new Promise(resolve=>acceptLocalAction=resolve);
 try{
  await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
  if(signal.aborted)return;
  
  if(state.settings.mode==='online'){
   if(!resolveOnlineEndpoint(state.settings.endpoint)){cloudFallbackKey='cloudNotConnected';toast(tr(cloudFallbackKey));}
   else if(!cloudUploadAllowed()){cloudFallbackKey='cloudFallbackConsent';toast(tr(cloudFallbackKey));}
   else if(!navigator.onLine)cloudFallbackKey='cloudFallbackOffline';
  }
  await runScan(canvas,{
   mode:state.settings.mode,consent:cloudUploadAllowed(),online:navigator.onLine,endpoint:state.settings.endpoint,language:language(),scene:state.settings.scanScene||'single',signal,acceptLocal,
   onProgress:value=>{if(myId===requestId)showScanProgress(value);},
   onStatus:value=>{if(myId!==requestId)return;
    $('analysisTitle').textContent=tr(value.stage==='offlineFallback'?'offlineFallback':value.stage);
    if(value.stage==='offlineFallback'){cloudFallbackKey=cloudFallbackReason(value.error?.code);renderCloudFallback();toast(tr(cloudFallbackKey));}
    if(value.stage==='localResultReady')$('scanProgress').removeAttribute('value');
   },
   onResult:(value,meta)=>{if(signal.aborted||myId!==requestId)return;
    analysis=normalizeAnalysis(value);pendingOnline=Boolean(meta.pendingOnline);pendingLocal=Boolean(meta.pendingLocal);
    if(analysis.source==='online')cloudFallbackKey='';
    if(!analysis.components.length)analysis.components=[{name:'unknown',material:'unknown',route:'unknown'}];
    renderAnalysis();drawBoxes();$('useLocalNow').hidden=!pendingOnline||pendingLocal;
    if(pendingOnline||pendingLocal){$('analysisTitle').textContent=tr(pendingLocal?'verifyingResult':'refiningOnline');$('analysisDetail').textContent=tr('initialResult');$('scanProgress').removeAttribute('value');}
   }
  });
  if(signal.aborted||myId!==requestId)return;
  if(analysis&&state.settings.voice)speak();
 }catch(error){if(signal.aborted||myId!==requestId)return;analysis=normalizeAnalysis({source:'manual',components:[{name:'unknown',route:'unknown'}]});pendingOnline=false;pendingLocal=false;renderAnalysis();toast(tr('modelError'));}
 finally{if(myId===requestId){busy=false;pendingOnline=false;pendingLocal=false;clearInterval(scanTicker);scanTicker=null;acceptLocalAction=null;$('busyOverlay').hidden=true;$('useLocalNow').hidden=true;$('captureBtn').disabled=false;$('imageInput').disabled=false;$('uploadBtn').disabled=false;if(analysis)renderAnalysis();updateStatus();}}
}
const materialOptions=[['metal','materialMetal','recycle'],['glass','materialGlass','recycle'],['plastic','materialRigidPlastic','recycle'],['soft plastic','materialSoftPlastic','unknown'],['paper','materialPaper','recycle'],['lined paper','materialLinedPaper','unknown'],['cardboard','materialCardboard','recycle'],['organic','materialOrganic','organic'],['other','materialOther','unknown']];
function materialTitle(material){return materialOptions.find(item=>item[0]===material)?.[1]?tr(materialOptions.find(item=>item[0]===material)[1]):material==='unknown'?tr('unknown'):translatedName(material);}
function drawBoxes(){
 if(!rawCanvas||!analysis)return;displayPhoto();const ctx=$('photoCanvas').getContext('2d');const size=Math.max(14,rawCanvas.width/38);ctx.lineWidth=Math.max(2,rawCanvas.width/220);ctx.font=`600 ${size}px system-ui`;
 analysis.components.forEach((comp,index)=>{if(!comp.bbox||(comp.route==='nonwaste'&&!comp.reusable))return;const color=ROUTES[comp.route]?.color||'#bcf173';ctx.strokeStyle=color;const{x,y,w,h}=comp.bbox;ctx.strokeRect(x,y,w,h);const label=`#${index+1}`;const labelWidth=ctx.measureText(label).width+12;const labelY=Math.max(0,Math.min(rawCanvas.height-size-10,y));ctx.fillStyle=color;ctx.fillRect(Math.min(x,rawCanvas.width-labelWidth),labelY,labelWidth,size+10);ctx.fillStyle='#10251a';ctx.fillText(label,Math.min(x,rawCanvas.width-labelWidth)+6,labelY+size+2);});
}
function recordCorrection(comp,originalRoute,originalMaterial){
 state.corrections.push({id:uuid(),profileId:state.activeProfileId,name:comp.name,originalRoute,route:comp.route,material:comp.material,...(originalMaterial?{originalMaterial}:{}),requiresMaterialConfirmation:comp.requiresMaterialConfirmation===true,confirmedByUser:comp.confirmedByUser===true,materialConfirmedByUser:comp.materialConfirmedByUser===true,reusable:comp.reusable===true,discardedByUser:comp.discardedByUser===true,timestamp:new Date().toISOString(),source:analysis.source});state.corrections=state.corrections.slice(-2000);save();
}
function renderMixedSummary(){
 const waste=analysis.components.filter(item=>item.route!=='nonwaste'||item.reusable);
 const show=state.settings.scanScene==='group'||analysis.multiItem||analysis.mixed;
 $('mixedPanel').hidden=!show;if(!show)return;
 const isMixed=analysis.mixed||analysis.mixedMaterials;
 $('mixedTitle').textContent=tr(isMixed?'mixedWaste':waste.length>1?'multipleItems':'groupScanLabel');
 $('mixedSummary').textContent=waste.length?tr(waste.some(tentativeItem)?'possibleItems':'identifiedItems',{count:waste.length}):tr('noGroupItems');
 $('mixedItems').replaceChildren();waste.forEach(item=>{const index=analysis.components.indexOf(item);const chip=el('span','item-chip',`#${index+1} ${displayItemName(item)}`);$('mixedItems').append(chip);});
 $('mixedGuidance').textContent=tr(waste.some(item=>item.requiresMaterialConfirmation&&!item.materialConfirmedByUser&&item.discardedByUser!==false)?'confirmMaterialsFirst':analysis.mixed?'mixedSeparation':analysis.mixedMaterials?'mixedSameBin':'checkAllItems');
}
function renderAnalysis(){
 analysis=normalizeAnalysis(analysis);$('resultCard').hidden=false;$('resultSource').textContent=tr(analysis.source==='online'?'online':analysis.source==='manual'?'manual':'offline');
 renderCloudFallback();
 const waste=analysis.components.filter(item=>item.route!=='nonwaste'),waiting=pendingOnline||pendingLocal;
 $('resultTitle').textContent=!waste.length&&analysis.components.some(item=>item.discardedByUser===false)?tr('keepReusable'):waste.some(tentativeItem)?tr('unknownResult'):analysis.mixed||analysis.mixedMaterials?tr('mixedWaste'):analysis.components.some(item=>item.requiresMaterialConfirmation&&!item.materialConfirmedByUser&&item.discardedByUser!==false)?tr('materialCheckTitle'):analysis.uncertain?tr('unknownResult'):waste.length?waste.map(item=>translatedName(item.name)).join(' + '):tr('keepReusable');
 $('resultNote').textContent=pendingLocal?tr('verifyingResult'):pendingOnline?tr('refiningOnline'):!waste.length&&analysis.components.some(item=>item.discardedByUser===false)?tr('reuseSaved'):tr(analysis.components.some(item=>item.requiresMaterialConfirmation&&!item.materialConfirmedByUser&&item.discardedByUser!==false)?'materialCheckNote':analysis.mixed?'separate':analysis.uncertain?'boundaryNote':'allSameStream');
 renderMixedSummary();$('componentsList').replaceChildren();
 analysis.components.forEach((comp,index)=>{
  const node=el('article','component');const row=el('div','component-top'),icon=el('span','bin-icon',ROUTES[comp.route].icon);icon.style.background=`${ROUTES[comp.route].color}18`;
  const title=el('div');title.append(el('h3','',`#${index+1} ${displayItemName(comp)}`),el('small','',local(ROUTES[comp.route].title)));row.append(icon,title);node.append(row);
  if(comp.route==='nonwaste'&&comp.reusable)node.append(el('p','reuse-note',tr(comp.discardedByUser===false?'reuseSaved':'reusePossible')));else node.append(el('p','',local(ROUTES[comp.route].description)));
  if(comp.advice&&analysis.source==='online')node.append(el('p','',comp.advice));
  if(comp.confidence!==undefined&&analysis.source!=='manual'&&!comp.confirmedByUser)node.append(el('p','small muted',`${tr('confidence')}: ${Math.round(comp.confidence*100)}% · ${tr('confidenceNote')}`));
  const hasMaterialControls=comp.requiresMaterialConfirmation===true;const needsMaterial=hasMaterialControls&&comp.materialConfirmedByUser!==true;const kept=comp.reusable===true&&comp.discardedByUser===false;
  if(hasMaterialControls){
   if(needsMaterial&&!kept){node.classList.add('needs-material');node.append(el('p','material-alert',tr('materialCheckNote')));}
   const nameField=el('label','field');nameField.append(el('span','',tr('itemName')));const nameInput=el('input','item-name');nameInput.type='text';nameInput.maxLength=120;nameInput.value=comp.name;nameInput.disabled=waiting;nameInput.addEventListener('change',()=>{comp.name=nameInput.value.trim().slice(0,120)||comp.name;renderAnalysis();});nameField.append(nameInput);node.append(nameField);
   const field=el('label','field');field.append(el('span','',tr('chooseMaterial')));const materials=el('select','material-select');materials.setAttribute('aria-label',`${tr('chooseMaterial')} · #${index+1}`);const empty=el('option','',tr('chooseMaterial'));empty.value='';materials.append(empty);
   materialOptions.forEach(([value,key])=>{const option=el('option','',tr(key));option.value=value;materials.append(option);});materials.value=materialOptions.some(item=>item[0]===comp.material)?comp.material:'';materials.disabled=waiting;
   materials.addEventListener('change',()=>{const option=materialOptions.find(item=>item[0]===materials.value);if(!option)return;const original=comp.route,originalMaterial=comp.material;comp.material=option[0];comp.route=option[2];comp.materialConfirmedByUser=false;comp.confirmedByUser=false;comp.discardedByUser=true;recordCorrection(comp,original,originalMaterial);renderAnalysis();drawBoxes();});field.append(materials);node.append(field);
  }else if(comp.material&&comp.material!=='unknown')node.append(el('p','material-label',`${tr(tentativeItem(comp)?'possibleMaterial':'material')}: ${materialTitle(comp.material)}`));
  if(comp.route!=='nonwaste'||hasMaterialControls){
   const field=el('label','field');field.append(el('span','',tr('correctResult')));const select=el('select','route-select');select.setAttribute('aria-label',`${tr('correctResult')} · #${index+1}`);
   Object.entries(ROUTES).forEach(([key,route])=>{const option=el('option','',`${route.icon} ${local(route.title)}`);option.value=key;select.append(option);});select.value=comp.route;select.disabled=waiting;
   select.addEventListener('change',()=>{const original=comp.route;comp.route=select.value;comp.confirmedByUser=!needsMaterial;comp.discardedByUser=true;if(!needsMaterial)comp.confidence=1;recordCorrection(comp,original);renderAnalysis();drawBoxes();toast(tr('correctionSaved'));});field.append(select);node.append(field);
   if(hasMaterialControls){
    const confirm=el('button','button primary material-confirm',tr(needsMaterial?'confirmMaterialBin':'materialConfirmed'));confirm.disabled=waiting||!needsMaterial||!materialsChosen(comp)||['unknown','nonwaste'].includes(comp.route);
    confirm.addEventListener('click',()=>{const original=comp.route;comp.materialConfirmedByUser=true;comp.confirmedByUser=true;comp.discardedByUser=true;comp.confidence=1;recordCorrection(comp,original);renderAnalysis();drawBoxes();toast(tr('correctionSaved'));});node.append(el('p','small muted',tr('campusAcceptance')),confirm);
    const reuse=el('button','text-button keep-reuse',tr('keepReusable'));reuse.disabled=waiting;reuse.addEventListener('click',()=>{comp.reusable=true;comp.discardedByUser=false;const original=comp.route;comp.route='nonwaste';recordCorrection(comp,original);renderAnalysis();drawBoxes();toast(tr('reuseSaved'));});node.append(reuse);
   }else if(comp.route!=='unknown'&&comp.route!=='nonwaste'&&!comp.confirmedByUser){
    const confirm=el('button','text-button',tr('confirmCategory'));confirm.disabled=waiting;confirm.addEventListener('click',()=>{comp.confirmedByUser=true;comp.confidence=1;renderAnalysis();toast(tr('correctionSaved'));});node.append(confirm);
   }
  }
  $('componentsList').append(node);
 });
 $('addMissingItem').disabled=waiting||analysis.components.length>=30;
 $('questStart').disabled=waiting||analysis.uncertain||!waste.length||waste.some(item=>item.route==='unknown');
}
function materialsChosen(comp){return Boolean(comp.material&&comp.material!=='unknown'&&materialOptions.some(item=>item[0]===comp.material));}
function reportDirectory(){return institutionReportDirectory(state,INSTITUTIONS);}
function reportKey(value){return value.reportKey||JSON.stringify([value.institutionId,(value.customInstitution||'').normalize('NFKC').trim().toLowerCase()]);}
function selectedReportEntries(){const campuses=reportDirectory();return reportSelection==='*'?campuses:campuses.filter(campus=>reportKey(campus)===reportSelection);}
function selectedContributions(){return selectedReportEntries().flatMap(campus=>campus.contributions);}
function contributionInstitution(row,campuses=reportDirectory()){return campuses.find(campus=>campus.contributions.some(student=>student.profileId===row.profileId))?.name||institutionName(row);}
function openInstitutionReport(key){reportSelection=key;renderCampusReport();showTab('reports');$('reportDetail').scrollIntoView({behavior:prefersReducedMotion()?'instant':'smooth',block:'start'});$('reportDetail').focus({preventScroll:true});}
function renderCampusReport(){
 const campuses=reportDirectory(),keys=new Set(campuses.map(reportKey));if(reportSelection!=='*'&&!keys.has(reportSelection))reportSelection='*';
 const chooser=$('reportInstitutionSelect');chooser.replaceChildren();const all=el('option','',tr('allReportInstitutions'));all.value='*';chooser.append(all);
 for(const type of ['university','college','school','custom']){
  const list=campuses.filter(campus=>['university','college','school'].includes(campus.type)?campus.type===type:type==='custom');if(!list.length)continue;
  const group=el('optgroup');group.label=tr(type==='custom'?'otherInstitutions':type);list.forEach(campus=>{const option=el('option','',campus.name);option.value=reportKey(campus);group.append(option);});chooser.append(group);
 }
 chooser.value=reportSelection;chooser.disabled=false;
 const entries=selectedReportEntries(),rows=entries.flatMap(campus=>campus.contributions),total=key=>entries.reduce((sum,campus)=>sum+(Number(campus[key])||0),0),kg=value=>`${value.toFixed(3)} kg`;
 $('campusName').textContent=reportSelection==='*'?tr('allReportInstitutions'):entries[0]?.name||tr('chooseReportInstitution');
 $('campusMetrics').replaceChildren(metric(tr('divertedMass'),kg(total('estimatedKg'))),metric(tr('estimatedCo2'),kg(total('estimatedCo2Kg'))),metric(tr('contributors'),String(rows.filter(row=>row.quests>0).length)));
 $('reportSecondaryMetrics').replaceChildren(metric(tr('itemsHandled'),String(total('items'))),metric(tr('quests'),String(total('quests'))),metric(tr('activityXP'),String(total('eventXP'))));
 $('weightBasis').textContent=tr('weightBasis',{reported:kg(total('reportedDivertedKg')),assumed:kg(total('assumedDivertedKg'))});
 const hasRecords=entries.some(campus=>campus.hasRecords);$('reportRecordStatus').textContent=tr(hasRecords?'reportRecordsAvailable':'noInstitutionActivity');$('reportRecordStatus').classList.toggle('no-records',!hasRecords);
 $('reportCount').textContent=tr('reportInstitutionCount',{count:campuses.length});
 const query=$('reportSearch').value.normalize('NFKC').trim().toLowerCase(),type=$('reportTypeSelect').value||'all';
 const visible=campuses.filter(campus=>(type==='all'||campus.type===type)&&`${campus.name} ${campus.area}`.normalize('NFKC').toLowerCase().includes(query));
 $('campusOverview').replaceChildren();visible.forEach(campus=>{
  const card=el('button','campus-overview-card');card.type='button';card.setAttribute('aria-label',`${tr('openNAACReport')} · ${campus.name}`);card.classList.toggle('selected',reportKey(campus)===reportSelection);
  card.append(el('span','institution-type',tr(['university','college','school'].includes(campus.type)?campus.type:'otherInstitutions')),el('h3','',campus.name),el('small','institution-area',campus.area||tr('savedCustomInstitution')));
  const amount=el('strong','',campus.hasRecords?kg(campus.estimatedKg):'—');card.append(amount,el('small','',tr('divertedMass')),el('span',`record-status${campus.hasRecords?' has-records':''}`,tr(campus.hasRecords?'reportRecordsAvailable':'noRecordedActivity')),el('span','open-report-label',`${tr('openNAACReport')} ↗`));
  card.addEventListener('click',()=>openInstitutionReport(reportKey(campus)));$('campusOverview').append(card);
 });$('reportDirectoryEmpty').hidden=visible.length>0;
 const body=$('contributionsBody');body.replaceChildren();rows.forEach(row=>{const line=el('tr');const student=el('td');student.append(el('strong','',row.name),el('small','',tr('contributionQuests',{count:row.quests})));line.append(student,el('td','institution-cell',contributionInstitution(row,campuses)),el('td','numeric',String(row.items)),el('td','numeric',kg(row.estimatedKg)),el('td','numeric',kg(row.estimatedCo2Kg)),el('td','numeric',`${row.eventXP} XP`));body.append(line);});
 if(!rows.length){const line=el('tr');const cell=el('td','report-empty',tr('noContributions'));cell.colSpan=6;line.append(cell);body.append(line);}
 $('exportCampusReport').disabled=!rows.length;$('exportSelectedReport').disabled=!entries.length;
}
function effectivePublicEndpoint(){return state.settings.publicReportEndpoint||DEFAULT_PUBLIC_NAAC_URL;}
function publicReportAddress(endpoint){
 if(!endpoint)return new URL('./naac/',location.href).href;
 const base=new URL(validatePublicEndpoint(endpoint));
 return new URL(['localhost','127.0.0.1','[::1]'].includes(base.hostname)?'/naac/':'/',base).href;
}
function renderPublicSharing(){
 const endpoint=effectivePublicEndpoint();$('publicReportEndpoint').value=endpoint;$('shareInstitutionTotals').checked=state.settings.shareInstitutionTotals===true;
 const href=publicReportAddress(endpoint);for(const id of ['openPublicReport','publicReportLink']){$(id).href=href;$(id).textContent=tr(endpoint?'openSharedNAAC':'previewPublicNAAC');}
 $('publicSharingStatus').textContent=publicStatusText||tr(!endpoint?'publicNotConnected':state.settings.shareInstitutionTotals?'publicSharingEnabled':'publicSharingOff');
 $('publicSyncNow').disabled=publicBusy||!endpoint||!state.settings.shareInstitutionTotals;
 $('savePublicSharing').disabled=publicBusy;
}
function schedulePublicSync(){
 clearTimeout(publicSyncTimer);if(publicBusy||!state.settings.shareInstitutionTotals||!effectivePublicEndpoint())return;
 publicSyncTimer=setTimeout(()=>syncInstitutionTotals(),1200);
}
async function syncInstitutionTotals(){
 if(publicBusy||!state.settings.shareInstitutionTotals||!effectivePublicEndpoint())return;
 if(!navigator.onLine){publicStatusText=tr('publicOfflineQueued');renderPublicSharing();return;}
 publicBusy=true;publicStatusText=tr('publicSyncing');renderPublicSharing();
 try{await publicSync.sync(state,{endpoint:effectivePublicEndpoint(),enabled:true});publicStatusText=tr('publicSyncSuccess');}
 catch(error){publicStatusText=tr(error.code==='SHARING_DISABLED'?'publicNotConnected':'publicSyncFailed');}
 finally{publicBusy=false;renderPublicSharing();}
}
async function savePublicSharing(){
 if(publicBusy)return;let endpoint=$('publicReportEndpoint').value.trim();const enabled=$('shareInstitutionTotals').checked;
 try{if(endpoint)endpoint=validatePublicEndpoint(endpoint);if(enabled&&!endpoint)throw new Error();}catch{toast(tr('publicInvalidEndpoint'));return;}
 const previous=effectivePublicEndpoint(),wasEnabled=state.settings.shareInstitutionTotals===true;
 publicBusy=true;clearTimeout(publicSyncTimer);state.settings.publicReportEndpoint=endpoint;state.settings.shareInstitutionTotals=enabled;save();publicStatusText=tr('publicSyncing');renderPublicSharing();
 let revokeFailed=false;
 try{
  const removals=new Set(publicSync.pendingRemovals());
  if(previous&&(!enabled||(wasEnabled&&previous!==endpoint)))removals.add(previous);
  for(const removal of removals){try{await publicSync.revoke({endpoint:removal});}catch{revokeFailed=true;}}
  if(enabled){await publicSync.sync(state,{endpoint,enabled:true});publicStatusText=tr(revokeFailed?'publicOldRemovalFailed':'publicSyncSuccess');}
  else publicStatusText=tr(revokeFailed?'publicRemovalFailed':'publicSharingOff');
 }catch(error){publicStatusText=tr(error.code==='SHARING_DISABLED'?'publicNotConnected':'publicSyncFailed');}
 finally{publicBusy=false;renderPublicSharing();}
}
function speak(){if(!state.settings.voice||!analysis)return;if(!('speechSynthesis'in window)){toast(tr('voiceUnavailable'));return;}const code={en:'en',bn:'bn',hi:'hi'}[language()];const voices=speechSynthesis.getVoices();const voice=voices.find(v=>v.lang.toLowerCase().startsWith(code));if(!voice){toast(tr('voiceUnavailable'));return;}speechSynthesis.cancel();const text=analysis.components.filter(x=>x.route!=='nonwaste').map(x=>`${translatedName(x.name)}. ${local(ROUTES[x.route].description)}`).join(' ');const utterance=new SpeechSynthesisUtterance(text||tr('unknownResult'));utterance.voice=voice;utterance.lang=voice.lang;utterance.rate=.92;speechSynthesis.speak(utterance);}
async function imageHash(canvas){if(!canvas)return '';const encoded=new TextEncoder().encode(canvas.toDataURL('image/jpeg',.75));const hash=await crypto.subtle.digest('SHA-256',encoded);return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');}
async function startQuest(tutorial){const startedProfile=state.activeProfileId,startedRequest=requestId;const capturedCanvas=rawCanvas;if(!activeProfile(state)){openProfiles();return;}if(!tutorial&&(busy||pendingLocal||pendingOnline||!analysis||analysis.uncertain))return;const components=tutorial?[{name:local(tutorial.title),route:'recycle',material:tutorial.materials[0],confirmedByUser:true}]:analysis.components.filter(x=>x.route!=='nonwaste').map(x=>({...x}));const hash=tutorial?'':await imageHash(capturedCanvas);if(state.activeProfileId!==startedProfile||requestId!==startedRequest)return;quest={id:uuid(),profileId:startedProfile,components,source:tutorial?'manual':analysis.source,kind:tutorial?'upcycle':'sort',tutorialId:tutorial?.id,imageHash:hash,checks:[]};$('resultCard').hidden=true;$('questCard').hidden=false;$('disposalConfirm').checked=false;$('weightInput').value='';renderQuest();$('questCard').scrollIntoView({behavior:prefersReducedMotion()?'instant':'smooth',block:'center'});}
function renderQuest(preserve=false){if(!quest)return;const tutorial=UPCYCLE.find(x=>x.id===quest.tutorialId);$('questHeading').textContent=tutorial?local(tutorial.title):tr('questTitle');const steps=tutorial?tutorial.steps.map(local):[...(new Set(quest.components.map(item=>item.route)).size>1?[tr('separate')]:[]),...quest.components.flatMap(comp=>ROUTES[comp.route].steps.map(step=>`${translatedName(comp.name)} — ${local(step)}`))];$('questSteps').replaceChildren();steps.forEach((step,index)=>{const label=el('label','quest-step');const input=el('input');input.type='checkbox';input.checked=Boolean(quest.checks[index]);input.addEventListener('change',()=>{quest.checks[index]=input.checked;checkQuest();});label.append(input,el('span','',step));$('questSteps').append(label);});checkQuest();}
function checkQuest(){const boxes=[...$('questSteps').querySelectorAll('input')];const done=boxes.filter(x=>x.checked).length;$('questFill').style.width=`${boxes.length?done/boxes.length*100:0}%`;$('claimBtn').disabled=!quest||!boxes.length||done!==boxes.length||!$('disposalConfirm').checked;}
function celebrate(xp){toast(`✦ +${xp} XP · ${tr('done')}`);if(state.settings.reduceMotion||matchMedia('(prefers-reduced-motion: reduce)').matches)return;$('celebration').replaceChildren();for(let i=0;i<26;i++){const piece=el('i','confetti');piece.style.setProperty('--x',`${(Math.random()-.5)*700}px`);piece.style.setProperty('--y',`${(Math.random()-.55)*600}px`);piece.style.setProperty('--r',`${Math.random()*600}deg`);piece.style.background=['#bcf173','#d7b77e','#89b9a0','#174d3a'][i%4];$('celebration').append(piece);}setTimeout(()=>$('celebration').replaceChildren(),1600);}
function renderTutorial(tutorial){$('tutorialIcon').textContent=tutorial.icon;$('tutorialTitle').textContent=local(tutorial.title);$('tutorialSteps').replaceChildren(...tutorial.steps.map(step=>el('li','',local(step))));$('tutorialNote').textContent=local(tutorial.note);}
function openTutorial(tutorial){currentTutorial=tutorial;renderTutorial(tutorial);$('tutorialDialog').showModal();}
function download(content,name,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type}));const link=el('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function prepareOffline(){$('offlineStatus').textContent=tr('offlinePreparing');try{if(!('serviceWorker' in navigator))throw new Error();await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error()),30000))]);const registration=await navigator.serviceWorker.getRegistration();const worker=registration?.active;if(!worker)throw new Error();$('offlineStatus').textContent=tr('offlinePreparing');const channel=new MessageChannel();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error()),90000);channel.port1.onmessage=event=>{clearTimeout(timer);event.data.ok&&event.data.shellReady?resolve():reject(new Error());};worker.postMessage({type:'CACHE_OFFLINE'},[channel.port2]);});$('offlineStatus').textContent=tr('offlineReady');toast(tr('offlineReady'));}catch{$('offlineStatus').textContent=tr('offlineMissing');toast(tr('offlineMissing'));}}
document.querySelectorAll('[data-tab]').forEach(node=>node.addEventListener('click',()=>showTab(node.dataset.tab)));document.querySelectorAll('[data-go]').forEach(node=>node.addEventListener('click',()=>showTab(node.dataset.go)));document.querySelectorAll('[data-mode]').forEach(node=>node.addEventListener('click',()=>{if(busy){abortScan();analysis=null;quest=null;$('resultCard').hidden=true;$('questCard').hidden=true;}state.settings.mode=node.dataset.mode;save();renderAll();updateStatus();if(state.settings.mode==='online'){if(!resolveOnlineEndpoint(state.settings.endpoint))toast(tr('cloudNotConnected'));else if(!cloudUploadAllowed()){showTab('settings');$('cloudConsent').focus();toast(tr('uploadConsent'));}}}));
document.querySelectorAll('[data-scene]').forEach(node=>node.addEventListener('click',()=>{abortScan();analysis=null;quest=null;$('resultCard').hidden=true;$('questCard').hidden=true;state.settings.scanScene=node.dataset.scene==='group'?'group':'single';save();refreshScene();}));
$('addMissingItem').addEventListener('click',()=>{if(!analysis||busy||analysis.components.length>=30)return;analysis.components.push({name:tr('addedItem'),material:'unknown',route:'unknown',requiresMaterialConfirmation:true});renderAnalysis();$('componentsList').lastElementChild?.scrollIntoView({behavior:prefersReducedMotion()?'instant':'smooth',block:'nearest'});});
$('reportInstitutionSelect').addEventListener('change',()=>{reportSelection=$('reportInstitutionSelect').value;renderCampusReport();});
$('savePublicSharing').addEventListener('click',savePublicSharing);$('publicSyncNow').addEventListener('click',syncInstitutionTotals);
$('browseReports').addEventListener('click',()=>{$('profileDialog').close();showTab('reports');});
$('reportSearch').addEventListener('input',renderCampusReport);$('reportTypeSelect').addEventListener('change',renderCampusReport);
$('exportAllReports').addEventListener('click',()=>download(institutionSummaryCSV(reportDirectory()),'EcoLens-all-institution-reports.csv','text/csv;charset=utf-8'));
$('exportSelectedReport').addEventListener('click',()=>download(institutionSummaryCSV(selectedReportEntries()),'EcoLens-NAAC-summary.csv','text/csv;charset=utf-8'));
$('exportCampusReport').addEventListener('click',()=>{const campuses=reportDirectory();download(contributionsCSV(selectedContributions(),{institutionName:row=>contributionInstitution(row,campuses)}),'EcoLens-campus-contributions.csv','text/csv;charset=utf-8');});
$('languageSelect').addEventListener('change',()=>{state.settings.language=$('languageSelect').value;save();refreshLanguage();});$('institutionSearch').addEventListener('input',renderInstitutions);$('institutionSelect').addEventListener('change',()=>$('customInstitutionField').hidden=$('institutionSelect').value!=='OTHER');$('profileForm').addEventListener('submit',event=>{event.preventDefault();if(!$('nameInput').value.trim())return;let institutionId=$('institutionSelect').value;const custom=$('customInstitutionInput').value.trim();if(institutionId==='OTHER'&&!custom){$('customInstitutionInput').focus();return;}const isCustom=institutionId==='OTHER';if(isCustom)institutionId='custom-'+custom.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').slice(0,90);clearSession();addProfile(state,{name:$('nameInput').value.trim(),institutionId,customInstitution:isCustom?custom:undefined});save();$('profileDialog').close();refreshLanguage();prepareScannerInBackground();});$('closeProfileDialog').addEventListener('click',()=>{$('profileDialog').close();prepareScannerInBackground();});$('profileDialog').addEventListener('cancel',event=>{if(!activeProfile(state))event.preventDefault();});['switchProfile','changeProfile'].forEach(id=>$(id).addEventListener('click',openProfiles));$('xpTop').addEventListener('click',()=>showTab('journey'));$('cameraStart').addEventListener('click',()=>openCamera());$('captureBtn').addEventListener('click',()=>{try{const fromCamera=Boolean(stream&&!$('cameraFeed').hidden);const photo=fromCamera?snapshot():rawCanvas;if(fromCamera){photoWasCamera=true;stopCamera();}scan(photo);}catch(error){toast(tr('noImage'));}});$('retakeBtn').addEventListener('click',()=>{abortScan();analysis=null;quest=null;rawCanvas=null;$('photoCanvas').hidden=true;$('resultCard').hidden=true;$('questCard').hidden=true;if(stream){$('cameraFeed').hidden=false;$('reticle').hidden=false;fitReticle();$('captureBtn').disabled=false;}else{$('cameraEmpty').hidden=false;$('captureBtn').disabled=true;if(photoWasCamera)openCamera();}});
$('imageInput').addEventListener('change',async event=>{
 const file=event.target.files[0];event.target.value='';if(!file)return;if(file.size>12*1024*1024){toast(tr('imageTooLarge'));return;}if(!file.type.startsWith('image/')){toast(tr('imageInvalid'));return;}
 try{const canvas=await decodePhoto(file);photoWasCamera=false;stopCamera();await scan(canvas);}catch{toast(tr('imageInvalid'));}
});
$('questStart').addEventListener('click',()=>startQuest());$('voiceBtn').addEventListener('click',speak);$('questCancel').addEventListener('click',()=>{quest=null;$('questCard').hidden=true;if(analysis)$('resultCard').hidden=false;});$('disposalConfirm').addEventListener('change',checkQuest);$('claimBtn').addEventListener('click',()=>{if(!quest||$('claimBtn').disabled)return;try{$('claimBtn').disabled=true;const old=personalStats(state).xp;const weight=$('weightInput').value;const completion=completeQuest(state,{...quest,profileId:quest.profileId,weightGrams:weight||undefined});save();if(completion.added){celebrate(completion.xpEarned);if(currentLevel({xp:old}).index<currentLevel(personalStats(state)).index)setTimeout(()=>toast(tr('levelUp')),1800);}else toast(tr('alreadyCompleted'));quest=null;analysis=null;$('questCard').hidden=true;$('resultCard').hidden=true;renderAll();}catch(error){toast(tr('categoryRequired'));checkQuest();}});
$('openTutorials').addEventListener('click',()=>{showTab('journey');$('tutorialGrid').scrollIntoView({behavior:prefersReducedMotion()?'instant':'smooth'});});$('closeTutorial').addEventListener('click',()=>{$('tutorialDialog').close();currentTutorial=null;});$('tutorialQuest').addEventListener('click',()=>{const tutorial=currentTutorial;$('tutorialDialog').close();showTab('scan');startQuest(tutorial);currentTutorial=null;});$('voiceToggle').addEventListener('change',()=>{state.settings.voice=$('voiceToggle').checked;save();});$('motionToggle').addEventListener('change',()=>{state.settings.reduceMotion=$('motionToggle').checked;save();document.body.classList.toggle('reduce-motion',state.settings.reduceMotion);});$('endpointInput').addEventListener('input',()=>{revokePhotoConsent();renderCloudSettings($('endpointInput').value.trim());});
$('cloudConsent').addEventListener('change',()=>{if(!$('cloudConsent').checked){revokePhotoConsent();updateStatus();}});
$('saveEndpoint').addEventListener('click',()=>{
 const input=$('endpointInput').value.trim();
 if(input){try{const url=new URL(input);if(url.username||url.password)throw new Error();if(url.protocol!=='https:'&&!(['localhost','127.0.0.1'].includes(url.hostname)&&url.protocol==='http:'))throw new Error();}catch{toast(tr('invalidImport'));return;}}
 const destination=resolveOnlineEndpoint(input);
 if(cloudConsentRecipient!==destination){revokePhotoConsent();renderCloudSettings(input);toast(tr('uploadConsent'));return;}
 const enabled=$('cloudConsent').checked;
 if(!enabled||destination!==resolveOnlineEndpoint(state.settings.endpoint)){if(busy){abortScan();analysis=null;quest=null;$('resultCard').hidden=true;$('questCard').hidden=true;}}
 resetOnlineCooldown();state.settings.endpoint=input;state.settings.cloudConsent=enabled;
 if(!enabled)rememberFirebasePhotoConsent(false);
 else if(destination===FIREBASE_ONLINE_ENDPOINT&&!rememberFirebasePhotoConsent(true))state.settings.cloudConsent=false;
 save();toast(tr('saved'));updateStatus();if(cloudUploadAllowed()&&state.settings.mode==='online')showTab('scan');
});
$('prepareOffline').addEventListener('click',prepareOffline);$('installBtn').addEventListener('click',prepareOffline);$('downloadData').addEventListener('click',()=>download(exportState(state),'EcoLens-backup.json'));$('importInput').addEventListener('change',async event=>{const file=event.target.files[0];event.target.value='';if(!file)return;if(file.size>8e6||!confirm(tr('confirmImport'))){if(file.size>8e6)toast(tr('invalidImport'));return;}try{const imported=importState(await file.text());abortScan();stopCamera();state=imported;state.settings.shareInstitutionTotals=false;state.settings.cloudConsent=false;rememberFirebasePhotoConsent(false);analysis=null;quest=null;$('resultCard').hidden=true;$('questCard').hidden=true;save();refreshLanguage();toast(tr('dataRestored'));if(!activeProfile(state))openProfiles();}catch{toast(tr('invalidImport'));}});
$('resetProfile').addEventListener('click',()=>{if(!activeProfile(state)||!confirm(tr('confirmReset')))return;const id=state.activeProfileId;activeProfile(state).legacyXP=0;clearSession();state.events=state.events.filter(x=>x.profileId!==id);state.corrections=state.corrections.filter(x=>x.profileId!==id);save();renderAll();toast(tr('done'));});$('exportReport').addEventListener('click',()=>{const profile=activeProfile(state);if(!profile)return;const events=personalStats(state).events;const safeCell=x=>/^[=+@\-\t\r]/.test(String(x??''))?'\u0027'+String(x):x;const quote=x=>`"${String(x??'').replaceAll('"','""')}"`;const header=['Timestamp','Student','Institution','Items','Routes','XP','Weight grams','Weight source','Confirmation','Engine'];const rows=events.map(x=>[x.timestamp,profile.name,institutionName(profile),x.components.map(y=>y.name).join('; '),x.components.map(y=>y.route).join('; '),x.xp,x.weightGrams,x.weightSource,'self-reported',x.source]);download('\ufeff'+[header,...rows].map(row=>row.map(safeCell).map(quote).join(',')).join('\r\n'),'EcoLens-activity-report.csv','text/csv;charset=utf-8');});
window.addEventListener('online',()=>{updateStatus();schedulePublicSync();});window.addEventListener('offline',()=>updateStatus());window.addEventListener('resize',fitReticle);document.addEventListener('visibilitychange',()=>{if(document.hidden&&stream){stopCamera();$('cameraEmpty').hidden=!$('photoCanvas').hidden;$('captureBtn').disabled=!rawCanvas;}});

function clearSession(){abortScan();stopCamera();rawCanvas=null;analysis=null;quest=null;$('resultCard').hidden=true;$('questCard').hidden=true;$('photoCanvas').hidden=true;$('cameraEmpty').hidden=false;$('captureBtn').disabled=true;}
$('existingProfiles').addEventListener('change',()=>{if(!$('existingProfiles').value)return;clearSession();state.activeProfileId=$('existingProfiles').value;save();$('profileDialog').close();refreshLanguage();prepareScannerInBackground();});
$('uploadBtn').addEventListener('click',()=>$('imageInput').click());
$('restoreBtn').addEventListener('click',()=>$('importInput').click());


function applyTheme(){
 const preference=state.settings.theme||'system';const dark=preference==='dark'||(preference==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
 document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.style.colorScheme=dark?'dark':'light';
 $('themeIcon').textContent=dark?'☀':'☾';$('themeToggle').setAttribute('aria-pressed',String(dark));$('themeToggle').setAttribute('aria-label',tr(dark?'lightTheme':'darkTheme'));$('themeToggle').title=tr('theme');$('themeSelect').value=preference;
 const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=dark?'#10251a':'#174d3a';
}
function showScanProgress(value){
 const phases={'loading-runtime':'loadingRuntime','loading-local-model':'loadingWasteModel','loading-helper-model':'loadingHelper','warming-local-model':'warmingModel','preparing-image':'analyzingLocal','detecting-materials':'analyzingLocal','checking-target-objects':'analyzingLocal','local-model-ready':'loadingHelper','helper-model-ready':'loadingWasteModel','ready':'readyToScan','complete':'readyToScan','waiting-for-scanner':'loadingOffline'};
 const label=tr(phases[value.stage]||'analyzingLocal');
 if(busy&&!pendingOnline&&!pendingLocal){$('analysisTitle').textContent=label;$('analysisDetail').textContent=tr(state.settings.scanScene==='group'?'groupScanTip':'scanTip');$('scanProgress').value=Math.max(5,Math.round((value.progress||0)*100));}
 else if(!busy){$('statusTitle').textContent=label;}
}
async function prepareScannerInBackground(){
 const intendsToScan=()=>Boolean(activeProfile(state))&&$('tab-scan').classList.contains('active')&&!$('profileDialog').open;
 if(scannerWarmupScheduled||modelReady||!intendsToScan())return;
 scannerWarmupScheduled=true;
 try{
  await new Promise(resolve=>setTimeout(resolve,250));
  // Report browsing and the welcome dialog never trigger the large model pack.
  if(!intendsToScan())return;
  await ensureModel();if(!busy&&intendsToScan())await warmupOffline({onProgress:showScanProgress});modelReady=true;updateStatus();
 }catch{}finally{scannerWarmupScheduled=false;}
}
async function checkOfflineCache(){
 try{const registration=await navigator.serviceWorker.getRegistration();const worker=registration?.active;if(!worker)return;
  const channel=new MessageChannel();const available=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error()),4000);channel.port1.onmessage=event=>{clearTimeout(timer);resolve(event.data.modelsReady&&event.data.shellReady);};worker.postMessage({type:'OFFLINE_STATUS'},[channel.port2]);});
  $('offlineStatus').textContent=tr(available?'cacheReady':'installHint');
 }catch{$('offlineStatus').textContent=tr('installHint');}
}
$('themeToggle').addEventListener('click',()=>{state.settings.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';save();applyTheme();});
$('themeSelect').addEventListener('change',()=>{state.settings.theme=$('themeSelect').value;save();applyTheme();});
const themeMedia=matchMedia('(prefers-color-scheme: dark)');const systemThemeChange=()=>{if(state.settings.theme==='system')applyTheme();};
if(themeMedia.addEventListener)themeMedia.addEventListener('change',systemThemeChange);else themeMedia.addListener?.(systemThemeChange);
$('cameraSwitch').addEventListener('click',()=>{if(cameraDevices.length<2)return;selectedCamera=(selectedCamera+1)%cameraDevices.length;currentFacing=currentFacing==='environment'?'user':'environment';openCamera({switching:true});});
$('cancelScan').addEventListener('click',()=>{abortScan();analysis=null;$('resultCard').hidden=true;toast(tr('scanCancelled'));updateStatus();});
$('useLocalNow').addEventListener('click',()=>acceptLocalAction?.());

if('serviceWorker'in navigator)navigator.serviceWorker.addEventListener?.('controllerchange',()=>checkOfflineCache());
refreshLanguage();showTab(['scan','journey','impact','reports','settings'].includes(location.hash.slice(1))?location.hash.slice(1):'scan');if(!activeProfile(state)&&location.hash!=='#reports')openProfiles();
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).then(()=>checkOfflineCache()).catch(()=>$('offlineStatus').textContent=tr('offlineMissing'));
schedulePublicSync();
motion=initMotion(document,{reduceMotion:()=>state.settings.reduceMotion===true});
