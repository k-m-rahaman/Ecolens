/* EcoLens device-only ledger. Every impact value is an illustrative estimate. */
export const STORAGE_KEY = 'ecolens-pro-v2';
export const ROUTES = Object.freeze(['organic', 'recycle', 'ewaste', 'residual', 'inert', 'unknown', 'nonwaste']);
export const DEFAULT_MASS_GRAMS = Object.freeze({ organic: 80, recycle: 25, ewaste: 120, residual: 25, inert: 150, unknown: 0, nonwaste: 0 });
export const ILLUSTRATIVE_CO2_FACTORS = Object.freeze({ organic: 0.3, recycle: 1.1, ewaste: 0.8, residual: 0, inert: 0, unknown: 0, nonwaste: 0 });
export const MAX_IMPORT_BYTES = 8_000_000;
const MAX_PROFILES = 200;
const MAX_EVENTS = 10_000;
const MAX_COMPONENTS = 30;
const MAX_CORRECTIONS = 2_000;
const MAX_LEGACY_XP = 1_000_000;
const LEGACY_CAMPUS_CODES = Object.freeze({ brainware: 'BWU', 'brainware-university': 'BWU', bwu: 'BWU', jadavpur: 'JU', 'jadavpur-university': 'JU', ju: 'JU', 'techno-india': 'TIU', 'techno-india-university': 'TIU', tiu: 'TIU' });
const REAL_ROUTES = new Set(['organic', 'recycle', 'ewaste', 'residual', 'inert']);
const MATERIAL_ALIASES = Object.freeze({ steel: 'metal', 'stainless steel': 'metal', aluminum: 'metal', aluminium: 'metal', tin: 'metal', iron: 'metal', 'pet plastic': 'plastic', pet: 'plastic', hdpe: 'plastic', 'rigid-plastic': 'rigid plastic', 'soft-plastic': 'soft plastic', 'lined-paper': 'lined paper', food: 'organic', biodegradable: 'organic', cloth: 'fabric', textile: 'fabric', electronics: 'electronic', 'e-waste': 'electronic', 'confirmed by user': 'unknown', uncertain: 'unknown', unidentified: 'unknown' });
const MATERIAL_NAMES = new Set(['metal', 'plastic', 'rigid plastic', 'soft plastic', 'glass', 'paper', 'lined paper', 'cardboard', 'organic', 'fabric', 'rubber', 'wood', 'electronic', 'ceramic', 'foam', 'other', 'mixed', 'unknown']);
const NON_WASTE_NAMES = new Set(['person', 'people', 'human', 'chair', 'dining table', 'table', 'couch', 'sofa', 'bed', 'bench', 'car', 'truck', 'bus', 'train', 'motorcycle', 'bicycle', 'traffic light', 'stop sign', 'fire hydrant', 'parking meter', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe']);
const ALIASES = Object.freeze({
  green: 'organic', bio: 'organic', biodegradable: 'organic', compost: 'organic', compostable: 'organic', food: 'organic', wet: 'organic', 'wet waste': 'organic', 'organic waste': 'organic',
  blue: 'recycle', recycling: 'recycle', recyclable: 'recycle', recyclables: 'recycle', dry: 'recycle', 'dry waste': 'recycle', 'recyclable waste': 'recycle',
  red: 'ewaste', 'e-waste': 'ewaste', 'e waste': 'ewaste', electronic: 'ewaste', electronics: 'ewaste', 'electronic waste': 'ewaste', hazardous: 'ewaste',
  grey: 'residual', gray: 'residual', general: 'residual', landfill: 'residual', 'general waste': 'residual', 'non-recyclable': 'residual',
  rubble: 'inert', 'inert waste': 'inert', uncertain: 'unknown', unrecognized: 'unknown', unidentified: 'unknown', 'not waste': 'nonwaste', 'non-waste': 'nonwaste', background: 'nonwaste'
});

function cleanText(value, max = 120, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function requiredText(value, label, max = 120) {
  if (typeof value !== 'string' || value.length > max || !cleanText(value, max)) throw new Error(`${label} is missing or too long.`);
  return cleanText(value, max);
}
function finiteNumber(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function id(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}
function newState() {
  return { version: 2, activeProfileId: null, profiles: [], events: [], settings: { language: 'en', mode: 'offline', endpoint: '', voice: true, reduceMotion: false, cloudConsent: false, theme: 'system', scanScene: 'single', publicReportEndpoint:'', shareInstitutionTotals:false }, corrections: [] };
}

export function normalizeRoute(value) {
  const route = cleanText(value, 80).toLowerCase();
  return ROUTES.includes(route) ? route : Object.prototype.hasOwnProperty.call(ALIASES, route) ? ALIASES[route] : 'unknown';
}

export function normalizeMaterial(value) {
  const material = cleanText(value, 80).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MATERIAL_ALIASES, material)) return MATERIAL_ALIASES[material];
  return MATERIAL_NAMES.has(material) ? material : 'unknown';
}

function unresolvedMaterial(item) {
  if (item.route === 'nonwaste' && item.reusable === true && item.discardedByUser === false) return false;
  return item.requiresMaterialConfirmation === true && item.materialConfirmedByUser !== true;
}

function normalizeComponent(item, userConfirmed = false) {
  const raw = typeof item === 'string' ? { name: item } : item && typeof item === 'object' ? item : {};
  const name = cleanText(raw.name ?? raw.label ?? raw.class ?? raw.item ?? raw.object, 120, 'Unidentified item') || 'Unidentified item';
  let route = normalizeRoute(raw.route ?? raw.bin ?? raw.category ?? raw.wasteType);
  const confirmed = userConfirmed || raw.confirmedByUser === true;
  const person = ['person', 'people', 'human'].includes(name.toLowerCase());
  if (raw.isWaste === false || raw.is_waste === false || person || (NON_WASTE_NAMES.has(name.toLowerCase()) && !(confirmed && REAL_ROUTES.has(route)))) route = 'nonwaste';
  if (raw.reusable === true && raw.discardedByUser !== true) route = 'nonwaste';
  const component = { name, material: cleanText(raw.material, 80, 'unknown') || 'unknown', route };
  if (confirmed && REAL_ROUTES.has(route)) component.confirmedByUser = true;
  if (raw.requiresMaterialConfirmation === true) component.requiresMaterialConfirmation = true;
  const actualMaterial = normalizeMaterial(component.material);
  if (raw.materialConfirmedByUser === true && actualMaterial !== 'unknown' && actualMaterial !== 'mixed' && confirmed && REAL_ROUTES.has(route)) component.materialConfirmedByUser = true;
  if (raw.reusable === true) component.reusable = true;
  if (typeof raw.discardedByUser === 'boolean') component.discardedByUser = raw.discardedByUser;
  const candidateMaterials = Array.isArray(raw.candidateMaterials) ? [...new Set(raw.candidateMaterials.slice(0, 12).map(normalizeMaterial).filter(value => !['unknown', 'mixed'].includes(value)))] : [];
  if (candidateMaterials.length) component.candidateMaterials = candidateMaterials;
  const materialCandidates = Array.isArray(raw.materialCandidates) ? raw.materialCandidates.slice(0, 12).flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object') return [];
    const material = normalizeMaterial(candidate.material);
    const confidence = Number(candidate.confidence);
    return !['unknown', 'mixed'].includes(material) && Number.isFinite(confidence) ? [{ material, confidence: Math.max(0, Math.min(1, confidence)) }] : [];
  }) : [];
  if (materialCandidates.length) component.materialCandidates = materialCandidates;
  const score = raw.confidence ?? raw.score ?? raw.probability;
  if (score !== undefined && score !== null && Number.isFinite(Number(score))) {
    const numeric = Number(score);
    component.confidence = Math.max(0, Math.min(1, numeric > 1 && numeric <= 100 ? numeric / 100 : numeric));
  }
  const box = raw.bbox ?? raw.box;
  const coords = Array.isArray(box) ? box.slice(0, 4) : box && [box.x, box.y, box.w ?? box.width, box.h ?? box.height];
  if (coords?.length === 4 && coords.every(v => Number.isFinite(Number(v))) && Number(coords[2]) > 0 && Number(coords[3]) > 0) {
    component.bbox = { x: Math.max(0, Number(coords[0])), y: Math.max(0, Number(coords[1])), w: Number(coords[2]), h: Number(coords[3]) };
  }
  const advice = cleanText(raw.advice ?? raw.instructions ?? raw.disposal, 600);
  if (advice) component.advice = advice;
  return component;
}

