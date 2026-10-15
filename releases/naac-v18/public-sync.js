/* Public sharing sends institution aggregates only, after a separate opt-in. */
import { INSTITUTIONS } from './data.js';
import { institutionReportDirectory } from './report.js';

export const PUBLIC_IDENTITY_KEY = 'ecolens-naac-installation-secret-v1';
export const PUBLIC_REVISION_KEY = 'ecolens-naac-installation-revision-v1';
export const PUBLIC_REMOVALS_KEY = 'ecolens-naac-pending-removals-v1';
export const PUBLIC_SYNC_TIMEOUT_MS = 8_000;
const FIELDS = ['contributingProfiles', 'completedQuests', 'itemsHandled', 'estimatedKg', 'estimatedCo2Kg', 'reportedDivertedKg', 'assumedDivertedKg'];
const KNOWN_INSTITUTIONS = new Set(INSTITUTIONS.map(row => row.id));
const ERRORS = {
  INVALID_ENDPOINT: 'Enter an HTTPS public report address, or a localhost address for testing.',
  INVALID_SNAPSHOT: 'These institution totals cannot be shared. Check the saved records.',
  IDENTITY_UNAVAILABLE: 'This browser cannot save the anonymous sharing identity.',
  CRYPTO_UNAVAILABLE: 'Secure anonymous sharing is unavailable in this browser.',
  PUBLIC_TIMEOUT: 'The public report did not respond in time. Your personal records remain saved.',
  PUBLIC_NETWORK: 'The public report is unavailable. Your personal records remain saved.',
  PUBLIC_RESPONSE: 'The public report returned an unexpected response.',
  REQUEST_CANCELLED: 'Public sharing was cancelled.',
  SHARING_DISABLED: 'Public NAAC sharing has not been configured.',
  ORIGIN_DENIED: 'This website cannot publish to this report.',
  INVALID_TOKEN: 'The anonymous sharing identity was not accepted.',
  RATE_LIMIT: 'Report publishing is temporarily limited. Try again later.',
  STORAGE_UNAVAILABLE: 'Shared reporting is temporarily unavailable.'
};
function syncError(code) { const error = new Error(ERRORS[code] || ERRORS.PUBLIC_NETWORK); error.code = code; return error; }
function checkAbort(signal) { if (signal?.aborted) throw syncError('REQUEST_CANCELLED'); }
const round = value => Math.round(value * 1_000_000) / 1_000_000;

export function buildPublicSnapshot(state, catalog = INSTITUTIONS) {
  const directory = institutionReportDirectory(state, catalog.filter(row => KNOWN_INSTITUTIONS.has(row.id)));
  const institutions = directory.filter(row => KNOWN_INSTITUTIONS.has(row.institutionId) && row.type !== 'custom' && row.hasRecords).map(row => {
    // Explicit construction prevents future private ledger fields from escaping.
    const result = {
      institutionId: row.institutionId,
      contributingProfiles: row.contributingStudents,
      completedQuests: row.quests,
      itemsHandled: row.items,
      estimatedKg: round(row.estimatedKg),
      estimatedCo2Kg: round(row.estimatedCo2Kg),
      reportedDivertedKg: round(row.reportedDivertedKg),
      assumedDivertedKg: round(row.assumedDivertedKg)
    };
    // Rounded parts must still add to the displayed total.
    result.estimatedKg = round(result.reportedDivertedKg + result.assumedDivertedKg);
    for (const field of FIELDS) {
      const value = result[field], maximum = field === 'contributingProfiles' ? 1000 : 1_000_000;
      if (!Number.isFinite(value) || value < 0 || value > maximum || (FIELDS.indexOf(field) < 3 && !Number.isSafeInteger(value))) throw syncError('INVALID_SNAPSHOT');
    }
    return result;
  }).sort((a, b) => a.institutionId.localeCompare(b.institutionId));
  return { version: 1, institutions };
}

export function validatePublicEndpoint(value) {
  try {
    if (typeof value !== 'string' || !value.trim()) throw new Error();
    const url = new URL(value.trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol) || (url.protocol !== 'https:' && !local) || !['', '/'].includes(url.pathname)) throw new Error();
    return url.origin;
  } catch { throw syncError('INVALID_ENDPOINT'); }
}

