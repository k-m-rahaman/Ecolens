import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, ROUTES, MAX_IMPORT_BYTES, loadAppState, persistState, addProfile, activeProfile,
  normalizeRoute, normalizeMaterial, normalizeAnalysis, manualAnalysis, completeQuest, personalStats, campusStats, campusContributions, campusSummaries,
  importState, exportState, localDate
} from './core.js';

function store(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), key: index => [...values.keys()][index] ?? null, get length() { return values.size; }, values };
}
function fixture() {
  const state = loadAppState(store());
  const profile = addProfile(state, { name: 'Asha', institutionId: 'jadavpur-university' });
  return { state, profile };
}
function completion(profileId, options = {}) {
  return { id: 'completion-1', profileId, components: [{ name: 'Bottle', route: 'recycle' }], source: 'manual', kind: 'sort', timestamp: '2026-10-12T12:00:00.000Z', ...options };
}

test('same-route multiple objects retain all instances and need no mixed-waste protocol', () => {
  const result = normalizeAnalysis({ source: 'local', components: [
    { name: 'Bottle', route: 'blue', confidence: 0.86, bbox: [1, 2, 30, 40] },
    { name: 'Bottle', route: 'recycle', confidence: 0.91, bbox: { x: 50, y: 2, w: 30, h: 40 } }
  ] });
  assert.equal(result.components.length, 2);
  assert.equal(result.mixed, false);
  assert.equal(result.uncertain, false);
  assert.deepEqual(result.components.map(c => c.route), ['recycle', 'recycle']);
  assert.deepEqual(result.components[0].bbox, { x: 1, y: 2, w: 30, h: 40 });
  assert.equal(normalizeAnalysis({ components: [{ name: 'Apple', route: 'organic' }, { name: 'Banana', route: 'organic' }] }).mixed, false);
});

test('public institution sharing has separate explicit consent and no credentials in its settings',()=>{
 const {state}=fixture();assert.equal(state.settings.shareInstitutionTotals,false);assert.equal(state.settings.publicReportEndpoint,'');
 state.settings.publicReportEndpoint='https://reports.example.test';state.settings.shareInstitutionTotals=true;
 const restored=importState(exportState(state));assert.equal(restored.settings.shareInstitutionTotals,true);assert.equal(restored.settings.publicReportEndpoint,'https://reports.example.test');
 state.settings.shareInstitutionTotals='true';assert.equal(importState(exportState(state)).settings.shareInstitutionTotals,false);
 for(const endpoint of ['https://user:secret@reports.example.test','https://reports.example.test?token=secret','https://reports.example.test/private','http://reports.example.test']){state.settings.publicReportEndpoint=endpoint;assert.throws(()=>exportState(state));}
});

test('mixed routing depends on disposal destination and excludes people/background', () => {
  const result = normalizeAnalysis({ components: [{ name: 'Bottle', route: 'recycle' }, { name: 'Person', route: 'organic' }] });
  assert.equal(result.mixed, false);
  assert.equal(result.components[1].route, 'nonwaste');
  assert.equal(normalizeAnalysis({ components: [{ name: 'Bottle', route: 'recycle' }, { name: 'Apple core', route: 'organic' }] }).mixed, true);
});

test('unknown waste never silently defaults to recycling; low confidence asks for confirmation', () => {
  const unknown = normalizeAnalysis({ components: [{ name: 'Unidentified object', category: 'unrecognized' }] });
  assert.equal(unknown.components[0].route, 'unknown');
  assert.equal(unknown.uncertain, true);
  assert.equal(unknown.mixed, false);
  assert.ok(unknown.warnings.length > 0);
  assert.equal(normalizeAnalysis({ components: [{ name: 'Bottle', route: 'recycle', confidence: 0.4 }] }).uncertain, true);
  assert.equal(normalizeAnalysis({ components: [{ class: 'person' }] }).uncertain, true);
  assert.equal(normalizeAnalysis({ components: [] }).uncertain, true);
});

test('cloud uncertainty is honored until each waste component has explicit user confirmation', () => {
  const raw = { source: 'online', uncertain: true, components: [{ name: 'Bottle', route: 'recycle', confidence: 0.9 }, { name: 'Paper', route: 'recycle', confidence: 0.8 }] };
  assert.equal(normalizeAnalysis(raw).uncertain, true);
  raw.components[0].confirmedByUser = true;
  assert.equal(normalizeAnalysis(raw).uncertain, true);
  raw.components[1].confirmedByUser = true;
  assert.equal(normalizeAnalysis(raw).uncertain, false);
  raw.components[1].confidence = 0.3;
  assert.equal(normalizeAnalysis(raw).uncertain, false);
  raw.components[1].route = 'unknown';
  assert.equal(normalizeAnalysis(raw).uncertain, true);
});