export function normalizeAnalysis(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(input) ? input : input.components ?? input.objects ?? input.items ?? input.predictions ?? input.wasteComponents;
  const confirmed = ['manual', 'confirmed'].includes(input.source);
  const components = (Array.isArray(list) ? list : input.name || input.label || input.class ? [input] : []).slice(0, MAX_COMPONENTS).map(item => normalizeComponent(item, confirmed));
  const waste = components.filter(item => item.route !== 'nonwaste');
  const identifiedItems = components.filter(item => item.route !== 'nonwaste' || item.reusable === true);
  const destinations = new Set(waste.filter(item => REAL_ROUTES.has(item.route)).map(item => item.route));
  const group = (list, key, field) => [...new Map(list.map(item => [key(item), null])).keys()].map(value => {
    const members = list.filter(item => key(item) === value);
    return { [field]: value, count: members.length, components: members };
  });
  const materialKey = item => normalizeMaterial(item.material);
  const materialGroups = group(identifiedItems, materialKey, 'material');
  const destinationGroups = group(waste, item => item.route, 'route');
  const knownMaterials = materialGroups.filter(item => !['unknown', 'mixed'].includes(item.material));
  const unresolvedMaterials = identifiedItems.filter(unresolvedMaterial).length;
  const warnings = Array.isArray(input.warnings) ? input.warnings.map(v => cleanText(v, 600)).filter(Boolean).slice(0, 12) : [];
  if (!waste.length && !warnings.length) warnings.push('No discarded item identified. Select an item or retake the photo.');
  if (waste.some(item => item.route === 'unknown') && !warnings.some(v => v.toLowerCase().includes('confirm'))) warnings.push('Confirm the material and campus disposal guidance before choosing a bin.');
  if (unresolvedMaterials && !warnings.some(v => v.toLowerCase().includes('material'))) warnings.push('The image cannot reliably distinguish these materials. Confirm each material before disposal.');
  return {
    source: cleanText(input.source, 80, 'unknown') || 'unknown', components,
    uncertain: !waste.length || unresolvedMaterials > 0 || (input.uncertain === true && !waste.every(item => item.confirmedByUser === true)) || waste.some(item => item.route === 'unknown' || (item.confidence !== undefined && item.confidence < 0.55 && item.confirmedByUser !== true)),
    mixed: destinations.size > 1, mixedMaterials: knownMaterials.length > 1 || identifiedItems.some(item => normalizeMaterial(item.material) === 'mixed'),
    multiItem: identifiedItems.length > 1, identifiedItemCount: identifiedItems.length, wasteItemCount: waste.length, reusableItemCount: identifiedItems.filter(item => item.route === 'nonwaste').length,
    materialGroups, destinationGroups, unresolvedMaterials, warnings
  };
}

