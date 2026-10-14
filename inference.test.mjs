import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import {
  letterboxGeometry, rgbaToPlanarRGB, decodeYoloOutput, nonMaximumSuppression,
  helperComponents, validateOnlineResult
} from './inference.js';
import {
  onlineStatus, prepareInput, normalizeCloudResult, analyzeWithGemini,
  isAllowedOrigin, EcoLensQuota, default as worker
} from './cloudflare-worker.mjs';
import { createEcolensServer, createLocalQuota } from './server.mjs';
import { normalizeAnalysis } from './core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK_ROOT = path.join(HERE, '.ecolens', 'test-fixtures');
const JPEG = Buffer.from([255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 217]).toString('base64');
const CLOUD_RESULT = {
  components: [
    { name: 'Bottle', material: 'glass', route: 'recycle', confidence: 0.9, advice: 'Empty the bottle and confirm glass collection.' },
    { name: 'Bottle', material: 'glass', route: 'recycle', confidence: 0.85, advice: 'Empty the bottle and confirm glass collection.' }
  ], warnings: [], uncertain: false
};

function fixtureOutput(boxes) {
  const count = boxes.length;
  const data = new Float32Array(12 * count);
  boxes.forEach(({ cx, cy, w, h, label, score, secondLabel, secondScore }, index) => {
    data[index] = cx; data[count + index] = cy;
    data[count * 2 + index] = w; data[count * 3 + index] = h;
    data[count * (4 + label) + index] = score;
    if (secondLabel !== undefined) data[count * (4 + secondLabel) + index] = secondScore;
  });
  return { dims: [1, 12, count], type: 'float32', data };
}
async function temporaryRoot(t) {
  // Keep fixtures inside the checkout so a folder-scoped permission is sufficient.
  await fs.mkdir(WORK_ROOT, { recursive: true });
  const root = await fs.mkdtemp(path.join(WORK_ROOT, 'ecolens-test-'));
  t.after(async () => {
    const resolved = path.resolve(root);
    assert.ok(path.dirname(resolved) === WORK_ROOT && path.basename(resolved).startsWith('ecolens-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return root;
}
function requestInProcess(server, { url = '/', method = 'GET', headers = {}, body = '' } = {}) {
  // Invoke Node's request handler without a real socket, so tests work in sandboxed sessions.
  return new Promise(resolve => {
    const req = Readable.from(body ? [Buffer.from(body)] : []);
    Object.assign(req, {
      url, method, headers: { host: '127.0.0.1:8787', ...headers },
      socket: { remoteAddress: '127.0.0.1' }
    });
    const res = {
      headersSent: false,
      writeHead(status, responseHeaders) { this.status = status; this.headers = responseHeaders; this.headersSent = true; },
      end(content) { resolve({ status: this.status, headers: this.headers, body: content ? String(content) : '' }); }
    };
    server.emit('request', req, res);
  });
}
function setGlobal(t, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  });
}
let isolatedId = 0;
async function isolatedInference() {
  return import(`./inference.js?test=${++isolatedId}`);
}
function mockBrowserModel(t, output, helpers = []) {
  let capturedTensor;
  const fakeSession = {
    inputNames: ['images'], outputNames: ['output0'],
    async run(feeds) { capturedTensor = feeds.images; return { output0: output }; }
  };
  setGlobal(t, 'ort', {
    env: { wasm: {} },
    Tensor: class {
      constructor(type, data, dims) { Object.assign(this, { type, data, dims }); }
      dispose() {}
    },
    InferenceSession: { async create() { return fakeSession; } }
  });
  setGlobal(t, 'cocoSsd', { async load() { return { async detect() { return helpers; } }; } });
  setGlobal(t, 'document', {
    createElement() {
      return { getContext() {
        return {
          fillRect() {}, drawImage() {},
          getImageData() { return { data: new Uint8ClampedArray(640 * 640 * 4) }; }
        };
      } };
    }
  });
  return () => capturedTensor;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function eventually(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Expected concurrent operation did not start.')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}

test('letterboxing maps portrait and landscape images without stretching', () => {
  const landscape = letterboxGeometry(1280, 720);
  assert.deepEqual([landscape.scale, landscape.left, landscape.top, landscape.resizedWidth, landscape.resizedHeight], [0.5, 0, 140, 640, 360]);
  const portrait = letterboxGeometry(720, 1280);
  assert.deepEqual([portrait.scale, portrait.left, portrait.top, portrait.resizedWidth, portrait.resizedHeight], [0.5, 140, 0, 360, 640]);
  assert.throws(() => letterboxGeometry(0, 640), /valid image/);
});

test('preprocessing uses normalized planar RGB rather than interleaved or BGR pixels', () => {
  const rgba = new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 64, 255]);
  const values = [...rgbaToPlanarRGB(rgba, 2, 1)].map(value => +value.toFixed(3));
  assert.deepEqual(values, [1, 0, 0, 1, 0.502, 0.251]);
  assert.throws(() => rgbaToPlanarRGB(rgba, 3, 1), /incomplete/);
});

test('YOLO decoder removes duplicate boxes but retains separate items and image coordinates', () => {
  const output = fixtureOutput([
    { cx: 250, cy: 320, w: 100, h: 80, label: 3, score: 0.9 },
    { cx: 251, cy: 320, w: 100, h: 80, label: 3, score: 0.8 },
    { cx: 500, cy: 320, w: 100, h: 80, label: 3, score: 0.85 }
  ]);
  const components = decodeYoloOutput(output, letterboxGeometry(1280, 720));
  assert.equal(components.length, 2);
  assert.equal(components[0].name, 'glass');
  assert.equal(components[0].route, 'recycle');
  assert.deepEqual(components[0].bbox, { x: 400, y: 280, w: 200, h: 160 });
  assert.equal(nonMaximumSuppression([
    { name: 'glass', confidence: 0.9, bbox: { x: 0, y: 0, w: 10, h: 10 } },
    { name: 'glass', confidence: 0.8, bbox: { x: 30, y: 0, w: 10, h: 10 } }
  ]).length, 2);
});

test('broad plastics, weak scores and close class ties require manual confirmation', () => {
  const output = fixtureOutput([
    { cx: 100, cy: 300, w: 100, h: 100, label: 6, score: 0.95 },
    { cx: 300, cy: 300, w: 100, h: 100, label: 3, score: 0.5 },
    { cx: 500, cy: 300, w: 100, h: 100, label: 5, score: 0.8, secondLabel: 1, secondScore: 0.77 }
  ]);
  const components = decodeYoloOutput(output, letterboxGeometry(640, 640));
  assert.equal(components.length, 3);
  assert.ok(components.every(component => component.route === 'unknown'));
  assert.match(components.find(component => component.name === 'plastic').advice, /cannot distinguish/);
});

test('invalid model shape and nonfinite or tiny boxes do not become valid detections', () => {
  assert.throws(() => decodeYoloOutput({ dims: [1, 84, 8400], data: [] }, letterboxGeometry(640, 640)), /unexpected output/);
  const output = fixtureOutput([
    { cx: NaN, cy: 320, w: 100, h: 100, label: 3, score: 0.9 },
    { cx: 320, cy: 320, w: 1, h: 1, label: 3, score: 0.9 }
  ]);
  assert.equal(decodeYoloOutput(output, letterboxGeometry(640, 640)).length, 0);
});

test('general-object helper excludes peripheral people and handles target food and electronics', () => {
  const components = helperComponents([
    { class: 'person', score: 0.99, bbox: [0, 0, 10, 10] },
    { class: 'apple', score: 0.9, bbox: [250, 250, 100, 100] },
    { class: 'cell phone', score: 0.9, bbox: [370, 250, 100, 100] },
    { class: 'bottle', score: 0.9, bbox: [130, 250, 100, 100] }
  ], 640, 640);
  assert.deepEqual(components.map(component => component.route), ['organic', 'ewaste', 'unknown']);
  assert.match(components[1].advice, /Confirm it is being discarded/);
});

test('conflicting material labels on the same item become one unresolved component, not mixed waste', () => {
  const output = fixtureOutput([
    { cx: 150, cy: 300, w: 140, h: 160, label: 3, score: 0.95 },
    { cx: 151, cy: 300, w: 140, h: 160, label: 6, score: 0.93 },
    { cx: 149, cy: 300, w: 140, h: 160, label: 4, score: 0.9 },
    { cx: 430, cy: 300, w: 140, h: 160, label: 3, score: 0.91 }
  ]);
  const components = decodeYoloOutput(output, letterboxGeometry(640, 640));
  assert.equal(components.length, 2);
  assert.equal(components[0].route, 'unknown');
  assert.equal(components[0].material, 'unknown');
  assert.equal(components[0].requiresMaterialConfirmation, true);
  assert.deepEqual(components[0].materialCandidates.map(item => item.material), ['glass', 'plastic', 'metal']);
  assert.equal(components[1].name, 'glass');
  // Moderately overlapping objects can be separate physical items.
  assert.equal(nonMaximumSuppression([
    { name: 'glass', material: 'glass', confidence: 0.95, bbox: { x: 0, y: 0, w: 100, h: 100 } },
    { name: 'metal', material: 'metal', confidence: 0.9, bbox: { x: 25, y: 0, w: 100, h: 100 } }
  ]).length, 2);
});

test('group helper includes peripheral visible targets without people or background furniture', () => {
  const predictions = [
    { class: 'apple', score: 0.9, bbox: [0, 20, 60, 60] },
    { class: 'cell phone', score: 0.9, bbox: [585, 570, 50, 65] },
    { class: 'bottle', score: 0.9, bbox: [80, 100, 60, 120] },
    { class: 'bottle', score: 0.85, bbox: [220, 100, 60, 120] },
    { class: 'person', score: 0.99, bbox: [0, 0, 640, 640] },
    { class: 'chair', score: 0.99, bbox: [250, 250, 200, 200] }
  ];
  assert.equal(helperComponents(predictions, 640, 640).some(component => component.name === 'apple'), false);
  const components = helperComponents(predictions, 640, 640, { scene: 'group' });
  assert.deepEqual(components.map(component => component.name), ['apple', 'cell phone', 'bottle', 'bottle']);
  assert.ok(components.filter(component => component.name === 'bottle').every(component => component.requiresMaterialConfirmation && component.reusable));
  assert.equal(components.length, 4); // No unseen bottle contents or people are added.
});

test('group decoder retains smaller visible waste without lowering model score requirements', () => {
  const output = fixtureOutput([
    { cx: 40, cy: 40, w: 40, h: 40, label: 1, score: 0.95 },
    { cx: 100, cy: 100, w: 40, h: 40, label: 1, score: 0.3 }
  ]);
  const geometry = letterboxGeometry(640, 640);
  assert.equal(decodeYoloOutput(output, geometry).length, 0);
  const group = decodeYoloOutput(output, geometry, 0.4, { scene: 'group' });
  assert.equal(group.length, 1);
  assert.equal(group[0].name, 'cardboard');
});

test('a generic bottle overrides every confident material guess and requires actual material verification', async t => {
  for (const [label, guessedMaterial] of [[3, 'glass'], [6, 'plastic'], [4, 'metal']]) {
    await t.test(guessedMaterial, async subtest => {
      mockBrowserModel(subtest,
        fixtureOutput([{ cx: 320, cy: 320, w: 180, h: 300, label, score: 0.97 }]),
        [{ class: 'bottle', score: 0.95, bbox: [230, 170, 180, 300] }]
      );
      const inference = await isolatedInference();
      const result = await inference.analyzeOffline({ width: 640, height: 640 });
      assert.equal(result.components.length, 1);
      const bottle = result.components[0];
      assert.equal(bottle.name, 'bottle');
      assert.equal(bottle.material, 'unknown');
      assert.equal(bottle.route, 'unknown');
      assert.equal(bottle.requiresMaterialConfirmation, true);
      assert.equal(bottle.reusable, true);
      assert.deepEqual(bottle.materialCandidates, [{ material: guessedMaterial, confidence: bottle.materialCandidates[0].confidence }]);
      assert.ok(bottle.materialCandidates[0].confidence > 0.96);
      assert.deepEqual(bottle.candidateMaterials, ['metal', 'plastic', 'glass', 'paper']);
      assert.equal(result.uncertain, true);
      assert.match(bottle.advice, /Reuse if intact/);
    });
  }
});

test('group analysis covers edge items and rejects a material false positive over a person', async t => {
  mockBrowserModel(t,
    fixtureOutput([
      { cx: 320, cy: 320, w: 300, h: 300, label: 3, score: 0.97 },
      { cx: 530, cy: 350, w: 120, h: 120, label: 2, score: 0.98 }
    ]),
    [
      { class: 'person', score: 0.99, bbox: [170, 170, 300, 300] },
      { class: 'apple', score: 0.9, bbox: [0, 0, 50, 50] },
      { class: 'cell phone', score: 0.9, bbox: [580, 570, 60, 70] }
    ]
  );
  const inference = await isolatedInference();
  const result = await inference.analyzeOffline({ width: 640, height: 640 }, { scene: 'group' });
  assert.equal(result.scene, 'group');
  assert.deepEqual(result.components.map(component => component.name), ['apple', 'cell phone']);
  assert.ok(result.components.every(component => component.route !== 'nonwaste'));
});

test('material candidate arrays in partial previews cannot mutate the final result', async t => {
  mockBrowserModel(t, fixtureOutput([{ cx: 320, cy: 320, w: 300, h: 300, label: 3, score: 0.5 }]));
  const previewReady = deferred(), helperDone = deferred();
  globalThis.cocoSsd.load = async () => ({ detect: () => helperDone.promise });
  const inference = await isolatedInference();
  const scan = inference.analyzeOffline({ width: 640, height: 640 }, {
    onPartialResult: preview => { preview.components[0].materialCandidates[0].material = 'metal'; previewReady.resolve(); }
  });
  await eventually(previewReady.promise);
  helperDone.resolve([]);
  assert.equal((await scan).components[0].materialCandidates[0].material, 'glass');
});

test('offline analysis feeds FP32 input and returns unknown for an unsupported empty result', async t => {
  const capture = mockBrowserModel(t, fixtureOutput([]));
  const inference = await isolatedInference();
  const result = await inference.analyzeOffline({ width: 640, height: 640 });
  assert.equal(capture().type, 'float32');
  assert.deepEqual(capture().dims, [1, 3, 640, 640]);
  assert.equal(result.source, 'offline');
  assert.equal(result.components[0].route, 'unknown');
  assert.equal(result.uncertain, true);
});

test('a confident person match rejects a material false positive on the same target', async t => {
  mockBrowserModel(t,
    fixtureOutput([{ cx: 320, cy: 320, w: 300, h: 300, label: 3, score: 0.9 }]),
    [{ class: 'person', score: 0.99, bbox: [170, 170, 300, 300] }]
  );
  const inference = await isolatedInference();
  const result = await inference.analyzeOffline({ width: 640, height: 640 });
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].route, 'nonwaste');
  assert.equal(result.uncertain, false);
});