test('manual selection uses canonical routes and preserves confirmed user input', () => {
  const result = manualAnalysis('Red', 'Old battery');
  assert.equal(result.source, 'manual');
  assert.equal(result.components[0].route, 'ewaste');
  assert.equal(result.uncertain, false);
  for (const route of ROUTES) assert.equal(normalizeRoute(route), route);
  assert.equal(normalizeRoute('__proto__'), 'unknown');
  assert.equal(normalizeRoute('constructor'), 'unknown');
});

test('manual confirmation permits discarded furniture and survives completion and backups', () => {
  const inferred = normalizeAnalysis({ source: 'local', components: [{ name: 'Chair', route: 'residual' }] });
  assert.equal(inferred.components[0].route, 'nonwaste');
  const confirmed = manualAnalysis('residual', 'Chair');
  assert.equal(confirmed.components[0].route, 'residual');
  assert.equal(confirmed.components[0].confirmedByUser, true);
  const { state, profile } = fixture();
  const result = completeQuest(state, completion(profile.id, { components: confirmed.components }));
  assert.equal(result.added, true);
  assert.equal(result.event.components[0].route, 'residual');
  assert.equal(importState(exportState(state)).events[0].components[0].route, 'residual');
  assert.equal(manualAnalysis('residual', 'Person').components[0].route, 'nonwaste');
});

test('cloud image-upload consent is off by default and only an explicit boolean enables it', () => {
  const { state } = fixture();
  assert.equal(state.settings.cloudConsent, false);
  state.settings.cloudConsent = true;
  assert.equal(importState(exportState(state)).settings.cloudConsent, true);
  state.settings.cloudConsent = 'true';
  assert.equal(importState(exportState(state)).settings.cloudConsent, false);
  const older = JSON.parse(exportState(state));
  delete older.settings.cloudConsent;
  assert.equal(importState(JSON.stringify(older)).settings.cloudConsent, false);
});

test('theme preference defaults to system and survives save, export and restore', () => {
  const device = store();
  const state = loadAppState(device);
  assert.equal(state.settings.theme, 'system');
  for (const theme of ['light', 'dark', 'system']) {
    state.settings.theme = theme;
    persistState(state, device);
    assert.equal(loadAppState(device).settings.theme, theme);
    assert.equal(importState(exportState(state)).settings.theme, theme);
  }
  for (const invalid of [undefined, 'purple', null, true, '__proto__']) {
    state.settings.theme = invalid;
    assert.equal(importState(exportState(state)).settings.theme, 'system');
  }
});

test('corrections may mark unknown or non-waste without corrupting device persistence', () => {
  const { state, profile } = fixture();
  state.corrections.push({ id: 'uncertain-item', name: 'Wrapper', route: 'unknown', profileId: profile.id, timestamp: '2026-10-12T12:00:00.000Z' });
  state.corrections.push({ id: 'background-item', name: 'Table', route: 'nonwaste', profileId: profile.id, timestamp: '2026-10-12T12:00:00.000Z' });
  const storage = store();
  persistState(state, storage);
  assert.deepEqual(loadAppState(storage).corrections, state.corrections);
  state.corrections.push({ id: 'invalid-route', name: 'Item', route: 'invented-route' });
  assert.throws(() => exportState(state), /Invalid correction route/);
});

test('creating and selecting a profile never grants XP or disposal impact', () => {
  const { state, profile } = fixture();
  assert.equal(activeProfile(state).id, profile.id);
  const stats = personalStats(state, profile.id);
  assert.equal(stats.xp, 0);
  assert.equal(stats.quests, 0);
  assert.equal(stats.estimatedKg, 0);
  assert.equal(stats.estimatedCo2Kg, 0);
  assert.equal(state.events.length, 0);
  assert.equal(campusStats(state, profile.institutionId).estimatedKg, 0);
});