export function manualAnalysis(route, name = 'Manually identified item') {
  return normalizeAnalysis({ source: 'manual', components: [{ name, route: normalizeRoute(route), material: 'confirmed by user', confidence: 1, advice: 'Follow the collection guidance posted at your institution.' }] });
}

function validateProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid profile.');
  const profile = { id: requiredText(raw.id, 'Profile ID'), name: requiredText(raw.name, 'Name', 80), institutionId: requiredText(raw.institutionId, 'Institution ID') };
  if (raw.customInstitution !== undefined && raw.customInstitution !== '') profile.customInstitution = requiredText(raw.customInstitution, 'Institution name', 160);
  if (raw.legacyXP !== undefined) {
    if (!Number.isInteger(raw.legacyXP) || raw.legacyXP < 0 || raw.legacyXP > MAX_LEGACY_XP) throw new Error('Invalid legacy XP.');
    profile.legacyXP = raw.legacyXP;
  }
  return profile;
}
function validateSettings(raw = {}) {
  const publicReportEndpoint=cleanText(raw.publicReportEndpoint,2_000);
  if(publicReportEndpoint){
    let url;try{url=new URL(publicReportEndpoint);}catch{throw new Error('The public report address must be valid.');}
    if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('Use a public HTTPS report service address without credentials.');
  }
  const endpoint = cleanText(raw.endpoint, 2_000);
  if (endpoint) {
    let url;
    try { url = new URL(endpoint); } catch { throw new Error('The online endpoint must be a valid URL.'); }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS for the online endpoint.');
    if (url.username || url.password) throw new Error('Do not put credentials in the endpoint URL.');
  }
  return { language: ['en', 'bn', 'hi'].includes(raw.language) ? raw.language : 'en', mode: raw.mode === 'online' ? 'online' : 'offline', endpoint, voice: raw.voice !== false, reduceMotion: raw.reduceMotion === true, cloudConsent: raw.cloudConsent === true, theme: ['system', 'light', 'dark'].includes(raw.theme) ? raw.theme : 'system', scanScene: raw.scanScene === 'group' ? 'group' : 'single',publicReportEndpoint,shareInstitutionTotals:raw.shareInstitutionTotals===true };
}
function validateEvent(raw, profileIds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid completion event.');
  const profileId = requiredText(raw.profileId, 'Event profile ID');
  if (!profileIds.has(profileId)) throw new Error('An event refers to a missing profile.');
  if (!['sort', 'upcycle'].includes(raw.kind)) throw new Error('Invalid quest type.');
  if (!Array.isArray(raw.components) || !raw.components.length || raw.components.length > MAX_COMPONENTS) throw new Error('A completion needs 1–30 components.');
  const components = raw.components.map(item => normalizeComponent(item, ['manual', 'confirmed'].includes(raw.source)));
  if (components.some(item => !REAL_ROUTES.has(item.route))) throw new Error('Confirm a disposal route for each waste component first.');
  if (components.some(unresolvedMaterial)) throw new Error('Confirm the material and disposal route for each waste component first.');
  const timestamp = new Date(raw.timestamp);
  if (!Number.isFinite(timestamp.getTime())) throw new Error('Invalid completion date.');
  const weightGrams = finiteNumber(raw.weightGrams, -1);
  if (weightGrams < 0 || weightGrams > 100_000) throw new Error('Weight must be between 0 and 100,000 grams.');
  const xp = finiteNumber(raw.xp, -1);
  if (!Number.isInteger(xp) || xp < 0 || xp > 100) throw new Error('Invalid event XP.');
  const event = {
    id: requiredText(raw.id, 'Event ID'), profileId, kind: raw.kind, components,
    source: cleanText(raw.source, 80, 'manual') || 'manual', timestamp: timestamp.toISOString(),
    xp, weightGrams, weightSource: raw.weightSource === 'user' ? 'user' : 'illustrative',
    selfReported: true
  };
  if (raw.tutorialId) event.tutorialId = requiredText(raw.tutorialId, 'Tutorial ID');
  if (raw.imageHash) event.imageHash = requiredText(raw.imageHash, 'Image fingerprint', 200);
  if (raw.confirmedBin) {
    const bin = normalizeRoute(raw.confirmedBin);
    if (!REAL_ROUTES.has(bin)) throw new Error('Invalid confirmed bin.');
    event.confirmedBin = bin;
  }
  return event;
}