test('cancelled offline scans exit before loading the model', async () => {
  const controller = new AbortController(); controller.abort();
  const inference = await isolatedInference();
  await assert.rejects(() => inference.analyzeOffline({ width: 640, height: 640 }, { signal: controller.signal }), { name: 'AbortError' });
});

test('offline initialization loads both models concurrently and shares them between callers', async t => {
  mockBrowserModel(t, fixtureOutput([]));
  const waste = deferred(), helper = deferred(), helperStarted = deferred();
  let wasteLoads = 0, helperLoads = 0;
  globalThis.ort.InferenceSession.create = () => { wasteLoads++; return waste.promise; };
  globalThis.cocoSsd.load = () => { helperLoads++; helperStarted.resolve(); return helper.promise; };
  const inference = await isolatedInference();
  const firstEvents = [], secondEvents = [];
  const first = inference.initOffline(event => firstEvents.push(event.stage));
  const second = inference.initOffline({ onProgress: event => secondEvents.push(event.stage) });
  await eventually(helperStarted.promise); // Helper starts while waste is still pending.
  assert.equal(inference.getOfflineStatus().loading, true);
  assert.equal(wasteLoads, 1);
  assert.equal(helperLoads, 1);
  waste.resolve({}); helper.resolve({ detect: async () => [] });
  const results = await Promise.all([first, second]);
  assert.ok(results.every(result => result.ready && result.helperReady && !result.loading));
  assert.ok(firstEvents.includes('ready') && secondEvents.includes('ready'));
  await inference.initOffline();
  assert.equal(wasteLoads, 1);
  assert.equal(helperLoads, 1);
});