test('selecting the same local name and institution reuses progress without creating another profile', () => {
  const { state, profile } = fixture();
  completeQuest(state, completion(profile.id));
  addProfile(state, { name: 'Someone else', institutionId: 'calcutta-university' });
  const selected = addProfile(state, { name: '  ASHA  ', institutionId: 'JADAVPUR-UNIVERSITY' });
  assert.equal(selected.id, profile.id);
  assert.equal(state.activeProfileId, profile.id);
  assert.equal(state.profiles.length, 2);
  assert.equal(personalStats(state).xp, 20);
  assert.equal(state.events.length, 1);
  const campusTwo = addProfile(state, { name: 'Asha', institutionId: 'calcutta-university' });
  assert.notEqual(campusTwo.id, profile.id);
  const customOne = addProfile(state, { name: 'Asha', institutionId: 'OTHER', customInstitution: 'Community School' });
  const customSame = addProfile(state, { name: 'asha', institutionId: 'other', customInstitution: 'community school' });
  assert.equal(customSame.id, customOne.id);
  const customTwo = addProfile(state, { name: 'Asha', institutionId: 'OTHER', customInstitution: 'Different School' });
  assert.notEqual(customTwo.id, customOne.id);
});

test('quest completion is exactly once by ID and duplicated image fingerprint within ten minutes', () => {
  const { state, profile } = fixture();
  const first = completeQuest(state, completion(profile.id, { imageHash: 'image-a' }));
  assert.equal(first.added, true);
  assert.equal(first.xpEarned, 20);
  const sameId = completeQuest(state, completion(profile.id, { imageHash: 'different-image' }));
  assert.equal(sameId.added, false);
  assert.equal(sameId.xpEarned, 0);
  const sameImage = completeQuest(state, completion(profile.id, { id: 'completion-2', imageHash: 'image-a', timestamp: '2026-10-12T12:10:00.000Z' }));
  assert.equal(sameImage.added, false);
  const expired = completeQuest(state, completion(profile.id, { id: 'completion-3', imageHash: 'image-a', timestamp: '2026-10-12T12:10:01.000Z' }));
  assert.equal(expired.added, true);
  assert.equal(state.events.length, 2);
  assert.equal(personalStats(state, profile.id).xp, 40);
});

test('each upcycling tutorial rewards a profile only once per local calendar day', () => {
  const { state, profile } = fixture();
  const peer = addProfile(state, { name: 'Rahul', institutionId: profile.institutionId });
  const day = (value, hour) => new Date(2026, 9, value, hour).toISOString();
  const tutorial = { kind: 'upcycle', tutorialId: 'bottle-planter', timestamp: day(12, 10) };
  const first = completeQuest(state, completion(profile.id, { id: 'first-tutorial', ...tutorial }));
  assert.equal(first.added, true);
  assert.equal(first.xpEarned, 40);
  const sameDay = completeQuest(state, completion(profile.id, { id: 'repeated-tutorial', ...tutorial, timestamp: day(12, 20) }));
  assert.equal(sameDay.added, false);
  assert.equal(sameDay.xpEarned, 0);
  assert.equal(sameDay.event.id, 'first-tutorial');
  assert.equal(completeQuest(state, completion(profile.id, { id: 'next-day-tutorial', ...tutorial, timestamp: day(13, 10) })).added, true);
  assert.equal(completeQuest(state, completion(peer.id, { id: 'peer-tutorial', ...tutorial })).added, true);
  assert.equal(completeQuest(state, completion(profile.id, { id: 'different-tutorial', ...tutorial, tutorialId: 'paper-seed-pots' })).added, true);
  assert.equal(personalStats(state, profile.id).xp, 120);
});

test('unknown-only and background-only scans cannot earn completion rewards', () => {
  const { state, profile } = fixture();
  assert.throws(() => completeQuest(state, completion(profile.id, { components: [{ name: 'Bag', route: 'unknown' }] })), /Confirm/);
  assert.throws(() => completeQuest(state, completion(profile.id, { components: [{ name: 'Person', route: 'nonwaste' }] })), /Confirm/);
  assert.equal(state.events.length, 0);
});

test('person detections are omitted from completion totals and sorting estimates', () => {
  const { state, profile } = fixture();
  const { event } = completeQuest(state, completion(profile.id, { components: [{ name: 'Bottle', route: 'recycle' }, { name: 'Person', route: 'nonwaste' }] }));
  assert.equal(event.components.length, 1);
  assert.equal(event.weightSource, 'illustrative');
  assert.equal(event.weightGrams, 25);
  const stats = personalStats(state, profile.id);
  assert.equal(stats.estimatedKg, 0.025);
  assert.equal(stats.byRoute.nonwaste, 0);
  assert.equal(stats.byRoute.recycle, 1);
});