export function validateState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 2) throw new Error('This is not an EcoLens version 2 backup.');
  if (!Array.isArray(raw.profiles) || raw.profiles.length > MAX_PROFILES) throw new Error('The backup has too many profiles.');
  if (!Array.isArray(raw.events) || raw.events.length > MAX_EVENTS) throw new Error('The backup has too many completion records.');
  const profiles = raw.profiles.map(validateProfile);
  const profileIds = new Set(profiles.map(profile => profile.id));
  if (profileIds.size !== profiles.length) throw new Error('Duplicate profile IDs in the backup.');
  const events = raw.events.map(event => validateEvent(event, profileIds));
  const eventIds = new Set(events.map(event => event.id));
  if (eventIds.size !== events.length) throw new Error('Duplicate completion IDs in the backup.');
  const activeProfileId = raw.activeProfileId == null ? null : requiredText(raw.activeProfileId, 'Active profile ID');
  if (activeProfileId && !profileIds.has(activeProfileId)) throw new Error('The active profile does not exist.');
  if (raw.corrections !== undefined && (!Array.isArray(raw.corrections) || raw.corrections.length > MAX_CORRECTIONS)) throw new Error('Too many correction records.');
  const corrections = (raw.corrections || []).map(correction => {
    if (!correction || typeof correction !== 'object') throw new Error('Invalid correction record.');
    const suppliedRoute = requiredText(correction.route ?? correction.correctedRoute, 'Correction route', 80).toLowerCase();
    if (!ROUTES.includes(suppliedRoute) && !Object.prototype.hasOwnProperty.call(ALIASES, suppliedRoute)) throw new Error('Invalid correction route.');
    const route = normalizeRoute(suppliedRoute);
    const record = { id: cleanText(correction.id, 120) || id('correction'), name: cleanText(correction.name, 120, 'Item') || 'Item', route, timestamp: cleanText(correction.timestamp, 80) };
    if (correction.profileId) {
      record.profileId = requiredText(correction.profileId, 'Correction profile ID');
      if (!profileIds.has(record.profileId)) throw new Error('A correction refers to a missing profile.');
    }
    if (correction.originalRoute) record.originalRoute = normalizeRoute(correction.originalRoute);
    if (correction.source) record.source = cleanText(correction.source, 80);
    if (correction.material) record.material = cleanText(correction.material, 80);
    if (correction.originalMaterial) record.originalMaterial = cleanText(correction.originalMaterial, 80);
    if (correction.requiresMaterialConfirmation === true) record.requiresMaterialConfirmation = true;
    if (correction.confirmedByUser === true) record.confirmedByUser = true;
    if (correction.materialConfirmedByUser === true && record.confirmedByUser === true && !['unknown', 'mixed'].includes(normalizeMaterial(record.material)) && REAL_ROUTES.has(route)) record.materialConfirmedByUser = true;
    if (correction.reusable === true) record.reusable = true;
    if (typeof correction.discardedByUser === 'boolean') record.discardedByUser = correction.discardedByUser;
    return record;
  });
  return { version: 2, activeProfileId, profiles, events, settings: validateSettings(raw.settings), corrections };
}