test('a cancelled initialization subscriber does not cancel another caller or duplicate loading', async t => {
  mockBrowserModel(t, fixtureOutput([]));
  const gate = deferred();
  let loads = 0;
  globalThis.ort.InferenceSession.create = () => { loads++; return gate.promise; };
  const inference = await isolatedInference();
  const controller = new AbortController();
  const cancelled = inference.initOffline({ signal: controller.signal });
  const surviving = inference.initOffline();
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  gate.resolve({});
  assert.equal((await surviving).ready, true);
  assert.equal(loads, 1);
});

test('helper failure is visible and a later preparation retries it without reloading waste weights', async t => {
  mockBrowserModel(t, fixtureOutput([]));
  let helpers = 0, wasteLoads = 0;
  globalThis.cocoSsd.load = async () => {
    if (++helpers === 1) throw new Error('Asset temporarily unavailable');
    return { detect: async () => [] };
  };
  globalThis.ort.InferenceSession.create = async () => { wasteLoads++; return {}; };
  const inference = await isolatedInference();
  const first = await inference.initOffline();
  assert.equal(first.ready, true);
  assert.equal(first.helperReady, false);
  assert.match(first.warning, /food and electronics/);
  const retry = await inference.initOffline();
  assert.equal(retry.helperReady, true);
  assert.equal(retry.warning, '');
  assert.equal(helpers, 2);
  assert.equal(wasteLoads, 1);
});

test('unavailable helper checks require manual confirmation even for a strong material score', async t => {
  for (const phase of ['load', 'detect']) {
    await t.test(`helper ${phase} failure`, async subtest => {
      mockBrowserModel(subtest, fixtureOutput([{ cx: 320, cy: 320, w: 300, h: 300, label: 3, score: 0.95 }]));
      globalThis.cocoSsd.load = async () => {
        if (phase === 'load') throw new Error('Helper assets unavailable');
        return { detect: async () => { throw new Error('Helper inference unavailable'); } };
      };
      const inference = await isolatedInference();
      const raw = await inference.analyzeOffline({ width: 640, height: 640 });
      assert.equal(raw.components[0].route, 'unknown');
      assert.equal(raw.components[0].requiresMaterialConfirmation, true);
      assert.ok(raw.components[0].confidence > 0.9);
      assert.equal(raw.uncertain, true);
      assert.ok(raw.warnings.some(warning => /confirm every material manually/i.test(warning)));
      const analysis = normalizeAnalysis(raw);
      assert.equal(analysis.uncertain, true);
      analysis.components[0].confirmedByUser = true;
      assert.equal(normalizeAnalysis(analysis).uncertain, true);
      Object.assign(analysis.components[0], { material: 'glass', route: 'recycle', materialConfirmedByUser: true });
      assert.equal(normalizeAnalysis(analysis).uncertain, false);
    });
  }
});