test('lifetime quests continue beyond five and campus totals are distinct from personal totals', () => {
  const { state, profile } = fixture();
  const peer = addProfile(state, { name: 'Rahul', institutionId: profile.institutionId });
  const otherCampus = addProfile(state, { name: 'Maya', institutionId: 'calcutta-university' });
  for (let i = 0; i < 8; i++) completeQuest(state, completion(profile.id, { id: `sort-${i}` }));
  completeQuest(state, completion(peer.id, { id: 'peer-upcycle', kind: 'upcycle', tutorialId: 'bottle-planter' }));
  completeQuest(state, completion(otherCampus.id, { id: 'other-sort' }));
  assert.equal(personalStats(state, profile.id).quests, 8);
  assert.equal(personalStats(state, profile.id).xp, 160);
  const campus = campusStats(state, profile.institutionId);
  assert.equal(campus.quests, 9);
  assert.equal(campus.upcycleCount, 1);
  assert.equal(campus.students, 2);
  assert.equal(campus.scope, 'this-device');
  assert.equal(campus.selfReported, true);
});

test('daily streak uses real local calendar days and does not increase twice on one day', () => {
  const { state, profile } = fixture();
  const day = value => new Date(2026, 9, value, 12).toISOString();
  for (const value of [9, 10, 10, 11, 12]) completeQuest(state, completion(profile.id, { id: `day-${value}-${state.events.length}`, timestamp: day(value) }));
  assert.equal(personalStats(state, profile.id, new Date(2026, 9, 12, 12)).streak, 4);
  assert.equal(personalStats(state, profile.id, new Date(2026, 9, 13, 12)).streak, 4);
  assert.equal(personalStats(state, profile.id, new Date(2026, 9, 14, 12)).streak, 0);
  assert.equal(localDate(new Date(2026, 9, 12, 12)), '2026-10-12');
});

test('user-entered weight remains separately labelled and residual waste is not landfill diverted', () => {
  const { state, profile } = fixture();
  const result = completeQuest(state, completion(profile.id, { components: [{ name: 'Dirty wrapper', route: 'residual' }], weightGrams: 50 }));
  assert.equal(result.event.weightSource, 'user');
  assert.equal(result.event.selfReported, true);
  const stats = personalStats(state, profile.id);
  assert.equal(stats.recordedKg, 0.05);
  assert.equal(stats.estimatedKg, 0);
  assert.equal(stats.estimatedCo2Kg, 0);
  assert.equal(stats.measuredWeightCount, 1);
});

test('export/import validates a plain snapshot, keeps language and does not write storage', () => {
  const { state, profile } = fixture();
  state.settings.language = 'bn';
  state.settings.mode = 'online';
  state.settings.endpoint = 'https://example.edu/vision';
  completeQuest(state, completion(profile.id));
  state.corrections.push({ id: 'correction-1', name: 'Paper cup', route: 'residual', originalRoute: 'recycle', profileId: profile.id, timestamp: '2026-10-12T12:00:00.000Z' });
  const restored = importState(exportState(state));
  assert.deepEqual(restored, state);
  const storage = store();
  persistState(state, storage);
  assert.deepEqual(loadAppState(storage), state);
  assert.equal(storage.values.size, 1);
  assert.ok(storage.values.has(STORAGE_KEY));
});

test('legacy counters and corrupt backups stay untouched and fabricate no disposal records', () => {
  const storage = store({ ecoXP_Asha: '900', ecoHistory_Asha: '["login"]', ecoImpact_Asha: '7', [STORAGE_KEY]: '{broken' });
  const state = loadAppState(storage);
  assert.equal(state.events.length, 0);
  assert.equal(state.profiles.length, 0);
  assert.equal(storage.getItem('ecoXP_Asha'), '900');
  assert.equal(storage.getItem(STORAGE_KEY), '{broken');
});

test('matching legacy-campus XP is preserved only in personal progress without inventing activity or impact', () => {
  const storage = store({ ecoXP_JU_Asha: '900', ecoHistory_JU_Asha: '["old quest"]', ecoImpact_JU_Asha: '{"divertedKg":7}', ecoXP_BWU_Asha: '200', ecoXP_TIU_Asha: '300' });
  const state = loadAppState(storage);
  const profile = addProfile(state, { name: 'asha', institutionId: 'jadavpur' }, storage);
  assert.equal(profile.legacyXP, 900);
  const personal = personalStats(state, profile.id);
  assert.equal(personal.xp, 900);
  assert.equal(personal.legacyXP, 900);
  assert.equal(personal.eventXP, 0);
  assert.equal(personal.quests, 0);
  assert.equal(personal.streak, 0);
  assert.equal(personal.estimatedKg, 0);
  assert.equal(personal.estimatedCo2Kg, 0);
  assert.equal(campusStats(state, 'jadavpur').xp, 0);
  completeQuest(state, completion(profile.id));
  assert.equal(personalStats(state, profile.id).xp, 920);
  assert.equal(campusStats(state, 'jadavpur').xp, 20);
  assert.equal(importState(exportState(state)).profiles[0].legacyXP, 900);
  assert.equal(storage.getItem('ecoHistory_JU_Asha'), '["old quest"]');
  assert.equal(storage.getItem('ecoImpact_JU_Asha'), '{"divertedKg":7}');
  assert.equal(storage.values.size, 5);
  profile.legacyXP = 0;
  addProfile(state, { name: 'Asha', institutionId: 'jadavpur' }, storage);
  assert.equal(profile.legacyXP, 0);
});