export function createPublicSync({ storage = globalThis.localStorage, fetchImpl = globalThis.fetch, publishTransport, cryptoImpl = globalThis.crypto, locksImpl = globalThis.navigator?.locks, timeoutMs = PUBLIC_SYNC_TIMEOUT_MS } = {}) {
  let serial = Promise.resolve();
  const published = new Map(), attempts = new Map();
  const bound = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, PUBLIC_SYNC_TIMEOUT_MS) : PUBLIC_SYNC_TIMEOUT_MS;
  function identity(create = true) {
    let secret;
    try { secret = storage?.getItem(PUBLIC_IDENTITY_KEY); } catch { throw syncError('IDENTITY_UNAVAILABLE'); }
    if (/^[a-f0-9]{48}$/.test(secret || '')) return secret;
    if (!create) return null;
    if (!cryptoImpl?.getRandomValues || !cryptoImpl?.subtle?.digest) throw syncError('CRYPTO_UNAVAILABLE');
    const bytes = new Uint8Array(24); cryptoImpl.getRandomValues(bytes);
    secret = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    try { storage.setItem(PUBLIC_IDENTITY_KEY, secret); if (storage.getItem(PUBLIC_IDENTITY_KEY) !== secret) throw new Error(); }
    catch { throw syncError('IDENTITY_UNAVAILABLE'); }
    return secret;
  }
  async function fingerprint(body) {
    if (typeof publishTransport === 'function') return body;
    if (!cryptoImpl?.subtle?.digest) throw syncError('CRYPTO_UNAVAILABLE');
    const bytes = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(body)));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function lastRevision() {
    try { const value = Number(storage?.getItem(PUBLIC_REVISION_KEY)); return Number.isSafeInteger(value) && value > 0 ? value : 0; }
    catch { throw syncError('IDENTITY_UNAVAILABLE'); }
  }
  function allocateRevision() {
    const revision = Math.max(Date.now(), lastRevision() + 1);
    if (!Number.isSafeInteger(revision) || revision < 1) throw syncError('IDENTITY_UNAVAILABLE');
    try { storage.setItem(PUBLIC_REVISION_KEY, String(revision)); if (Number(storage.getItem(PUBLIC_REVISION_KEY)) !== revision) throw new Error(); }
    catch { throw syncError('IDENTITY_UNAVAILABLE'); }
    return revision;
  }
  function pendingRemovals() {
    let values;
    try { values = JSON.parse(storage?.getItem(PUBLIC_REMOVALS_KEY) || '[]'); }
    catch { throw syncError('IDENTITY_UNAVAILABLE'); }
    if (!Array.isArray(values)) throw syncError('IDENTITY_UNAVAILABLE');
    return [...new Set(values.map(validatePublicEndpoint))];
  }
  function rememberRemoval(endpoint, pending) {
    const values = new Set(pendingRemovals());
    if (pending) values.add(endpoint); else values.delete(endpoint);
    const body = JSON.stringify([...values]);
    try { storage.setItem(PUBLIC_REMOVALS_KEY, body); if (storage.getItem(PUBLIC_REMOVALS_KEY) !== body) throw new Error(); }
    catch { throw syncError('IDENTITY_UNAVAILABLE'); }
  }
  // Requests are serialized so an older snapshot cannot finish after a newer one.
  function enqueue(operation, signal) {
    const result = serial.then(async () => {
      checkAbort(signal);
      // Web Locks coordinate other tabs sharing this installation identity.
      if (locksImpl?.request) {
        try { return await locksImpl.request('ecolens-naac-publish-v1', { mode: 'exclusive', ...(signal ? { signal } : {}) }, operation); }
        catch (error) { if (signal?.aborted) throw syncError('REQUEST_CANCELLED'); throw error; }
      }
      return operation();
    });
    serial = result.catch(() => {}); return result;
  }
  async function publish(endpoint, snapshot, signal, { revoke = false } = {}) {
    checkAbort(signal);
    const secret = typeof publishTransport === 'function' ? 'firebase-transport' : identity(!revoke);
    if (!secret) return { status: 'revoked', snapshot, skipped: true };
    const body = JSON.stringify(snapshot), hash = await fingerprint(body);
    checkAbort(signal);
    if (!revoke && published.get(endpoint)?.hash === hash && published.get(endpoint).secret === secret && published.get(endpoint).revision === lastRevision()) return { status: 'unchanged', snapshot, updatedAt: published.get(endpoint).updatedAt };
    const attempt = attempts.get(endpoint);
    const revision = attempt?.hash === hash && attempt.secret === secret && attempt.revision === lastRevision() ? attempt.revision : allocateRevision();
    attempts.set(endpoint, { hash, secret, revision });
    const payload = JSON.stringify({ version: snapshot.version, revision, institutions: snapshot.institutions });
    if (typeof fetchImpl !== 'function') throw syncError('PUBLIC_NETWORK');
    const controller = new AbortController();
    let timer, rejectCancellation;
    const cancelled = new Promise((_, reject) => { rejectCancellation = reject; });
    const abort = () => { controller.abort(); rejectCancellation(syncError('REQUEST_CANCELLED')); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { controller.abort(); rejectCancellation(syncError('PUBLIC_TIMEOUT')); }, bound);
    try {
      checkAbort(signal);
      const request = (async () => {
        let reply;
        if (typeof publishTransport === 'function') {
          try { reply = await publishTransport({ endpoint, snapshot: JSON.parse(payload), signal: controller.signal, revoke }); }
          catch (error) { throw syncError(signal?.aborted ? 'REQUEST_CANCELLED' : Object.hasOwn(ERRORS, error?.code) ? error.code : 'PUBLIC_NETWORK'); }
        } else {
          let response;
          try { response = await fetchImpl(`${endpoint}/api/naac/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: payload, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }); }
          catch { throw syncError(signal?.aborted ? 'REQUEST_CANCELLED' : 'PUBLIC_NETWORK'); }
          try { reply = await response.json(); } catch { throw syncError('PUBLIC_RESPONSE'); }
          if (!response.ok) throw syncError(Object.hasOwn(ERRORS, reply?.error?.code) ? reply.error.code : 'PUBLIC_NETWORK');
        }
        if (reply?.version !== 1 || reply.published !== true || typeof reply.updatedAt !== 'string' || !Number.isFinite(Date.parse(reply.updatedAt))) throw syncError('PUBLIC_RESPONSE');
        return reply;
      })();
      const reply = await Promise.race([request, cancelled]);
      checkAbort(signal);
      published.set(endpoint, { hash, updatedAt: reply.updatedAt, secret, revision });
      if (revoke) rememberRemoval(endpoint, false);
      return { status: revoke ? 'revoked' : 'published', snapshot, updatedAt: reply.updatedAt };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  return {
    pendingRemovals,
    sync(state, { endpoint, enabled = false, signal } = {}) {
      if (!enabled) return Promise.resolve({ status: 'disabled' });
      let base, snapshot;
      try { checkAbort(signal); base = validatePublicEndpoint(endpoint); snapshot = buildPublicSnapshot(state); }
      catch (error) { return Promise.reject(error); }
      return enqueue(() => publish(base, snapshot, signal), signal);
    },
    revoke({ endpoint, signal } = {}) {
      let base;
      try { checkAbort(signal); base = validatePublicEndpoint(endpoint); } catch (error) { return Promise.reject(error); }
      return enqueue(() => {
        checkAbort(signal);
        if (typeof publishTransport !== 'function' && !identity(false)) {
          if (pendingRemovals().includes(base)) throw syncError('IDENTITY_UNAVAILABLE');
          return { status: 'revoked', snapshot: { version: 1, institutions: [] }, skipped: true };
        }
        // Keep the address until the server confirms removal, including offline failures.
        rememberRemoval(base, true);
        return publish(base, { version: 1, institutions: [] }, signal, { revoke: true });
      }, signal);
    }
  };
}