test('failed waste model loading can be retried and never leaves initialization stuck', async t => {
  mockBrowserModel(t, fixtureOutput([]));
  setGlobal(t, 'Worker', undefined);
  let loads = 0;
  globalThis.ort.InferenceSession.create = async () => {
    if (++loads === 1) throw new Error('Temporary asset failure');
    return {};
  };
  const inference = await isolatedInference();
  await assert.rejects(inference.initOffline(), { code: 'MODEL_UNAVAILABLE' });
  assert.equal(inference.getOfflineStatus().loading, false);
  assert.equal((await inference.initOffline()).ready, true);
  assert.equal(loads, 2);
});

test('blocked worker proxy reloads the local runtime and uses direct WASM successfully', async t => {
  mockBrowserModel(t, fixtureOutput([]));
  setGlobal(t, 'Worker', class {});
  const scriptSources = [];
  globalThis.document.head = {
    appendChild(script) {
      scriptSources.push(script.src);
      queueMicrotask(() => {
        globalThis.ort.InferenceSession.create = async () => ({});
        script.onload();
      });
    }
  };
  globalThis.ort.InferenceSession.create = async () => { throw new Error('Worker blocked by browser'); };
  const inference = await isolatedInference();
  assert.equal((await inference.initOffline()).ready, true);
  assert.equal(inference.getOfflineStatus().worker, false);
  assert.equal(globalThis.ort.env.wasm.proxy, false);
  assert.equal(scriptSources.length, 1);
  assert.ok(scriptSources[0].endsWith('/vendor/ort.min.js'));
});

test('local runtimes load on demand once, including dependent TF then COCO scripts', async t => {
  const sources = [];
  let modelLoads = 0, helperLoads = 0;
  setGlobal(t, 'ort', undefined); setGlobal(t, 'tf', undefined); setGlobal(t, 'cocoSsd', undefined);
  setGlobal(t, 'document', {
    createElement: () => ({}),
    head: {
      appendChild(script) {
        sources.push(script.src);
        queueMicrotask(() => {
          if (script.src.endsWith('/ort.min.js')) globalThis.ort = {
            env: { wasm: {} }, InferenceSession: { create: async () => { modelLoads++; return {}; } }
          };
          if (script.src.endsWith('/tf.min.js')) globalThis.tf = { ready: async () => {} };
          if (script.src.endsWith('/coco-ssd.min.js')) {
            assert.ok(globalThis.tf);
            globalThis.cocoSsd = { load: async () => { helperLoads++; return {}; } };
          }
          script.onload();
        });
      }
    }
  });
  const inference = await isolatedInference();
  await Promise.all([inference.initOffline(), inference.initOffline()]);
  await inference.initOffline();
  assert.equal(sources.length, 3);
  assert.ok(sources.every(source => /\/vendor\/(?:ort\.min|tf\.min|coco-ssd\.min)\.js$/.test(source)));
  assert.equal(modelLoads, 1);
  assert.equal(helperLoads, 1);
});

test('warmup is shared, disposes outputs and is reused by later preparation', async t => {
  mockBrowserModel(t, fixtureOutput([]));
  let runs = 0, disposed = 0;
  globalThis.ort.InferenceSession.create = async () => ({
    inputNames: ['images'], outputNames: ['output0'],
    run: async () => { runs++; return { output0: { ...fixtureOutput([]), dispose: () => disposed++ } }; }
  });
  const inference = await isolatedInference();
  const stages = [];
  const results = await Promise.all([
    inference.warmupOffline(event => stages.push(event.stage)),
    inference.warmupOffline()
  ]);
  assert.ok(results.every(result => result.warmed && !result.warming));
  assert.ok(stages.includes('warming-local-model'));
  await inference.warmupOffline();
  assert.equal(runs, 1);
  assert.equal(disposed, 1);
});

test('waste and helper inference start concurrently while overlapping scans are rejected', async t => {
  mockBrowserModel(t, fixtureOutput([]));
  const wasteStarted = deferred(), helperStarted = deferred(), wasteDone = deferred(), helperDone = deferred();
  globalThis.ort.InferenceSession.create = async () => ({
    inputNames: ['images'], outputNames: ['output0'],
    run: () => { wasteStarted.resolve(); return wasteDone.promise; }
  });
  globalThis.cocoSsd.load = async () => ({ detect: () => { helperStarted.resolve(); return helperDone.promise; } });
  const inference = await isolatedInference();
  const scan = inference.analyzeOffline({ width: 640, height: 640 });
  await eventually(Promise.all([wasteStarted.promise, helperStarted.promise]));
  await assert.rejects(inference.analyzeOffline({ width: 640, height: 640 }), { code: 'SCAN_BUSY' });
  wasteDone.resolve({ output0: fixtureOutput([]) }); helperDone.resolve([]);
  assert.equal((await scan).source, 'offline');
});

test('material preview arrives before a slow helper and final food/electronics checks remain authoritative', async t => {
  mockBrowserModel(t, fixtureOutput([
    { cx: 200, cy: 300, w: 150, h: 150, label: 3, score: 0.95 },
    { cx: 440, cy: 300, w: 150, h: 150, label: 4, score: 0.9 }
  ]));
  const previewReady = deferred(), helperDone = deferred();
  const previews = [], events = [];
  globalThis.cocoSsd.load = async () => ({ detect: () => helperDone.promise });
  const inference = await isolatedInference();
  const scan = inference.analyzeOffline({ width: 640, height: 640 }, {
    onPartialResult: preview => { previews.push(preview); events.push('preview'); previewReady.resolve(); }
  }).then(result => { events.push('final'); return result; });
  await eventually(previewReady.promise);
  assert.deepEqual(events, ['preview']);
  assert.equal(previews[0].source, 'offline');
  assert.equal(previews[0].uncertain, true);
  assert.deepEqual(previews[0].components.map(component => component.name), ['glass', 'metal']);
  assert.ok(previews[0].warnings.some(warning => warning.includes('Wait for the complete result')));
  helperDone.resolve([
    { class: 'apple', score: 0.9, bbox: [125, 225, 150, 150] },
    { class: 'cell phone', score: 0.9, bbox: [365, 225, 150, 150] }
  ]);
  const result = await scan;
  assert.deepEqual(events, ['preview', 'final']);
  assert.deepEqual(result.components.map(component => component.route), ['organic', 'ewaste']);
  assert.equal(result.uncertain, false);
  // Final fusion must never alter the earlier preview object held by the UI.
  assert.deepEqual(previews[0].components.map(component => component.name), ['glass', 'metal']);
  assert.equal(previews[0].uncertain, true);
});