test('legacy migration is limited to three known campus aliases and bounded integer XP', () => {
  const storage = store({ ecoXP_BWU_Asha: 'not-a-number', ecoXP_JU_Rahul: '-20', ecoXP_TIU_Maya: '1000001', ecoXP_OTHER_Asha: '500', ecoXP_BWU_Rahul: '200' });
  const state = loadAppState(storage);
  for (const item of [{ name: 'Asha', institutionId: 'brainware' }, { name: 'Rahul', institutionId: 'jadavpur' }, { name: 'Maya', institutionId: 'techno-india' }, { name: 'Asha', institutionId: 'OTHER', customInstitution: 'Community school' }]) {
    const profile = addProfile(state, item, storage);
    assert.equal(profile.legacyXP, undefined);
  }
  assert.equal(addProfile(state, { name: 'Rahul', institutionId: 'brainware' }, storage).legacyXP, 200);
  assert.equal(state.events.length, 0);
  const invalid = JSON.parse(exportState(state));
  invalid.profiles[0].legacyXP = 1_000_001;
  assert.throws(() => importState(JSON.stringify(invalid)), /legacy XP/);
});

test('backup size, record limits, references and endpoint protocols are validated', () => {
  const { state, profile } = fixture();
  assert.throws(() => importState(' '.repeat(MAX_IMPORT_BYTES + 1)), /8 MB/);
  assert.throws(() => importState('not JSON'), /valid JSON/);
  assert.throws(() => importState(JSON.stringify({ ...state, version: 1 })), /version 2/);
  assert.throws(() => importState(JSON.stringify({ ...state, profiles: Array(201).fill(profile) })), /too many profiles/);
  assert.throws(() => importState(JSON.stringify({ ...state, events: Array(10_001).fill({}) })), /too many completion/);
  assert.throws(() => importState(JSON.stringify({ ...state, activeProfileId: 'missing' })), /does not exist/);
  assert.throws(() => addProfile(state, { name: 'A'.repeat(81), institutionId: profile.institutionId }), /too long/);
  assert.throws(() => importState(JSON.stringify({ ...state, settings: { endpoint: 'javascript:alert(1)' } })), /HTTPS/);
  assert.throws(() => importState(JSON.stringify({ ...state, settings: { endpoint: 'https://user:secret@example.edu' } })), /credentials/);
  assert.throws(() => completeQuest(state, completion(profile.id, { components: Array(31).fill({ name: 'Bottle', route: 'recycle' }) })), /1–30/);
  assert.throws(() => completeQuest(state, completion(profile.id, { weightGrams: -1 })), /Weight/);
});

test('untrusted JSON remains plain whitelisted data without executable or prototype keys', () => {
  const { state } = fixture();
  const raw = JSON.parse(exportState(state));
  raw.profiles[0].name = '<img src=x onerror=alert(1)>';
  raw.profiles[0].html = '<script>alert(1)</script>';
  raw.profiles[0].__proto__ = { polluted: true };
  raw.execute = 'alert(1)';
  raw.settings.__proto__ = { polluted: true };
  const imported = importState(JSON.stringify(raw));
  assert.equal(imported.profiles[0].name, '<img src=x onerror=alert(1)>');
  assert.equal(Object.hasOwn(imported.profiles[0], 'html'), false);
  assert.equal(Object.hasOwn(imported.profiles[0], '__proto__'), false);
  assert.equal(Object.hasOwn(imported, 'execute'), false);
  assert.equal({}.polluted, undefined);
});

