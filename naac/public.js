/* This page reads public institution aggregates only; it never opens EcoLens personal storage. */
export const METRIC_FIELDS = Object.freeze(['contributingProfiles','completedQuests','itemsHandled','estimatedKg','estimatedCo2Kg','reportedDivertedKg','assumedDivertedKg']);
const COUNTS = new Set(METRIC_FIELDS.slice(0,3));
const TYPES = new Set(['university','college','school','other']);
const PREF_KEY = 'ecolens-public-preferences';
export const FIREBASE_INTEGER_FIELDS = Object.freeze(['contributingProfiles','completedQuests','itemsHandled','estimatedMicroKg','estimatedCo2MicroKg','reportedDivertedMicroKg','assumedDivertedMicroKg']);
const t = (en,bn,hi) => ({en,bn,hi});
export const TEXT = Object.freeze({
 skip:t('Skip to reports','রিপোর্টে যান','रिपोर्ट पर जाएँ'), language:t('Language','ভাষা','भाषा'),
 publicBadge:t('PUBLIC INSTITUTION REPORTS','প্রতিষ্ঠানের প্রকাশ্য রিপোর্ট','सार्वजनिक संस्थान रिपोर्ट'),
 title:t('NAAC Sustainability Reports','NAAC পরিবেশগত রিপোর্ট','NAAC पर्यावरण रिपोर्ट'),
 intro:t('Explore how universities, colleges and schools contribute to a cleaner campus. These shared totals can be viewed by everyone.','বিশ্ববিদ্যালয়, কলেজ ও স্কুল কীভাবে পরিচ্ছন্ন ক্যাম্পাস গড়ে তুলছে দেখুন। এই সম্মিলিত তথ্য সবাই দেখতে পারেন।','देखें कि विश्वविद्यालय, कॉलेज और स्कूल स्वच्छ परिसर में कैसे योगदान देते हैं। ये साझा कुल आँकड़े सभी देख सकते हैं।'),
 privacy:t('Only institution totals are public. Student names, photos, personal activity and XP are not included.','শুধু প্রতিষ্ঠানের মোট তথ্য প্রকাশ্য। শিক্ষার্থীর নাম, ছবি, ব্যক্তিগত কাজ ও XP অন্তর্ভুক্ত নয়।','केवल संस्थान के कुल आँकड़े सार्वजनिक हैं। छात्रों के नाम, फोटो, व्यक्तिगत गतिविधि और XP शामिल नहीं हैं।'),
 loading:t('Loading shared reports…','সম্মিলিত রিপোর্ট লোড হচ্ছে…','साझा रिपोर्ट लोड हो रही हैं…'),
 loadingDetail:t('Connecting to the public report service.','প্রকাশ্য রিপোর্ট পরিষেবার সঙ্গে সংযোগ হচ্ছে।','सार्वजनिक रिपोर्ट सेवा से जुड़ रहा है।'),
 available:t('Shared reports are live','সম্মিলিত রিপোর্ট চালু আছে','साझा रिपोर्ट उपलब्ध हैं'),
 liveDetail:t('Updated {date}. These are anonymous, self-reported institution estimates.','আপডেট: {date}। এগুলি নামবিহীন, ব্যবহারকারীদের দেওয়া আনুমানিক তথ্য।','अपडेट: {date}। ये संस्थानों के अनाम, उपयोगकर्ताओं द्वारा बताए गए अनुमान हैं।'),
 noUploads:t('No contributions have been shared yet. All listed institutions remain available to view.','এখনও কোনো অবদান শেয়ার করা হয়নি। তালিকার সব প্রতিষ্ঠানের রিপোর্ট দেখা যাবে।','अभी कोई योगदान साझा नहीं हुआ है। सूची के सभी संस्थानों की रिपोर्ट देखी जा सकती है।'),
 unavailable:t('Shared reports are temporarily unavailable','সম্মিলিত রিপোর্ট আপাতত পাওয়া যাচ্ছে না','साझा रिपोर्ट फिलहाल उपलब्ध नहीं हैं'),
 unavailableDetail:t('Please reconnect and refresh. The directory is available, but totals cannot be loaded.','সংযোগ ফিরে এলে রিফ্রেশ করুন। প্রতিষ্ঠানের তালিকা আছে, কিন্তু মোট তথ্য লোড করা যাচ্ছে না।','फिर से इंटरनेट जोड़ें और रीफ्रेश करें। सूची उपलब्ध है, लेकिन कुल आँकड़े लोड नहीं हो सके।'),
 unconfigured:t('Shared reporting has not been connected yet','সম্মিলিত রিপোর্ট এখনও সংযুক্ত হয়নি','साझा रिपोर्टिंग अभी जुड़ी नहीं है'),
 unconfiguredDetail:t('The institution directory is ready. Shared totals will appear after the report service is configured.','প্রতিষ্ঠানের তালিকা প্রস্তুত। রিপোর্ট পরিষেবা চালু হলে সম্মিলিত মোট তথ্য দেখা যাবে।','संस्थान सूची तैयार है। रिपोर्ट सेवा जुड़ने के बाद साझा कुल आँकड़े दिखेंगे।'),
 refresh:t('Refresh','রিফ্রেশ','रीफ्रेश'), institutions:t('Institutions','প্রতিষ্ঠান','संस्थान'),
 sorted:t('Estimated material sorted','আনুমানিক বর্জ্য বাছাই','अनुमानित सामग्री छँटाई'),
 diverted:t('Estimated landfill diversion','ল্যান্ডফিল থেকে আনুমানিক বর্জ্য সরানো','लैंडफिल से अनुमानित बचाव'),
 co2:t('Estimated CO₂e potential','আনুমানিক CO₂e সম্ভাবনা','अनुमानित CO₂e संभावना'),
 directory:t('All institution reports','সব প্রতিষ্ঠানের রিপোর্ট','सभी संस्थानों की रिपोर्ट'),
 count:t('{count} of {total} institutions','{total}টি প্রতিষ্ঠানের মধ্যে {count}টি','{total} में से {count} संस्थान'),
 exportAll:t('Download all reports · CSV','সব রিপোর্ট ডাউনলোড · CSV','सभी रिपोर्ट डाउनलोड करें · CSV'),
 search:t('Search institutions','প্রতিষ্ঠান খুঁজুন','संस्थान खोजें'), searchPlaceholder:t('Search institution or area','প্রতিষ্ঠান বা এলাকা খুঁজুন','संस्थान या क्षेत्र खोजें'),
 institutionType:t('Institution type','প্রতিষ্ঠানের ধরন','संस्थान का प्रकार'),
 allTypes:t('All institution types','সব ধরনের প্রতিষ্ঠান','सभी प्रकार के संस्थान'),
 university:t('Universities','বিশ্ববিদ্যালয়','विश्वविद्यालय'), college:t('Colleges & institutes','কলেজ ও ইনস্টিটিউট','कॉलेज और संस्थान'), school:t('Schools','স্কুল','स्कूल'), other:t('Other institutions','অন্যান্য প্রতিষ্ঠান','अन्य संस्थान'),
 noMatches:t('No matching institutions. Try another search.','কোনো প্রতিষ্ঠান মেলেনি। অন্যভাবে খুঁজুন।','कोई संस्थान नहीं मिला। दूसरी खोज करें।'),
 openReport:t('Open NAAC report','NAAC রিপোর্ট দেখুন','NAAC रिपोर्ट खोलें'),
 hasRecords:t('Shared activity recorded','সম্মিলিত কার্যকলাপ নথিভুক্ত আছে','साझा गतिविधि दर्ज है'),
 noRecords:t('No shared activity recorded yet','এখনও কোনো সম্মিলিত কার্যকলাপ নথিভুক্ত হয়নি','अभी कोई साझा गतिविधि दर्ज नहीं है'),
 totalsUnavailable:t('Shared totals unavailable','সম্মিলিত মোট তথ্য পাওয়া যাচ্ছে না','साझा कुल आँकड़े उपलब्ध नहीं'),
 methodTitle:t('What these figures mean','এই তথ্যের অর্থ','इन आँकड़ों का अर्थ'),
 method:t('Totals come from shared EcoLens activity submitted by participating users. Material mass and CO₂e are estimates; diversion is recorded from user-confirmed sorting and estimated weights, not a verified waste audit. The directory is not a list of EcoLens partner institutions.','মোট তথ্য অংশগ্রহণকারীদের শেয়ার করা EcoLens কার্যকলাপ থেকে আসে। বর্জ্যের ওজন ও CO₂e আনুমানিক; ব্যবহারকারীর নিশ্চিত করা বাছাই ও আনুমানিক ওজনের ভিত্তিতে বর্জ্য সরানোর হিসাব হয়। এটি যাচাইকৃত বর্জ্য নিরীক্ষা নয়। তালিকা EcoLens-এর অংশীদার প্রতিষ্ঠানের তালিকা নয়।','कुल आँकड़े प्रतिभागियों की साझा EcoLens गतिविधि से आते हैं। सामग्री का भार और CO₂e अनुमान हैं; बचाव का आँकड़ा उपयोगकर्ता द्वारा पुष्टि की गई छँटाई और अनुमानित भार पर आधारित है। यह सत्यापित कचरा ऑडिट नहीं है। सूची EcoLens के भागीदार संस्थानों की सूची नहीं है।'),
 naacNote:t('This is supporting sustainability information for a NAAC report. It is not a NAAC accreditation result or an official certificate. Schools can view the same environmental summary.','এগুলি NAAC রিপোর্টের সহায়ক পরিবেশগত তথ্য। এটি NAAC স্বীকৃতির ফল বা সরকারি শংসাপত্র নয়। স্কুলও একই পরিবেশগত সারাংশ দেখতে পারে।','यह NAAC रिपोर्ट के लिए सहायक पर्यावरणीय जानकारी है। यह NAAC मान्यता परिणाम या आधिकारिक प्रमाणपत्र नहीं है। स्कूल भी यही पर्यावरणीय सारांश देख सकते हैं।'),
 footer:t('Small actions. A greener campus.','ছোট পদক্ষেপ। আরও সবুজ ক্যাম্পাস।','छोटे कदम। एक हरित परिसर।'),
 reportBadge:t('PUBLIC NAAC REPORT','প্রকাশ্য NAAC রিপোর্ট','सार्वजनिक NAAC रिपोर्ट'),
 detailNote:t('All values are institution aggregates. Confirmed and assumed diversion use estimated item weights; no student details are shown.','সব মান প্রতিষ্ঠানের সম্মিলিত হিসাব। নিশ্চিত ও অনুমিত বর্জ্য সরানোর হিসাবে আনুমানিক ওজন ব্যবহার করা হয়; শিক্ষার্থীর তথ্য দেখানো হয় না।','सभी मान संस्थान के कुल आँकड़े हैं। पुष्टि और अनुमानित बचाव में वस्तुओं का अनुमानित भार उपयोग होता है; छात्रों की व्यक्तिगत जानकारी नहीं दिखाई जाती।'),
 downloadReport:t('Download institution report · CSV','প্রতিষ্ঠানের রিপোর্ট ডাউনলোড · CSV','संस्थान रिपोर्ट डाउनलोड करें · CSV'),
 done:t('Done','সম্পন্ন','हो गया'), close:t('Close report','রিপোর্ট বন্ধ করুন','रिपोर्ट बंद करें'),
 lightTheme:t('Switch to light theme','হালকা থিম চালু করুন','लाइट थीम चुनें'), darkTheme:t('Switch to dark theme','গাঢ় থিম চালু করুন','डार्क थीम चुनें'),
 profiles:t('Contributing profiles','অবদান রাখা প্রোফাইল','योगदान देने वाले प्रोफाइल'),
 profilesNote:t('Anonymous device profiles; not a verified count of unique students.','নামবিহীন ডিভাইস প্রোফাইল; স্বতন্ত্র শিক্ষার্থীর যাচাইকৃত সংখ্যা নয়।','अनाम डिवाइस प्रोफाइल; विशिष्ट छात्रों की सत्यापित संख्या नहीं।'),
 quests:t('Completed actions','সম্পূর্ণ করা কাজ','पूर्ण किए गए कार्य'), items:t('Items handled','বাছাই করা বস্তু','संभाली गई वस्तुएँ'),
 reported:t('User-confirmed diversion estimate','ব্যবহারকারীর নিশ্চিত করা বর্জ্য সরানোর অনুমান','उपयोगकर्ता द्वारा पुष्टि किया गया बचाव अनुमान'),
 assumed:t('Assumed diversion estimate','অনুমিত বর্জ্য সরানোর হিসাব','माना गया बचाव अनुमान')
});