test('preview objects are separate copies and rendering errors cannot alter or suppress the final result', async t => {
  mockBrowserModel(t, fixtureOutput([{ cx: 320, cy: 320, w: 300, h: 300, label: 3, score: 0.95 }]));
  const previewReady = deferred(), helperDone = deferred();
  globalThis.cocoSsd.load = async () => ({ detect: () => helperDone.promise });
  const inference = await isolatedInference();
  const scan = inference.analyzeOffline({ width: 640, height: 640 }, {
    onPartialResult: preview => {
      preview.components[0].route = 'residual';
      preview.components[0].bbox.x = 1000;
      previewReady.resolve();
      throw new Error('Preview UI failed');
    }
  });
  await eventually(previewReady.promise);
  helperDone.resolve([]);
  const result = await scan;
  assert.equal(result.components[0].route, 'recycle');
  assert.equal(result.components[0].bbox.x, 170);
});

test('cancelled and empty material results never publish a partial result', async t => {
  await t.test('cancelled material result', async subtest => {
    mockBrowserModel(subtest, fixtureOutput([]));
    const started = deferred(), materialDone = deferred(), helperDone = deferred();
    globalThis.ort.InferenceSession.create = async () => ({
      inputNames: ['images'], outputNames: ['output0'],
      run: () => { started.resolve(); return materialDone.promise; }
    });
    globalThis.cocoSsd.load = async () => ({ detect: () => helperDone.promise });
    const inference = await isolatedInference();
    const controller = new AbortController();
    let previews = 0;
    const scan = inference.analyzeOffline({ width: 640, height: 640 }, { signal: controller.signal, onPartialResult: () => previews++ });
    await eventually(started.promise);
    controller.abort();
    const rejection = assert.rejects(scan, { name: 'AbortError' });
    materialDone.resolve({ output0: fixtureOutput([{ cx: 320, cy: 320, w: 300, h: 300, label: 3, score: 0.95 }]) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(previews, 0);
    helperDone.resolve([]);
    await rejection;
    assert.equal(previews, 0);
  });
  await t.test('empty material result', async subtest => {
    mockBrowserModel(subtest, fixtureOutput([]));
    const helperStarted = deferred(), helperDone = deferred();
    globalThis.cocoSsd.load = async () => ({ detect: () => { helperStarted.resolve(); return helperDone.promise; } });
    const inference = await isolatedInference();
    let previews = 0;
    const scan = inference.analyzeOffline({ width: 640, height: 640 }, { onPartialResult: () => previews++ });
    await eventually(helperStarted.promise);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(previews, 0);
    helperDone.resolve([]);
    const result = await scan;
    assert.equal(result.components[0].route, 'unknown');
    assert.equal(previews, 0);
  });
});

test('cancelling a running scan drains and disposes both engines before accepting another scan', async t => {
  mockBrowserModel(t, fixtureOutput([]));
  const wasteStarted = deferred(), helperStarted = deferred(), wasteDone = deferred(), helperDone = deferred();
  let disposed = 0, calls = 0;
  globalThis.ort.InferenceSession.create = async () => ({
    inputNames: ['images'], outputNames: ['output0'],
    run: () => {
      if (++calls > 1) return Promise.resolve({ output0: fixtureOutput([]) });
      wasteStarted.resolve(); return wasteDone.promise;
    }
  });
  globalThis.cocoSsd.load = async () => ({ detect: () => { helperStarted.resolve(); return calls > 1 ? Promise.resolve([]) : helperDone.promise; } });
  const inference = await isolatedInference();
  const controller = new AbortController();
  const scan = inference.analyzeOffline({ width: 640, height: 640 }, { signal: controller.signal });
  await eventually(Promise.all([wasteStarted.promise, helperStarted.promise]));
  controller.abort();
  const rejection = assert.rejects(scan, { name: 'AbortError' });
  wasteDone.resolve({ output0: { ...fixtureOutput([]), dispose: () => disposed++ } }); helperDone.resolve([]);
  await rejection;
  assert.equal(disposed, 1);
  assert.equal((await inference.analyzeOffline({ width: 640, height: 640 })).source, 'offline');
});

test('a queued next capture waits for cancelled engines to drain and then scans its own image', async t => {
  mockBrowserModel(t, fixtureOutput([]));
  const wasteStarted = deferred(), helperStarted = deferred(), wasteDone = deferred(), helperDone = deferred();
  const snapshots = [];
  let runs = 0;
  globalThis.ort.InferenceSession.create = async () => ({
    inputNames: ['images'], outputNames: ['output0'],
    run: async () => {
      runs++;
      if (runs === 1) { wasteStarted.resolve(); return wasteDone.promise; }
      return { output0: fixtureOutput([]) };
    }
  });
  globalThis.cocoSsd.load = async () => ({ detect: canvas => {
    snapshots.push(canvas.photo);
    if (runs === 1) { helperStarted.resolve(); return helperDone.promise; }
    return Promise.resolve([{ class: 'apple', score: 0.9, bbox: [250, 250, 100, 100] }]);
  } });
  const inference = await isolatedInference();
  const controller = new AbortController();
  const first = inference.analyzeOffline({ width: 640, height: 640, photo: 'first' }, { signal: controller.signal });
  await eventually(Promise.all([wasteStarted.promise, helperStarted.promise]));
  assert.equal(inference.getOfflineStatus().busy, true);
  controller.abort();
  const firstRejection = assert.rejects(first, { name: 'AbortError' });
  const next = inference.analyzeOffline({ width: 640, height: 640, photo: 'second' }, { queue: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(runs, 1); // No overlapping buffer use while the first task drains.
  wasteDone.resolve({ output0: fixtureOutput([]) }); helperDone.resolve([]);
  await firstRejection;
  const result = await next;
  assert.equal(result.components[0].route, 'organic');
  assert.deepEqual(snapshots, ['first', 'second']);
  assert.equal(runs, 2);
  assert.equal(inference.getOfflineStatus().busy, false);
});

test('abort while waiting in the local queue never starts that image or cancels the active scan', async t => {
  mockBrowserModel(t, fixtureOutput([]));
  const started = deferred(), done = deferred();
  let runs = 0;
  globalThis.ort.InferenceSession.create = async () => ({
    inputNames: ['images'], outputNames: ['output0'],
    run: () => { runs++; started.resolve(); return done.promise; }
  });
  const inference = await isolatedInference();
  const first = inference.analyzeOffline({ width: 640, height: 640 });
  await eventually(started.promise);
  const controller = new AbortController();
  const queued = inference.analyzeOffline({ width: 640, height: 640 }, { queue: true, signal: controller.signal });
  controller.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  assert.equal(inference.getOfflineStatus().busy, true);
  assert.equal(runs, 1);
  done.resolve({ output0: fixtureOutput([]) });
  assert.equal((await first).source, 'offline');
  assert.equal(inference.getOfflineStatus().busy, false);
});

test('helper input is resized cheaply and boxes retain original coordinates and override food false positives', async t => {
  mockBrowserModel(t, fixtureOutput([{ cx: 250, cy: 320, w: 100, h: 80, label: 3, score: 0.9 }]));
  let size;
  globalThis.cocoSsd.load = async () => ({ detect: async canvas => {
    size = [canvas.width, canvas.height];
    return [{ class: 'apple', score: 0.9, bbox: [200, 140, 100, 80] }];
  } });
  const inference = await isolatedInference();
  const result = await inference.analyzeOffline({ width: 1280, height: 720 });
  assert.deepEqual(size, [640, 360]);
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].route, 'organic');
  assert.deepEqual(result.components[0].bbox, { x: 400, y: 280, w: 200, h: 160 });
});

test('preprocessing reuses attached buffers and allocates fresh input after worker transfer', async t => {
  const capture = mockBrowserModel(t, fixtureOutput([]));
  const inference = await isolatedInference();
  await inference.analyzeOffline({ width: 640, height: 640 });
  const original = capture().data;
  await inference.analyzeOffline({ width: 640, height: 640 });
  assert.equal(capture().data, original);
  structuredClone(original, { transfer: [original.buffer] });
  assert.equal(original.length, 0);
  await inference.analyzeOffline({ width: 640, height: 640 });
  assert.notEqual(capture().data, original);
  assert.equal(capture().data.length, 640 * 640 * 3);
});

test('online browser contract sends only a JPEG, requested language and scan scene to the configured endpoint', async t => {
  setGlobal(t, 'location', { href: 'http://127.0.0.1:8787/' });
  let sent;
  setGlobal(t, 'fetch', async (url, options) => { sent = { url, options }; return Response.json(CLOUD_RESULT); });
  const inference = await isolatedInference();
  const result = await inference.analyzeOnline({ toDataURL: () => `data:image/jpeg;base64,${JPEG}` }, { endpoint: './api/analyze', language: 'bn' });
  assert.equal(sent.url, 'http://127.0.0.1:8787/api/analyze');
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.options.credentials, 'omit');
  assert.deepEqual(JSON.parse(sent.options.body), { image: JPEG, language: 'bn', scene: 'single' });
  assert.equal(result.source, 'online');
  assert.equal(result.components.length, 2);
});

test('online browser failures remain explicit and never masquerade as online success', async t => {
  setGlobal(t, 'location', { href: 'http://127.0.0.1:8787/' });
  setGlobal(t, 'fetch', async () => Response.json({ error: { code: 'PROVIDER_QUOTA' } }, { status: 429 }));
  const inference = await isolatedInference();
  await assert.rejects(() => inference.analyzeOnline({ toDataURL: () => `data:image/jpeg;base64,${JPEG}` }), { code: 'PROVIDER_QUOTA' });
  await assert.rejects(() => inference.analyzeOnline({ toDataURL: () => `data:image/jpeg;base64,${JPEG}` }, { endpoint: 'http://untrusted.example/api/analyze' }), { code: 'INSECURE_ENDPOINT' });
});

test('online uploads preserve aspect ratio and cap a large phone photo at 768 pixels', async t => {
  setGlobal(t, 'location', { href: 'https://ecolens.example/' });
  let uploadedCanvas, encoded, sent;
  setGlobal(t, 'document', {
    createElement: () => {
      uploadedCanvas = {
        getContext: () => ({ drawImage() {} }),
        toDataURL: (type, quality) => { encoded = { type, quality }; return `data:image/jpeg;base64,${JPEG}`; }
      };
      return uploadedCanvas;
    }
  });
  setGlobal(t, 'fetch', async (_url, options) => { sent = JSON.parse(options.body); return Response.json(CLOUD_RESULT); });
  const inference = await isolatedInference();
  await inference.analyzeOnline({ width: 4032, height: 3024, toDataURL() { throw new Error('Full resolution must not be uploaded'); } });
  assert.deepEqual([uploadedCanvas.width, uploadedCanvas.height], [768, 576]);
  assert.deepEqual(encoded, { type: 'image/jpeg', quality: 0.84 });
  assert.equal(sent.image, JPEG);
});

test('online group scans retain full-image detail and send the selected scene', async t => {
  setGlobal(t, 'location', { href: 'https://ecolens.example/' });
  let uploadedCanvas, sent;
  setGlobal(t, 'document', { createElement: () => {
    uploadedCanvas = { getContext: () => ({ drawImage() {} }), toDataURL: () => `data:image/jpeg;base64,${JPEG}` };
    return uploadedCanvas;
  } });
  setGlobal(t, 'fetch', async (_url, options) => { sent = JSON.parse(options.body); return Response.json(CLOUD_RESULT); });
  const inference = await isolatedInference();
  const result = await inference.analyzeOnline({ width: 4032, height: 3024 }, { scene: 'group', language: 'hi' });
  assert.deepEqual([uploadedCanvas.width, uploadedCanvas.height], [1024, 768]);
  assert.deepEqual(sent, { image: JPEG, language: 'hi', scene: 'group' });
  assert.equal(result.scene, 'group');
});

test('cloud material flags are conservative, optional for legacy results and strictly validated', () => {
  for (const normalize of [normalizeCloudResult, validateOnlineResult]) {
    const legacyBottle = normalize(CLOUD_RESULT).components[0];
    assert.equal(legacyBottle.material, 'unknown');
    assert.equal(legacyBottle.route, 'unknown');
    assert.equal(legacyBottle.requiresMaterialConfirmation, true);
    assert.equal(legacyBottle.reusable, true);
    assert.deepEqual(legacyBottle.materialCandidates, [{ material: 'glass', confidence: 0.9 }]);
    // Reuse-first recognition must not let a later disposal choice bypass the
    // material check on a bottle that was originally classified as in use.
    const intactBottle = normalize({ ...CLOUD_RESULT, components: [{ ...CLOUD_RESULT.components[0], route: 'nonwaste' }] }).components[0];
    assert.equal(intactBottle.requiresMaterialConfirmation, true);
    assert.equal(intactBottle.material, 'unknown');
    assert.equal(intactBottle.reusable, true);
    const raw = { components: [{ name: 'Scrap', material: 'metal', route: 'recycle', confidence: 0.95, advice: 'Check material.', requiresMaterialConfirmation: true, reusable: false, candidateMaterials: ['metal', 'plastic'], materialCandidates: [{ material: 'metal', confidence: 0.95 }] }], warnings: [], uncertain: false };
    const uncertain = normalize(raw);
    assert.equal(uncertain.components[0].material, 'unknown');
    assert.equal(uncertain.components[0].route, 'unknown');
    assert.equal(uncertain.components[0].reusable, false);
    assert.deepEqual(uncertain.components[0].candidateMaterials, ['metal', 'plastic']);
    assert.equal(uncertain.uncertain, true);
    for (const flags of [{ requiresMaterialConfirmation: 'yes' }, { reusable: 1 }, { candidateMaterials: 'metal' }, { materialCandidates: [{ material: 'metal', confidence: 95 }] }]) {
      assert.throws(() => normalize({ ...raw, components: [{ ...raw.components[0], ...flags }] }), { code: 'INVALID_RESPONSE' });
    }
    const paper = normalize({ ...raw, components: [{ name: 'Paper', material: 'paper', route: 'recycle', confidence: 0.9, advice: 'Keep dry.' }] });
    assert.equal(paper.components[0].route, 'recycle');
    assert.equal(paper.components[0].requiresMaterialConfirmation, undefined);
  }
});

test('bottle material ambiguity is also enforced for Bengali and Hindi response names', () => {
  for (const name of ['বোতল', 'धातु की बोतल']) {
    const result = normalizeCloudResult({ ...CLOUD_RESULT, components: [{ ...CLOUD_RESULT.components[0], name }] });
    assert.equal(result.components[0].material, 'unknown');
    assert.equal(result.components[0].requiresMaterialConfirmation, true);
  }
});

test('online cancellation is prompt even if a network implementation ignores abort', async t => {
  setGlobal(t, 'location', { href: 'http://127.0.0.1:8787/' });
  const started = deferred(), response = deferred();
  setGlobal(t, 'fetch', () => { started.resolve(); return response.promise; });
  const inference = await isolatedInference();
  const controller = new AbortController();
  const request = inference.analyzeOnline({ toDataURL: () => `data:image/jpeg;base64,${JPEG}` }, { signal: controller.signal });
  await started.promise;
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  response.resolve(Response.json(CLOUD_RESULT));
});

test('online timeout follows its configured deadline and reports explicit offline availability', async t => {
  setGlobal(t, 'location', { href: 'http://127.0.0.1:8787/' });
  const response = deferred();
  setGlobal(t, 'fetch', () => response.promise);
  const inference = await isolatedInference();
  const started = performance.now();
  await assert.rejects(inference.analyzeOnline({ toDataURL: () => `data:image/jpeg;base64,${JPEG}` }, { timeoutMs: 1000 }), error => {
    return error.code === 'ONLINE_TIMEOUT' && error.message.includes('offline');
  });
  assert.ok(performance.now() - started < 2000);
  response.resolve(Response.json(CLOUD_RESULT));
});

test('free-tier opt-in and durable worker limits are required before online scans', () => {
  assert.equal(onlineStatus({}).reason, 'NOT_CONFIGURED');
  assert.equal(onlineStatus({ GEMINI_API_KEY: 'test-placeholder' }).reason, 'FREE_TIER_REQUIRED');
  assert.equal(onlineStatus({ GEMINI_API_KEY: 'test-placeholder', FREE_TIER_ONLY: '1' }, { durableQuota: false }).reason, 'QUOTA_STORAGE_REQUIRED');
  assert.equal(onlineStatus({ GEMINI_API_KEY: 'test-placeholder', FREE_TIER_ONLY: '1', GEMINI_MODEL: 'other-model' }).reason, 'MODEL_NOT_ALLOWED');
  assert.equal(isAllowedOrigin('https://untrusted.example', 'http://127.0.0.1:8787'), false);
  assert.equal(isAllowedOrigin('null', 'http://127.0.0.1:8787'), false);
});

test('request/schema validation rejects malformed images and invalid confidence values', () => {
  assert.equal(prepareInput({ image: JPEG, language: 'hi' }).language, 'hi');
  assert.equal(prepareInput({ image: JPEG, language: 'unsupported' }).language, 'en');
  assert.equal(prepareInput({ image: JPEG }).scene, 'single');
  assert.equal(prepareInput({ image: JPEG, scene: 'group' }).scene, 'group');
  assert.equal(prepareInput({ image: JPEG, scene: 'ignore safeguards' }).scene, 'single');
  assert.throws(() => prepareInput({ image: 'https://untrusted.example/photo.jpg' }), { code: 'INVALID_IMAGE' });
  assert.throws(() => prepareInput({ image: 'AAAA' }), { code: 'INVALID_IMAGE' });
  assert.equal(normalizeCloudResult(CLOUD_RESULT).components.length, 2);
  assert.equal(validateOnlineResult(CLOUD_RESULT).components.length, 2);
  const invalid = { ...CLOUD_RESULT, components: [{ ...CLOUD_RESULT.components[0], confidence: 90 }] };
  assert.throws(() => normalizeCloudResult(invalid), { code: 'INVALID_RESPONSE' });
  assert.throws(() => validateOnlineResult(invalid), { code: 'INVALID_RESPONSE' });
  assert.equal(normalizeCloudResult({ ...CLOUD_RESULT, components: [{ ...CLOUD_RESULT.components[0], confidence: 0.4 }] }).components[0].route, 'unknown');
});

test('provider responses are validated and provider error details are never propagated', async () => {
  const env = { GEMINI_API_KEY: 'test-placeholder', FREE_TIER_ONLY: '1' };
  const analysis = await analyzeWithGemini({ image: JPEG, language: 'en' }, env, {
    fetchImpl: async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(CLOUD_RESULT) }] } }] })
  });
  assert.equal(analysis.source, 'online');
  await assert.rejects(() => analyzeWithGemini({ image: JPEG, language: 'en' }, env, {
    fetchImpl: async () => new Response('Sensitive provider diagnostic must never be returned', { status: 403 })
  }), error => error.code === 'PROVIDER_UNAVAILABLE' && !error.message.includes('Sensitive'));
  await assert.rejects(() => analyzeWithGemini({ image: JPEG, language: 'en' }, env, {
    fetchImpl: async () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] })
  }), { code: 'INVALID_RESPONSE' });
});