test('several materials in one bin are identified separately without requiring different bins', () => {
  const result = normalizeAnalysis({ components: [
    { name: 'Metal can', material: 'aluminium', route: 'recycle' },
    { name: 'Glass jar', material: 'glass', route: 'recycle' },
    { name: 'Person', material: 'organic', route: 'organic' }
  ] });
  assert.equal(result.mixedMaterials, true);
  assert.equal(result.multiItem, true);
  assert.equal(result.mixed, false);
  assert.deepEqual(result.materialGroups.map(group => [group.material, group.count]), [['metal', 1], ['glass', 1]]);
  assert.deepEqual(result.destinationGroups.map(group => [group.route, group.count]), [['recycle', 2]]);
  assert.equal(normalizeAnalysis({ components: [{ name: 'Paper 1', material: 'paper', route: 'recycle' }, { name: 'Paper 2', material: 'paper', route: 'recycle' }] }).mixedMaterials, false);
  assert.equal(normalizeMaterial('__proto__'), 'unknown');
  assert.equal(normalizeMaterial('stainless steel'), 'metal');
});

test('route confirmation alone cannot turn a visual material guess into confirmed material', () => {
  const component = { name: 'Bottle', material: 'metal', route: 'recycle', confidence: 0.99, requiresMaterialConfirmation: true, confirmedByUser: true, candidateMaterials: ['metal', 'plastic', 'glass', '__proto__'], materialCandidates: [{ material: 'steel', confidence: 0.8 }, { material: 'glass', confidence: 'invalid' }] };
  for (const source of ['local', 'online', 'manual', 'confirmed']) {
    const result = normalizeAnalysis({ source, components: [component] });
    assert.equal(result.uncertain, true);
    assert.equal(result.unresolvedMaterials, 1);
    assert.equal(result.components[0].material, 'metal');
    assert.equal(result.components[0].route, 'recycle');
    assert.equal(result.components[0].requiresMaterialConfirmation, true);
    assert.deepEqual(result.components[0].candidateMaterials, ['metal', 'plastic', 'glass']);
    assert.deepEqual(result.components[0].materialCandidates, [{ material: 'metal', confidence: 0.8 }]);
  }
  const { state, profile } = fixture();
  assert.throws(() => completeQuest(state, completion(profile.id, { components: [component] })), /Confirm the material/);
  component.materialConfirmedByUser = true;
  const resolved = normalizeAnalysis({ source: 'local', uncertain: true, components: [component] });
  assert.equal(resolved.uncertain, false);
  assert.equal(resolved.unresolvedMaterials, 0);
  assert.equal(completeQuest(state, completion(profile.id, { components: resolved.components, source: 'local' })).added, true);
  assert.equal(importState(exportState(state)).events[0].components[0].materialConfirmedByUser, true);
  assert.equal(normalizeAnalysis(resolved).components[0].requiresMaterialConfirmation, true);
});

test('material confirmation requires an actual material and a confirmed disposal route', () => {
  const base = { name: 'Bottle', requiresMaterialConfirmation: true, materialConfirmedByUser: true, confirmedByUser: true };
  for (const component of [
    { ...base, material: 'unknown', route: 'recycle' },
    { ...base, material: 'mixed', route: 'recycle' },
    { ...base, material: 'metal', route: 'unknown' },
    { ...base, material: 'metal', route: 'recycle', confirmedByUser: false }
  ]) {
    const result = normalizeAnalysis({ source: 'local', components: [component] });
    assert.equal(result.uncertain, true);
    assert.equal(result.components[0].materialConfirmedByUser, undefined);
  }
  for (const material of ['rigid plastic', 'soft plastic', 'paper', 'lined paper', 'cardboard', 'organic', 'other']) {
    assert.equal(normalizeAnalysis({ components: [{ ...base, material, route: 'recycle' }] }).uncertain, false);
  }
});

test('a reusable container is excluded from waste and rewards until declared discarded', () => {
  const component = { name: 'Metal bottle', material: 'metal', route: 'recycle', reusable: true, requiresMaterialConfirmation: true, confirmedByUser: true, materialConfirmedByUser: true };
  const retained = normalizeAnalysis({ source: 'manual', components: [component] });
  assert.equal(retained.components[0].route, 'nonwaste');
  assert.equal(retained.components[0].reusable, true);
  const { state, profile } = fixture();
  assert.throws(() => completeQuest(state, completion(profile.id, { components: retained.components })), /Confirm/);
  const discarded = normalizeAnalysis({ source: 'local', components: [{ ...component, discardedByUser: true }] });
  assert.equal(discarded.components[0].route, 'recycle');
  assert.equal(discarded.uncertain, false);
  const event = completeQuest(state, completion(profile.id, { components: discarded.components })).event;
  assert.equal(event.components[0].discardedByUser, true);
  assert.equal(event.weightGrams, 25);
  assert.equal(importState(exportState(state)).events[0].components[0].reusable, true);
});