export function loadAppState(storage) {
  try {
    const saved = (storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY);
    return saved ? importState(saved) : newState();
  } catch {
    // Leave old and corrupt keys intact. A new session never fabricates disposal records.
    return newState();
  }
}
export function persistState(state, storage = globalThis.localStorage) {
  const validated = validateState(state);
  if (!storage?.setItem) throw new Error('Device storage is unavailable. Export a backup to keep your progress.');
  storage.setItem(STORAGE_KEY, JSON.stringify(validated));
  return validated;
}
export function exportState(state) { return JSON.stringify(validateState(state), null, 2); }
export function importState(text) {
  if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) throw new Error('Choose an EcoLens JSON backup smaller than 8 MB.');
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('The backup is not valid JSON.'); }
  return validateState(raw);
}
export function activeProfile(state) { return state.profiles.find(profile => profile.id === state.activeProfileId) || null; }
function readLegacyXP(profile, providedStorage) {
  const campusKey = profile.institutionId.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(LEGACY_CAMPUS_CODES, campusKey)) return null;
  const code = LEGACY_CAMPUS_CODES[campusKey];
  const compare = value => value.normalize('NFKC').trim().toLowerCase();
  const validXP = value => typeof value === 'string' && /^\d{1,7}$/.test(value.trim()) && Number(value) <= MAX_LEGACY_XP ? Number(value) : null;
  try {
    const storage = providedStorage ?? globalThis.localStorage;
    if (!storage?.getItem) return null;
    const values = [validXP(storage.getItem(`ecoXP_${code}_${profile.name}`))];
    // Only read XP keys for the matching legacy campus and display name.
    for (let index = 0; index < Math.min(Number(storage.length) || 0, 5_000); index++) {
      const key = storage.key?.(index);
      const prefix = `ecoXP_${code}_`;
      if (typeof key === 'string' && key.startsWith(prefix) && compare(key.slice(prefix.length)) === compare(profile.name)) values.push(validXP(storage.getItem(key)));
    }
    const found = values.filter(value => value !== null);
    return found.length ? Math.max(...found) : null;
  } catch { return null; }
}
function preserveLegacyXP(profile, storage) {
  if (profile.legacyXP !== undefined) return;
  const xp = readLegacyXP(profile, storage);
  if (xp !== null) profile.legacyXP = xp;
}
export function addProfile(state, { name, institutionId, customInstitution } = {}, storage) {
  const profile = validateProfile({ id: id('profile'), name, institutionId, customInstitution });
  const compare = value => (value || '').normalize('NFKC').trim().toLowerCase();
  const existing = state.profiles.find(item => compare(item.name) === compare(profile.name) && compare(item.institutionId) === compare(profile.institutionId) && compare(item.customInstitution) === compare(profile.customInstitution));
  if (existing) { preserveLegacyXP(existing, storage); state.activeProfileId = existing.id; return existing; }
  if (state.profiles.length >= MAX_PROFILES) throw new Error('This device has reached its profile limit.');
  preserveLegacyXP(profile, storage);
  state.profiles.push(profile);
  state.activeProfileId = profile.id;
  return profile;
}

