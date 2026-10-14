import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeWithGemini, makeGeminiPayload, PROVIDER_TIMEOUT_MS, ANALYSIS_SCHEMA
} from './cloudflare-worker.mjs';

const env = { GEMINI_API_KEY: 'test-placeholder', FREE_TIER_ONLY: '1' };
const input = { image: 'mock-image-not-sent-to-a-provider', language: 'en' };
function providerResult(result, finishReason = 'STOP') {
  return Response.json({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(result) }] } }] });
}
const result = {
  components: [{ name: 'Paper', material: 'paper', route: 'recycle', confidence: 0.9, advice: 'Keep paper dry; confirm campus acceptance.' }],
  warnings: [], uncertain: false
};

test('cloud payload disables dynamic thinking and requests concise structured guidance', () => {
  const payload = makeGeminiPayload(input);
  assert.equal(payload.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.equal(payload.generationConfig.maxOutputTokens, 3072);
  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
  assert.equal(payload.generationConfig.responseJsonSchema, ANALYSIS_SCHEMA);
  assert.equal(ANALYSIS_SCHEMA.properties.components.maxItems, 20);
  assert.match(payload.contents[0].parts[0].text, /one short sentence/);
  assert.match(payload.contents[0].parts[0].text, /ambiguous material is unknown/);
});

test('group cloud prompt inspects every visible item and never guesses a bottle material or hidden contents', () => {
  const single = makeGeminiPayload(input).contents[0].parts[0].text;
  const group = makeGeminiPayload({ ...input, scene: 'group' }).contents[0].parts[0].text;
  assert.match(single, /SINGLE item scan/);
  assert.match(group, /GROUP scan/);
  assert.match(group, /full image including its edges/);
  assert.match(group, /each distinct visible target/);
  assert.match(group, /Do not invent contents concealed/);
  assert.match(group, /never infer material from shape, colour, shine or transparency alone/);
  assert.match(group, /requiresMaterialConfirmation to true, reusable to true/);
  assert.equal(ANALYSIS_SCHEMA.properties.components.items.properties.requiresMaterialConfirmation.type, 'boolean');
  assert.equal(ANALYSIS_SCHEMA.properties.components.items.properties.reusable.type, 'boolean');
});

test('group cloud request preserves material ambiguity and reuse flags without additional provider calls', async () => {
  let calls = 0, payload;
  const components = [
    { name: 'Bottle', material: 'metal', route: 'recycle', confidence: 0.99, advice: 'Reuse if intact.', requiresMaterialConfirmation: true, reusable: true },
    { ...result.components[0], requiresMaterialConfirmation: false, reusable: false }
  ];
  const analysis = await analyzeWithGemini({ ...input, scene: 'group' }, env, {
    fetchImpl: async (_url, options) => { calls++; payload = JSON.parse(options.body); return providerResult({ ...result, components }); }
  });
  assert.equal(calls, 1);
  assert.match(payload.contents[0].parts[0].text, /GROUP scan/);
  assert.equal(analysis.scene, 'group');
  assert.equal(analysis.components.length, 2);
  assert.equal(analysis.components[0].material, 'unknown');
  assert.equal(analysis.components[0].requiresMaterialConfirmation, true);
  assert.equal(analysis.components[0].reusable, true);
  assert.equal(analysis.components[1].route, 'recycle');
  assert.equal(analysis.uncertain, true);
});

test('provider deadline is ten seconds and a stalled fetch is aborted exactly once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0, providerSignal;
  const pending = analyzeWithGemini(input, env, {
    fetchImpl: async (_url, options) => {
      calls++;
      providerSignal = options.signal;
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    }
  });
  const rejected = assert.rejects(pending, { code: 'PROVIDER_TIMEOUT', status: 504 });
  assert.equal(PROVIDER_TIMEOUT_MS, 10_000);
  t.mock.timers.tick(PROVIDER_TIMEOUT_MS - 1);
  assert.equal(providerSignal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(providerSignal.aborted, true);
  assert.equal(calls, 1);
});

test('provider deadline also bounds a stalled response body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const stream = new ReadableStream({ start() {} });
  const pending = analyzeWithGemini(input, env, {
    fetchImpl: async () => { calls++; return new Response(stream); }
  });
  const rejected = assert.rejects(pending, { code: 'PROVIDER_TIMEOUT', status: 504 });
  await Promise.resolve();
  t.mock.timers.tick(PROVIDER_TIMEOUT_MS);
  await rejected;
  assert.equal(calls, 1);
});

test('cancellation avoids a provider call or aborts the one already in progress', async () => {
  const preCancelled = new AbortController();
  preCancelled.abort();
  let calls = 0;
  await assert.rejects(analyzeWithGemini(input, env, { signal: preCancelled.signal, fetchImpl: async () => { calls++; } }), { code: 'REQUEST_CANCELLED' });
  assert.equal(calls, 0);

  const controller = new AbortController();
  let providerSignal;
  const pending = analyzeWithGemini(input, env, {
    signal: controller.signal,
    fetchImpl: async (_url, options) => { calls++; providerSignal = options.signal; return new Promise(() => {}); }
  });
  controller.abort();
  await assert.rejects(pending, { code: 'REQUEST_CANCELLED', status: 499 });
  assert.equal(providerSignal.aborted, true);
  assert.equal(calls, 1);
});

test('quota exhaustion and truncated JSON do not retry or return misleading success', async () => {
  for (const response of [new Response('provider detail', { status: 429 }), providerResult(result, 'MAX_TOKENS')]) {
    let calls = 0;
    await assert.rejects(analyzeWithGemini(input, env, {
      fetchImpl: async () => { calls++; return response; }
    }), { code: response.status === 429 ? 'PROVIDER_QUOTA' : 'INVALID_RESPONSE' });
    assert.equal(calls, 1);
  }
});

test('twenty separate components and Bengali/Hindi guidance remain accepted', async () => {
  for (const [language, name, advice] of [
    ['en', 'Paper', 'Keep clean paper dry.'],
    ['bn', 'কাগজ', 'পরিষ্কার কাগজ শুকনো রাখুন।'],
    ['hi', 'कागज़', 'साफ कागज़ सूखा रखें।']
  ]) {
    const components = Array.from({ length: 20 }, (_, i) => ({ ...result.components[0], name: `${name} ${i + 1}`, advice }));
    const analysis = await analyzeWithGemini({ ...input, language }, env, {
      fetchImpl: async () => providerResult({ ...result, components })
    });
    assert.equal(analysis.components.length, 20);
    assert.equal(analysis.components[0].advice, advice);
    assert.equal(analysis.source, 'online');
  }
});