test('multi-item recognition still lists reusable containers without treating them as discarded mass', () => {
  const scene = normalizeAnalysis({ components: [
    { name: 'Bottle 1', material: 'unknown', route: 'unknown', reusable: true, requiresMaterialConfirmation: true },
    { name: 'Bottle 2', material: 'unknown', route: 'unknown', reusable: true, requiresMaterialConfirmation: true },
    { name: 'Person', material: 'organic', route: 'nonwaste' }
  ] });
  assert.equal(scene.multiItem, true);
  assert.equal(scene.identifiedItemCount, 2);
  assert.equal(scene.reusableItemCount, 2);
  assert.equal(scene.wasteItemCount, 0);
  assert.equal(scene.mixed, false);
  assert.equal(scene.materialGroups[0].count, 2);
  assert.deepEqual(scene.destinationGroups, []);
});

test('explicit keep choice survives repeated normalization and correction backups without impact', () => {
  const candidate = { name: 'Metal bottle', material: 'metal', route: 'recycle', reusable: true, requiresMaterialConfirmation: true, materialConfirmedByUser: true, confirmedByUser: true };
  assert.equal(Object.hasOwn(normalizeAnalysis({ components: [candidate] }).components[0], 'discardedByUser'), false);
  let kept = normalizeAnalysis({ components: [{ ...candidate, discardedByUser: false }] });
  for (let pass = 0; pass < 3; pass++) {
    assert.equal(kept.components[0].discardedByUser, false);
    assert.equal(kept.components[0].route, 'nonwaste');
    assert.equal(kept.components[0].materialConfirmedByUser, undefined);
    kept = normalizeAnalysis(kept);
  }
  const { state, profile } = fixture();
  assert.throws(() => completeQuest(state, completion(profile.id, { components: kept.components })), /Confirm/);
  state.corrections.push({ id: 'keep-bottle', name: candidate.name, profileId: profile.id, route: 'nonwaste', material: 'metal', requiresMaterialConfirmation: true, reusable: true, discardedByUser: false, timestamp: '2026-10-12T12:00:00.000Z' });
  const restored = importState(exportState(state));
  assert.equal(restored.corrections[0].discardedByUser, false);
  assert.equal(restored.events.length, 0);
  assert.equal(campusStats(restored, profile.institutionId).estimatedKg, 0);
  assert.equal(personalStats(restored, profile.id).xp, 0);
  const mixed = completeQuest(state, completion(profile.id, { components: [...kept.components, { name: 'Paper', material: 'paper', route: 'recycle' }] }));
  assert.equal(mixed.event.components.length, 1);
  assert.equal(mixed.event.components[0].name, 'Paper');
  assert.equal(mixed.event.weightGrams, 25);
  assert.equal(campusStats(state, profile.institutionId).items, 1);
});

test('mixed-scene completion cannot silently omit an undecided reusable container', () => {
  const components = [
    { name: 'Banana peel', material: 'organic', route: 'organic', confirmedByUser: true },
    { name: 'Paper', material: 'paper', route: 'recycle', confirmedByUser: true },
    { name: 'Bottle', material: 'unknown', route: 'unknown', reusable: true, requiresMaterialConfirmation: true }
  ];
  let scene = normalizeAnalysis({ source: 'local', components });
  assert.equal(scene.unresolvedMaterials, 1);
  assert.equal(scene.uncertain, true);
  assert.equal(scene.wasteItemCount, 2);
  const { state, profile } = fixture();
  assert.throws(() => completeQuest(state, completion(profile.id, { components: scene.components, source: 'local' })), /explicitly keep/);
  assert.equal(state.events.length, 0);
  scene.components[2].discardedByUser = false;
  scene = normalizeAnalysis(scene);
  assert.equal(scene.unresolvedMaterials, 0);
  assert.equal(scene.uncertain, false);
  const result = completeQuest(state, completion(profile.id, { components: scene.components, source: 'local' }));
  assert.equal(result.event.components.length, 2);
  assert.equal(result.event.weightGrams, 105);
  assert.equal(personalStats(state, profile.id).items, 2);
  assert.equal(result.xpEarned, 25);
});

test('material corrections preserve explicit confirmation and disposal choice in backups', () => {
  const { state, profile } = fixture();
  state.corrections.push({ id: 'metal-correction', name: 'Bottle', route: 'recycle', originalRoute: 'unknown', material: 'metal', originalMaterial: 'unknown', requiresMaterialConfirmation: true, confirmedByUser: true, materialConfirmedByUser: true, reusable: true, discardedByUser: true, profileId: profile.id, timestamp: '2026-10-12T12:00:00.000Z' });
  assert.deepEqual(importState(exportState(state)).corrections[0], state.corrections[0]);
});