export function completeQuest(state, input = {}) {
  const eventId = requiredText(input.id, 'Completion ID');
  const existing = state.events.find(event => event.id === eventId);
  if (existing) return { event: existing, added: false, xpEarned: 0 };
  if (state.events.length >= MAX_EVENTS) throw new Error('Export your progress before recording more completions.');
  const profileId = input.profileId || state.activeProfileId;
  const profileIds = new Set(state.profiles.map(profile => profile.id));
  if (!profileIds.has(profileId)) throw new Error('Choose a student profile first.');
  const timestamp = input.timestamp === undefined ? new Date() : new Date(input.timestamp);
  if (!Number.isFinite(timestamp.getTime())) throw new Error('Invalid completion date.');
  const imageHash = cleanText(input.imageHash, 200);
  const recentDuplicate = imageHash && state.events.find(event => event.profileId === profileId && event.imageHash === imageHash && Math.abs(timestamp.getTime() - new Date(event.timestamp).getTime()) <= 10 * 60 * 1_000);
  if (recentDuplicate) return { event: recentDuplicate, added: false, xpEarned: 0 };
  const tutorialId = cleanText(input.tutorialId, 120);
  const repeatedTutorial = input.kind === 'upcycle' && tutorialId && state.events.find(event => event.profileId === profileId && event.kind === 'upcycle' && event.tutorialId === tutorialId && localDate(event.timestamp) === localDate(timestamp));
  if (repeatedTutorial) return { event: repeatedTutorial, added: false, xpEarned: 0 };
  if (!Array.isArray(input.components) || input.components.length > MAX_COMPONENTS) throw new Error('A completion needs 1–30 components.');
  const analysis = normalizeAnalysis({ components: input.components, source: input.source });
  if (analysis.unresolvedMaterials > 0) throw new Error('Confirm the material and disposal route, or explicitly keep each reusable item first.');
  const components = analysis.components.filter(item => item.route !== 'nonwaste');
  if (!components.length || components.some(item => !REAL_ROUTES.has(item.route))) throw new Error('Confirm a disposal route for each waste component first.');
  if (components.some(unresolvedMaterial)) throw new Error('Confirm the material and disposal route for each waste component first.');
  if (input.kind !== 'sort' && input.kind !== 'upcycle') throw new Error('Invalid quest type.');
  const mixedBonus = new Set(components.map(item => item.route)).size > 1 ? 5 : 0;
  const xp = (input.kind === 'upcycle' ? 40 : 20) + mixedBonus;
  const suppliedWeight = input.weightGrams !== undefined && input.weightGrams !== null && input.weightGrams !== '';
  const weightGrams = suppliedWeight ? Number(input.weightGrams) : components.reduce((sum, item) => sum + DEFAULT_MASS_GRAMS[item.route], 0);
  const event = validateEvent({ ...input, id: eventId, profileId, components, timestamp: timestamp.toISOString(), xp, weightGrams, weightSource: suppliedWeight ? 'user' : 'illustrative', imageHash }, profileIds);
  state.events.push(event);
  return { event, added: true, xpEarned: xp };
}