test('local HTTP contract serves files, protects private paths and rejects cross-site requests', async t => {
  const root = await temporaryRoot(t);
  await fs.writeFile(path.join(root, 'index.html'), '<h1>EcoLens</h1>');
  const server = createEcolensServer({ rootDir: root, env: {} });
  assert.equal((await requestInProcess(server)).status, 200);
  assert.equal((await requestInProcess(server, { method: 'HEAD' })).body, '');
  assert.equal(JSON.parse((await requestInProcess(server, { url: '/api/status' })).body).available, false);
  assert.equal((await requestInProcess(server, { url: '/.ecolens/quota.json' })).status, 404);
  assert.equal((await requestInProcess(server, { url: '/%2e%2e/server.mjs' })).status, 404);
  assert.equal((await requestInProcess(server, { headers: { host: 'untrusted.example' } })).status, 403);
  const denied = await requestInProcess(server, { url: '/api/analyze', method: 'POST', headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 403);
  assert.equal(JSON.parse(denied.body).error.code, 'ORIGIN_DENIED');
  const unconfigured = await requestInProcess(server, { url: '/api/analyze', method: 'POST', headers: { origin: 'http://127.0.0.1:8787', 'content-type': 'application/json' }, body: JSON.stringify({ image: JPEG }) });
  assert.equal(unconfigured.status, 503);
  assert.equal(JSON.parse(unconfigured.body).error.code, 'NOT_CONFIGURED');
});

test('configured local gateway consumes the exact browser image/language contract', async t => {
  const root = await temporaryRoot(t);
  let providerPayload;
  const server = createEcolensServer({ rootDir: root, env: { GEMINI_API_KEY: 'test-placeholder', FREE_TIER_ONLY: '1' },
    fetchImpl: async (_url, options) => {
      providerPayload = JSON.parse(options.body);
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(CLOUD_RESULT) }] } }] });
    }
  });
  const result = await requestInProcess(server, { url: '/api/analyze', method: 'POST', headers: { origin: 'http://127.0.0.1:8787', 'content-type': 'application/json' }, body: JSON.stringify({ image: JPEG, language: 'bn' }) });
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).source, 'online');
  assert.equal(providerPayload.contents[0].parts[1].inlineData.data, JPEG);
  assert.match(providerPayload.contents[0].parts[0].text, /Bengali/);
  assert.equal(result.headers['Access-Control-Allow-Origin'], 'http://127.0.0.1:8787');
});