test('single-item and mixed-scene preferences persist without trusting other values', () => {
  const { state } = fixture();
  assert.equal(state.settings.scanScene, 'single');
  state.settings.scanScene = 'group';
  assert.equal(importState(exportState(state)).settings.scanScene, 'group');
  for (const invalid of ['mixed', true, null, undefined]) {
    state.settings.scanScene = invalid;
    assert.equal(importState(exportState(state)).settings.scanScene, 'single');
  }
});

test('student contributions filter campus events and split reported and assumed impact', () => {
  const { state, profile } = fixture();
  profile.legacyXP = 900;
  const peer = addProfile(state, { name: 'Rahul', institutionId: profile.institutionId });
  const inactive = addProfile(state, { name: 'New student', institutionId: profile.institutionId });
  const other = addProfile(state, { name: 'Maya', institutionId: 'calcutta-university' });
  const first = completion(profile.id, { id: 'reported', weightGrams: 200, imageHash: 'reported-bottle' });
  completeQuest(state, first);
  assert.equal(completeQuest(state, { ...first, id: 'duplicate-image' }).added, false);
  completeQuest(state, completion(profile.id, { id: 'assumed', components: [{ name: 'Apple core', route: 'organic' }] }));
  completeQuest(state, completion(peer.id, { id: 'residual', weightGrams: 40, components: [{ name: 'Wrapper', route: 'residual' }] }));
  completeQuest(state, completion(other.id, { id: 'elsewhere', weightGrams: 900 }));
  const rows = campusContributions(state, profile.institutionId);
  assert.equal(rows.length, 3);
  assert.equal(rows.some(row => row.profileId === other.id), false);
  const student = rows.find(row => row.profileId === profile.id);
  assert.equal(student.name, 'Asha');
  assert.equal(student.items, 2);
  assert.equal(student.quests, 2);
  assert.equal(student.eventXP, 40);
  assert.equal(student.xp, 40);
  assert.equal(student.reportedWeightKg, 0.2);
  assert.equal(student.assumedWeightKg, 0.08);
  assert.equal(student.reportedDivertedKg, 0.2);
  assert.equal(student.assumedDivertedKg, 0.08);
  assert.equal(student.scope, 'this-device');
  assert.equal(student.selfReported, true);
  assert.equal(rows.find(row => row.profileId === peer.id).estimatedKg, 0);
  assert.equal(rows.find(row => row.profileId === inactive.id).quests, 0);
  const campus = campusStats(state, profile.institutionId);
  for (const field of ['quests', 'items', 'eventXP', 'estimatedKg', 'estimatedCo2Kg', 'recordedKg', 'reportedWeightKg', 'assumedWeightKg', 'reportedDivertedKg', 'assumedDivertedKg']) {
    assert.ok(Math.abs(rows.reduce((sum, row) => sum + row[field], 0) - campus[field]) < 1e-12, field);
  }
  assert.equal(campus.students, 3);
  assert.equal(campus.contributingStudents, 2);
  assert.equal(campus.estimatedKg, 0.28);
});

test('campus summaries keep different custom institutions separate and sum the same ledger', () => {
  const { state, profile } = fixture();
  const one = addProfile(state, { name: 'Asha', institutionId: 'OTHER', customInstitution: 'Community school' });
  const peer = addProfile(state, { name: 'Rahul', institutionId: 'OTHER', customInstitution: 'COMMUNITY SCHOOL' });
  const two = addProfile(state, { name: 'Maya', institutionId: 'OTHER', customInstitution: 'Different school' });
  completeQuest(state, completion(profile.id, { id: 'main-campus' }));
  completeQuest(state, completion(one.id, { id: 'custom-one' }));
  completeQuest(state, completion(peer.id, { id: 'custom-peer' }));
  completeQuest(state, completion(two.id, { id: 'custom-two' }));
  const summaries = campusSummaries(state);
  assert.equal(summaries.length, 3);
  const community = summaries.find(item => item.customInstitution === 'Community school');
  assert.equal(community.students, 2);
  assert.equal(community.contributions.length, 2);
  assert.equal(community.estimatedKg, 0.05);
  assert.equal(campusContributions(state, 'OTHER', new Date(), 'Community school').length, 2);
  assert.equal(campusStats(state, 'OTHER').students, 3);
  assert.equal(summaries.reduce((sum, campus) => sum + campus.quests, 0), state.events.length);
});
