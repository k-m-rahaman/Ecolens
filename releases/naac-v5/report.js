import { campusStats, campusContributions } from './core.js';

const normalizedName = value => String(value ?? '').trim().normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
const displayName = value => String(value ?? '').trim().replace(/\s+/g, ' ');

// Catalog entries are always visible. A campus without records has zero local
// activity; that does not claim that the real institution has diverted no waste.
export function institutionReportDirectory(state, catalog, now = new Date()) {
 const groups = new Map(), byId = new Map(), byName = new Map();
 for (const institution of catalog) {
  if (byId.has(institution.id)) continue;
  const group = { institutionId: institution.id, name: institution.name, type: institution.type, area: institution.area || '', url: institution.url || '', profiles: [] };
  const key = `catalog:${institution.id}`;
  groups.set(key, group); byId.set(institution.id, key);
  if (!byName.has(normalizedName(institution.name))) byName.set(normalizedName(institution.name), key);
 }
 for (const profile of state.profiles) {
  const name = displayName(profile.customInstitution) || displayName(profile.institutionId);
  let key = byId.get(profile.institutionId) || byName.get(normalizedName(name));
  if (!key) {
   key = `custom:${normalizedName(name)}`;
   if (!groups.has(key)) groups.set(key, { institutionId: profile.institutionId, customInstitution: name, name, type: 'custom', area: '', url: '', profiles: [] });
  }
  groups.get(key).profiles.push(profile);
 }
 return [...groups.values()].map(({ profiles, ...institution }) => {
  // Re-key only this group for the existing ledger helpers. This also combines
  // the same custom campus imported under different IDs without changing state.
  const scoped = { ...state, profiles: profiles.map(profile => ({ ...profile, institutionId: institution.institutionId, customInstitution: institution.customInstitution || '' })) };
  const stats = campusStats(scoped, institution.institutionId, now, institution.customInstitution || '');
  const contributions = campusContributions(scoped, institution.institutionId, now, institution.customInstitution || '');
  const hasRecords = stats.quests > 0;
  return { ...institution, reportKey: JSON.stringify([institution.institutionId, institution.customInstitution || '']), ...stats, contributions, hasRecords, recordStatus: hasRecords ? 'local-records' : 'no-local-records' };
 });
}

const csvCell = value => {
 const text = String(value ?? '');
 const safe = /^\s*[=+@\-\t\r]/.test(text) ? "'" + text : text;
 return '"' + safe.replaceAll('"', '""') + '"';
};
const csvNumber = value => Number(value || 0).toFixed(4);
const csvDocument = rows => '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');

// CSV exports are built from the same student rows shown in the campus report.
export function contributionsCSV(rows,{institutionName=()=>'',generatedAt=new Date().toISOString()}={}){
 const header=['Institution','Student','Completed quests','Items handled','Estimated landfill diversion kg','Estimated CO2 avoided kg','User-reported diverted kg','Assumed diverted kg','Earned activity XP','Scope','Confirmation','Generated at'];
 const records=rows.map(row=>[institutionName(row),row.name,row.quests,row.items,csvNumber(row.estimatedKg),csvNumber(row.estimatedCo2Kg),csvNumber(row.reportedDivertedKg),csvNumber(row.assumedDivertedKg),row.eventXP,'this browser','self-reported',generatedAt]);
 return csvDocument([header,...records]);
}

export function institutionSummaryCSV(rows, { generatedAt = new Date().toISOString() } = {}) {
 const header = ['Institution', 'Type', 'Area', 'Student profiles', 'Contributing students', 'Completed quests', 'Items handled', 'Estimated landfill diversion kg', 'Estimated CO2 avoided kg', 'User-reported diverted kg', 'Assumed diverted kg', 'Earned activity XP', 'Record status', 'Scope', 'Confirmation', 'Generated at'];
 const records = rows.map(row => [row.name, row.type, row.area, row.students, row.contributingStudents, row.quests, row.items, csvNumber(row.estimatedKg), csvNumber(row.estimatedCo2Kg), csvNumber(row.reportedDivertedKg), csvNumber(row.assumedDivertedKg), row.eventXP, row.hasRecords ? 'Local activity recorded' : 'No records in this browser', 'this browser', 'self-reported; estimates are not verified university totals', generatedAt]);
 return csvDocument([header, ...records]);
}