export function localDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function previousDate(day) {
  const [year, month, date] = day.split('-').map(Number);
  return localDate(new Date(year, month - 1, date - 1, 12));
}
function streakFor(events, now = new Date()) {
  const days = new Set(events.map(event => localDate(event.timestamp)));
  let cursor = localDate(now);
  if (!days.has(cursor)) cursor = previousDate(cursor);
  let streak = 0;
  while (days.has(cursor)) { streak++; cursor = previousDate(cursor); }
  return streak;
}
export function eventEstimates(event) {
  const components = event.components || [];
  const defaultsTotal = components.reduce((sum, item) => sum + (DEFAULT_MASS_GRAMS[item.route] || 0), 0);
  const weightGrams = Math.max(0, finiteNumber(event.weightGrams, defaultsTotal));
  let divertedGrams = 0, co2Kg = 0;
  for (const item of components) {
    const share = defaultsTotal ? (DEFAULT_MASS_GRAMS[item.route] || 0) / defaultsTotal : 0;
    const grams = weightGrams * share;
    const diverted = event.kind === 'upcycle' || ['organic', 'recycle', 'ewaste'].includes(item.route);
    if (diverted) divertedGrams += grams;
    co2Kg += grams / 1_000 * (ILLUSTRATIVE_CO2_FACTORS[item.route] || (event.kind === 'upcycle' ? 0.5 : 0));
  }
  return { estimatedKg: divertedGrams / 1_000, estimatedCo2Kg: co2Kg, recordedKg: weightGrams / 1_000 };
}
function statsFor(events, now) {
  const unique = [...new Map(events.map(event => [event.id, event])).values()];
  const stats = { xp: 0, quests: unique.length, items: 0, streak: streakFor(unique, now), estimatedKg: 0, estimatedCo2Kg: 0, recordedKg: 0, reportedWeightKg: 0, assumedWeightKg: 0, reportedDivertedKg: 0, assumedDivertedKg: 0, reportedCo2Kg: 0, assumedCo2Kg: 0, sortCount: 0, upcycleCount: 0, byRoute: Object.fromEntries(ROUTES.map(route => [route, 0])), measuredWeightCount: 0, illustrativeWeightCount: 0, events: unique };
  for (const event of unique) {
    stats.xp += event.xp;
    stats[event.kind === 'upcycle' ? 'upcycleCount' : 'sortCount']++;
    stats[event.weightSource === 'user' ? 'measuredWeightCount' : 'illustrativeWeightCount']++;
    stats.items += event.components.length;
    for (const item of event.components) stats.byRoute[item.route]++;
    const estimates = eventEstimates(event);
    stats.estimatedKg += estimates.estimatedKg;
    stats.estimatedCo2Kg += estimates.estimatedCo2Kg;
    stats.recordedKg += estimates.recordedKg;
    const weightPrefix = event.weightSource === 'user' ? 'reported' : 'assumed';
    stats[`${weightPrefix}WeightKg`] += estimates.recordedKg;
    stats[`${weightPrefix}DivertedKg`] += estimates.estimatedKg;
    stats[`${weightPrefix}Co2Kg`] += estimates.estimatedCo2Kg;
  }
  return stats;
}
export function personalStats(state, profileId = state.activeProfileId, now = new Date()) {
  const stats = statsFor(state.events.filter(event => event.profileId === profileId), now);
  const legacyXP = state.profiles.find(profile => profile.id === profileId)?.legacyXP || 0;
  return { ...stats, eventXP: stats.xp, legacyXP, xp: stats.xp + legacyXP };
}
function campusProfiles(state, institutionId, customInstitution) {
  const compare = value => cleanText(value, 160).normalize('NFKC').toLowerCase();
  return state.profiles.filter(profile => profile.institutionId === institutionId && (customInstitution === undefined || compare(profile.customInstitution) === compare(customInstitution)));
}
export function campusStats(state, institutionId, now = new Date(), customInstitution) {
  const profiles = campusProfiles(state, institutionId, customInstitution);
  const profileIds = new Set(profiles.map(profile => profile.id));
  const stats = statsFor(state.events.filter(event => profileIds.has(event.profileId)), now);
  return { ...stats, eventXP: stats.xp, students: profiles.length, contributingStudents: new Set(stats.events.map(event => event.profileId)).size, scope: 'this-device', selfReported: true };
}

export function campusContributions(state, institutionId, now = new Date(), customInstitution) {
  return campusProfiles(state, institutionId, customInstitution).map(profile => {
    const stats = statsFor(state.events.filter(event => event.profileId === profile.id), now);
    return { ...stats, profileId: profile.id, name: profile.name, institutionId: profile.institutionId, ...(profile.customInstitution ? { customInstitution: profile.customInstitution } : {}), eventXP: stats.xp, scope: 'this-device', selfReported: true };
  }).sort((a, b) => b.estimatedKg - a.estimatedKg || b.eventXP - a.eventXP || a.name.localeCompare(b.name));
}

export function campusSummaries(state, now = new Date()) {
  const groups = new Map();
  for (const profile of state.profiles) {
    const customInstitution = cleanText(profile.customInstitution, 160);
    const key = JSON.stringify([profile.institutionId, customInstitution.normalize('NFKC').toLowerCase()]);
    if (!groups.has(key)) groups.set(key, { institutionId: profile.institutionId, ...(customInstitution ? { customInstitution } : {}) });
  }
  return [...groups.values()].map(group => ({ ...group, ...campusStats(state, group.institutionId, now, group.customInstitution || ''), contributions: campusContributions(state, group.institutionId, now, group.customInstitution || '') }))
    .sort((a, b) => b.estimatedKg - a.estimatedKg || a.institutionId.localeCompare(b.institutionId) || (a.customInstitution || '').localeCompare(b.customInstitution || ''));
}