function exactKeys(value, keys) { return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && Object.keys(value).every(key=>keys.includes(key)); }
const validText = (value,max) => typeof value==='string' && value.length>0 && value.length<=max && !/[\u0000-\u001f]/.test(value);
export function validateCatalog(value) {
 if(!Array.isArray(value)||!value.length||value.length>1000)throw new Error('INVALID_CATALOG');
 const seen=new Set();
 return value.map(row=>{
  if(!exactKeys(row,['institutionId','name','type','area'])||!validText(row.institutionId,100)||!/^[a-z0-9-]+$/.test(row.institutionId)||seen.has(row.institutionId)||!validText(row.name,240)||!validText(row.area,240)||!TYPES.has(row.type))throw new Error('INVALID_CATALOG');
  seen.add(row.institutionId);return {...row};
 });
}
export function validatePublicSummary(value) {
 const keys=['version','source','scope','updatedAt','institutions'];
 if(!exactKeys(value,keys)||value.version!==1||value.source!=='shared'||value.scope!=='public-institution-aggregates'||!Array.isArray(value.institutions)||value.institutions.length>1000||!(value.updatedAt===null||(typeof value.updatedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value.updatedAt)&&Number.isFinite(Date.parse(value.updatedAt)))))throw new Error('INVALID_PUBLIC_REPORT');
 const seen=new Set();
 const institutions=value.institutions.map(row=>{
  const allowed=['institutionId','name','type','area',...METRIC_FIELDS,'hasRecords'];
  if(!exactKeys(row,allowed)||!validText(row.institutionId,100)||!/^[a-z0-9-]+$/.test(row.institutionId)||seen.has(row.institutionId)||!validText(row.name,240)||!validText(row.area,240)||!TYPES.has(row.type)||typeof row.hasRecords!=='boolean')throw new Error('INVALID_PUBLIC_REPORT');
  seen.add(row.institutionId);const clean={institutionId:row.institutionId,name:row.name,type:row.type,area:row.area};
  for(const field of METRIC_FIELDS){const n=row[field];if(typeof n!=='number'||!Number.isFinite(n)||n<0||(COUNTS.has(field)&&!Number.isSafeInteger(n)))throw new Error('INVALID_PUBLIC_REPORT');clean[field]=n;}
  const mass=clean.reportedDivertedKg+clean.assumedDivertedKg;
  if(Math.abs(clean.estimatedKg-mass)>0.000001*Math.max(1,mass)||row.hasRecords!==METRIC_FIELDS.some(field=>clean[field]>0))throw new Error('INVALID_PUBLIC_REPORT');
  clean.hasRecords=row.hasRecords;return clean;
 });
 if(value.updatedAt===null&&institutions.some(row=>row.hasRecords))throw new Error('INVALID_PUBLIC_REPORT');
 return {version:1,source:'shared',scope:'public-institution-aggregates',updatedAt:value.updatedAt,institutions};
}
export function validateFirebaseConfig(value) {
 if(!exactKeys(value,['version','provider','projectId','apiKey','databaseURL'])||value.version!==1||value.provider!=='firebase')throw new Error('INVALID_FIREBASE_CONFIG');
 if(['projectId','apiKey','databaseURL'].some(field=>typeof value[field]!=='string'))throw new Error('INVALID_FIREBASE_CONFIG');
 if(['projectId','apiKey','databaseURL'].some(field=>!value[field].trim()))return null;
 if(!/^[a-z][a-z0-9-]{4,29}$/.test(value.projectId)||!/^AIza[0-9A-Za-z_-]{35}$/.test(value.apiKey))throw new Error('INVALID_FIREBASE_CONFIG');
 let url;try{url=new URL(value.databaseURL);}catch{throw new Error('INVALID_FIREBASE_CONFIG');}
 const labels=url.hostname.split('.'),bound=labels[0]===value.projectId||labels[0]===`${value.projectId}-default-rtdb`;
 const official=labels.length===3&&labels.slice(1).join('.')==='firebaseio.com'||labels.length===4&&/^[a-z0-9-]+$/.test(labels[1])&&labels.slice(2).join('.')==='firebasedatabase.app';
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||url.pathname!=='/'||!official||!bound)throw new Error('INVALID_FIREBASE_CONFIG');
 return {version:1,provider:'firebase',projectId:value.projectId,apiKey:value.apiKey,databaseURL:url.origin};
}
export function firebasePublicSummary(raw,catalog) {
 if(raw!==null&&(!raw||typeof raw!=='object'||Array.isArray(raw)))throw new Error('INVALID_FIREBASE_REPORT');
 const known=new Set(catalog.map(row=>row.institutionId)),records=new Map();let latest=null;
 for(const [id,row]of Object.entries(raw||{})){
  if(!known.has(id)||!exactKeys(row,[...FIREBASE_INTEGER_FIELDS,'updatedAt']))throw new Error('INVALID_FIREBASE_REPORT');
  for(const field of FIREBASE_INTEGER_FIELDS){const number=row[field],max=COUNTS.has(field)?1e9:1e15;if(!Number.isSafeInteger(number)||number<0||number>max)throw new Error('INVALID_FIREBASE_REPORT');}
  if(row.estimatedMicroKg!==row.reportedDivertedMicroKg+row.assumedDivertedMicroKg||!Number.isSafeInteger(row.updatedAt)||row.updatedAt<0||row.updatedAt>8640000000000000)throw new Error('INVALID_FIREBASE_REPORT');
  latest=latest===null?row.updatedAt:Math.max(latest,row.updatedAt);records.set(id,row);
 }
 const institutions=catalog.map(institution=>{const row=records.get(institution.institutionId)||{};return {...institution,contributingProfiles:row.contributingProfiles||0,completedQuests:row.completedQuests||0,itemsHandled:row.itemsHandled||0,estimatedKg:(row.estimatedMicroKg||0)/1e6,estimatedCo2Kg:(row.estimatedCo2MicroKg||0)/1e6,reportedDivertedKg:(row.reportedDivertedMicroKg||0)/1e6,assumedDivertedKg:(row.assumedDivertedMicroKg||0)/1e6,hasRecords:FIREBASE_INTEGER_FIELDS.some(field=>(row[field]||0)>0)};});
 return validatePublicSummary({version:1,source:'shared',scope:'public-institution-aggregates',updatedAt:latest===null?null:new Date(latest).toISOString(),institutions});
}
export function mergeCatalog(catalog,summary=null) {
 const records=new Map((summary?.institutions||[]).map(row=>[row.institutionId,row]));
 return catalog.map(institution=>{const record=records.get(institution.institutionId);return {...institution,...Object.fromEntries(METRIC_FIELDS.map(field=>[field,record?record[field]:null])),hasRecords:record?record.hasRecords:false,available:Boolean(record)};});
}
export function filterInstitutions(rows,search='',type='all') {
 const needle=String(search).trim().normalize('NFKC').toLocaleLowerCase();
 return rows.filter(row=>(type==='all'||row.type===type)&&(!needle||`${row.name} ${row.area}`.normalize('NFKC').toLocaleLowerCase().includes(needle)));
}
export function aggregateTotals(rows) {
 if(!rows.length||rows.some(row=>!row.available))return null;
 return Object.fromEntries(METRIC_FIELDS.map(field=>[field,rows.reduce((total,row)=>total+row[field],0)]));
}
const csvCell=value=>{const text=String(value??'');return `"${(/^[\s]*[=+@-]/.test(text)?"'"+text:text).replace(/"/g,'""')}"`;};
export function reportCSV(rows,{updatedAt=null}={}) {
 const headings=['Institution','Institution type','Area','Contributing device profiles','Completed actions','Items handled','Estimated material sorted (kg)','Estimated CO2e potential (kg)','User-confirmed diversion estimate (kg)','Assumed diversion estimate (kg)','Record status','Updated at','Data scope','Method'];
 const records=rows.map(row=>[row.name,row.type,row.area,...METRIC_FIELDS.map(field=>row.available?row[field]:''),row.available?(row.hasRecords?'Shared activity recorded':'No shared activity recorded'):'Shared totals unavailable',updatedAt||'','public institution aggregates','anonymous self-reported activity; estimated weights, not verified waste audit']);
 return '\ufeff'+[headings,...records].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export function readPreferences(storage) {
 try{const raw=JSON.parse(storage?.getItem(PREF_KEY)||'{}');return {language:['en','bn','hi'].includes(raw.language)?raw.language:'en',theme:['light','dark'].includes(raw.theme)?raw.theme:null};}catch{return {language:'en',theme:null};}
}
function savePreferences(storage,value){try{storage?.setItem(PREF_KEY,JSON.stringify({language:value.language,theme:value.theme}));}catch{/* The page works when storage is disabled. */}}
export function createPublicApp({document,fetch:fetchImpl,storage,matchMedia,download,timeoutMs=10000}={}) {
 const $=id=>document.getElementById(id),prefs=readPreferences(storage);
 let language=prefs.language,theme=prefs.theme||(matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light');
 let catalog=[],firebaseConfig=null,summary=null,status='loading',rows=[],selectedId=null,loadId=0,lastController=null,lastFocus=null;
 const tr=(key,values={})=>(TEXT[key]?.[language]||TEXT[key]?.en||key).replace(/\{(\w+)\}/g,(_,name)=>values[name]??'');
 const number=(n,maxDigits=2)=>new Intl.NumberFormat(language,{maximumFractionDigits:maxDigits}).format(n);
 const kg=n=>n===null?'—':`${number(n)} kg`;
 const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
 function translate(){document.documentElement.lang=language;document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;$('language').value=language;document.title=`EcoLens · ${tr('title')}`;
  for(const node of document.querySelectorAll('[data-i18n]'))node.textContent=tr(node.dataset.i18n);
  $('search').placeholder=tr('searchPlaceholder');$('language').setAttribute('aria-label',tr('language'));$('theme').textContent=theme==='dark'?'☀':'☾';$('theme').setAttribute('aria-label',tr(theme==='dark'?'lightTheme':'darkTheme'));$('closeDialog').setAttribute('aria-label',tr('close'));$('summary').setAttribute('aria-label',tr('title'));
 }
 function renderStatus(){const titles={loading:'loading',available:'available',unavailable:'unavailable',unconfigured:'unconfigured'};const details={loading:'loadingDetail',unavailable:'unavailableDetail',unconfigured:'unconfiguredDetail'};
  $('loadStatus').dataset.state=status;$('statusTitle').textContent=tr(titles[status]);
  const date=summary?.updatedAt?new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(summary.updatedAt)):null;
  $('statusText').textContent=status==='available'?tr(date?'liveDetail':'noUploads',{date}):tr(details[status]);$('refresh').disabled=status==='loading';
 }
 function metric(parent,label,value){const box=element('div');box.append(element('span','',tr(label)),element('strong','',value));parent.append(box);}
 function renderDialog(){const row=rows.find(value=>value.institutionId===selectedId);if(!row)return;
  $('dialogTitle').textContent=row.name;$('dialogArea').textContent=`${tr(row.type)} · ${row.area}`;$('dialogAvailability').textContent=tr(row.available?(row.hasRecords?'hasRecords':'noRecords'):'totalsUnavailable');
  const list=$('dialogMetrics');list.replaceChildren();metric(list,'sorted',kg(row.estimatedKg));metric(list,'diverted',row.available?kg(row.reportedDivertedKg+row.assumedDivertedKg):'—');metric(list,'co2',kg(row.estimatedCo2Kg));metric(list,'items',row.available?number(row.itemsHandled,0):'—');metric(list,'quests',row.available?number(row.completedQuests,0):'—');metric(list,'profiles',row.available?number(row.contributingProfiles,0):'—');metric(list,'reported',kg(row.reportedDivertedKg));metric(list,'assumed',kg(row.assumedDivertedKg));
  $('profileCountNote').textContent=tr('profilesNote');$('exportInstitution').disabled=!row.available;
 }
 function render(){translate();renderStatus();rows=mergeCatalog(catalog,summary);const total=aggregateTotals(rows);
  $('totalInstitutions').textContent=number(catalog.length,0);$('totalSorted').textContent=total?kg(total.estimatedKg):'—';$('totalDiverted').textContent=total?kg(total.reportedDivertedKg+total.assumedDivertedKg):'—';$('totalCo2').textContent=total?kg(total.estimatedCo2Kg):'—';$('exportAll').disabled=!total;
  const filtered=filterInstitutions(rows,$('search').value,$('typeFilter').value||'all');$('resultCount').textContent=tr('count',{count:number(filtered.length,0),total:number(rows.length,0)});$('emptyResults').hidden=filtered.length>0||!catalog.length;
  const grid=$('institutionGrid');grid.replaceChildren();
  for(const row of filtered){const card=element('article','institution-card');card.append(element('span','type-label',tr(row.type)),element('h3','',row.name),element('p','area',row.area));
   const stat=element('div','card-stat');stat.append(element('span','',tr('diverted')),element('strong','',row.available?kg(row.reportedDivertedKg+row.assumedDivertedKg):'—'));card.append(stat,element('p','record-status',tr(row.available?(row.hasRecords?'hasRecords':'noRecords'):'totalsUnavailable')));
   const open=element('button','secondary',`${tr('openReport')} ↗`);open.type='button';open.setAttribute('aria-label',`${tr('openReport')}: ${row.name}`);open.addEventListener('click',()=>openInstitution(row.institutionId,open));card.append(open);grid.append(card);
  }
  if(selectedId)renderDialog();
 }
 function closeDialog(){const dialog=$('institutionDialog');if(dialog.open)dialog.close?.();dialog.removeAttribute('open');document.body.classList.remove('dialog-open');lastFocus?.focus?.();}
 function openInstitution(id,opener=null){if(!rows.some(row=>row.institutionId===id))return;selectedId=id;lastFocus=opener||document.activeElement;renderDialog();const dialog=$('institutionDialog');if(!dialog.open){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}document.body.classList.add('dialog-open');$('closeDialog').focus?.();}
 function exportRows(values,filename){if(!values.length||values.some(row=>!row.available))return false;const csv=reportCSV(values,{updatedAt:summary.updatedAt});if(download)download(csv,filename);else{const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=element('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}return true;}
 async function refresh(){const id=++loadId;lastController?.abort();lastController=new AbortController();const controller=lastController;
  status='loading';summary=null;render();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   if(!catalog.length){const response=await fetchImpl('./catalog.json',{cache:'no-store',credentials:'omit',signal:controller.signal});if(!response.ok)throw new Error('CATALOG_UNAVAILABLE');const nextCatalog=validateCatalog(await response.json());if(id!==loadId)return;catalog=nextCatalog;render();}
   if(!firebaseConfig){
    const configResponse=await fetchImpl('./firebase-config.json',{cache:'no-cache',credentials:'omit',signal:controller.signal,headers:{Accept:'application/json'}});
    if(id!==loadId)return;
    if(configResponse.status===404){status='unconfigured';return;}
    if(!configResponse.ok)throw new Error('CONFIG_UNAVAILABLE');
    const nextConfig=validateFirebaseConfig(await configResponse.json());if(id!==loadId)return;firebaseConfig=nextConfig;
    if(!firebaseConfig){status='unconfigured';return;}
   }
   const response=await fetchImpl(`${firebaseConfig.databaseURL}/ecolensNaacV1/publicInstitutions.json`,{cache:'no-store',credentials:'omit',signal:controller.signal,headers:{Accept:'application/json'}});
   let body;try{body=await response.json();}catch{throw new Error('REPORT_UNAVAILABLE');}
   if(id!==loadId)return;
   if(!response.ok){status='unavailable';}
   else{summary=firebasePublicSummary(body,catalog);status='available';}
  }catch{if(id!==loadId)return;summary=null;status='unavailable';}
  finally{clearTimeout(timer);if(id===loadId)render();}
 }
 $('language').addEventListener('change',()=>{language=['en','bn','hi'].includes($('language').value)?$('language').value:'en';savePreferences(storage,{language,theme});render();});
 $('theme').addEventListener('click',()=>{theme=theme==='dark'?'light':'dark';savePreferences(storage,{language,theme});render();});
 $('search').addEventListener('input',render);$('typeFilter').addEventListener('change',render);$('refresh').addEventListener('click',refresh);
 $('closeDialog').addEventListener('click',closeDialog);$('dialogDone').addEventListener('click',closeDialog);$('institutionDialog').addEventListener('close',()=>{document.body.classList.remove('dialog-open');lastFocus?.focus?.();});
 $('institutionDialog').addEventListener('click',event=>{if(event.target===$('institutionDialog')){const rect=event.target.getBoundingClientRect?.();if(rect&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))closeDialog();}});
 $('institutionDialog').addEventListener('cancel',()=>document.body.classList.remove('dialog-open'));
 $('exportAll').addEventListener('click',()=>exportRows(rows,'EcoLens-public-NAAC-all-institutions.csv'));
 $('exportInstitution').addEventListener('click',()=>{const row=rows.find(value=>value.institutionId===selectedId);if(row)exportRows([row],`EcoLens-public-NAAC-${row.institutionId}.csv`);});
 render();
 return {refresh,openInstitution,closeDialog,getState:()=>({status,language,theme,catalog:catalog.map(row=>({...row})),summary,rows:rows.map(row=>({...row}))}),dispose:()=>{++loadId;lastController?.abort();}};
}
if(typeof window!=='undefined'&&typeof document!=='undefined'&&document.getElementById('institutionGrid')){
 let storage;try{storage=window.localStorage;}catch{/* Read-only reports also work with browser storage blocked. */}
 const app=createPublicApp({document,fetch:window.fetch.bind(window),storage,matchMedia:window.matchMedia?.bind(window)});
 app.refresh();
}