test('local server serves expected extensionless COCO shards and rejects other extensionless files', async t => {
  const root = await temporaryRoot(t);
  const modelDirectory = path.join(root, 'models', 'coco');
  await fs.mkdir(modelDirectory, { recursive: true });
  await fs.writeFile(path.join(modelDirectory, 'group1-shard1of5'), 'model-weight-fixture');
  await fs.writeFile(path.join(modelDirectory, 'group1-shard6of5'), 'unexpected-fixture');
  await fs.writeFile(path.join(root, 'extensionless-private'), 'private-fixture');
  const server = createEcolensServer({ rootDir: root, env: {} });
  const shard = await requestInProcess(server, { url: '/models/coco/group1-shard1of5' });
  assert.equal(shard.status, 200);
  assert.equal(shard.headers['Content-Type'], 'application/octet-stream');
  assert.equal(shard.body, 'model-weight-fixture');
  const head = await requestInProcess(server, { url: '/models/coco/group1-shard1of5', method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers['Content-Length'], Buffer.byteLength('model-weight-fixture'));
  assert.equal(head.body, '');
  assert.equal((await requestInProcess(server, { url: '/models/coco/group1-shard6of5' })).status, 404);
  assert.equal((await requestInProcess(server, { url: '/extensionless-private' })).status, 404);
});

test('local daily caps survive limiter restarts and concurrent reservations', async t => {
  const root = await temporaryRoot(t);
  const first = createLocalQuota(root, { DAILY_SCAN_LIMIT: '1' });
  const attempts = await Promise.allSettled([first('student-a'), first('student-b')]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.code, 'DAILY_LIMIT');
  const restarted = createLocalQuota(root, { DAILY_SCAN_LIMIT: '1' });
  await assert.rejects(() => restarted('student-c'), { code: 'DAILY_LIMIT' });
});

test('worker requires durable quota storage and Durable Object rejects a reached daily cap', async () => {
  const stored = new Map();
  const state = { blockConcurrencyWhile: callback => callback(), storage: { get: async key => stored.get(key), put: async (key, value) => stored.set(key, value) } };
  const quota = new EcoLensQuota(state, { DAILY_SCAN_LIMIT: '1' });
  const first = await quota.fetch(new Request('https://internal/reserve', { method: 'POST', body: JSON.stringify({ ip: 'student-a' }) }));
  const second = await quota.fetch(new Request('https://internal/reserve', { method: 'POST', body: JSON.stringify({ ip: 'student-b' }) }));
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal((await second.json()).code, 'DAILY_LIMIT');
  const status = await worker.fetch(new Request('https://worker.example/api/status'), { GEMINI_API_KEY: 'test-placeholder', FREE_TIER_ONLY: '1' });
  assert.equal((await status.json()).reason, 'QUOTA_STORAGE_REQUIRED');
  const denied = await worker.fetch(new Request('https://worker.example/api/analyze', { method: 'POST', headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' }, body: '{}' }), {});
  assert.equal(denied.status, 403);
});
