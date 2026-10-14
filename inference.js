/* Local image inference. All weights and runtimes are served by this application. */
export const WASTE_LABELS = Object.freeze(['bag', 'cardboard', 'furniture', 'glass', 'metal', 'paper', 'plastic', 'yard']);
export const ROUTES = Object.freeze(['organic', 'recycle', 'ewaste', 'residual', 'inert', 'unknown', 'nonwaste']);
const INPUT_SIZE = 640;
let session = null;
let cocoModel = null;
let initialization = null;
let helperWarning = '';
let running = false;
let currentScanFinished = Promise.resolve();
let modelLoading = null;
let helperLoading = null;
let warming = null;
let warmed = false;
let offlineTasks = Promise.resolve();
let preprocessingCanvas = null;
let preprocessingContext = null;
let preprocessingData = null;
let helperCanvas = null;
const runtimeScripts = new Map();
const progressListeners = new Set();
let lastProgress = { stage: 'idle', progress: 0 };
let workerFallback = false;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError');
}
function progress(callback, stage, fraction) {
  callback?.({ stage, progress: fraction });
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function now() { return globalThis.performance?.now?.() ?? Date.now(); }
function emitProgress(stage, fraction) {
  lastProgress = { stage, progress: fraction };
  for (const callback of progressListeners) {
    // A rendering callback must not prevent other consumers from loading AI.
    try { callback(lastProgress); } catch { /* UI owns rendering failures. */ }
  }
}
function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const cancel = () => {
      signal.removeEventListener('abort', cancel);
      reject(new DOMException('Scan cancelled.', 'AbortError'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
function enqueueOfflineTask(task) {
  const next = offlineTasks.then(task);
  offlineTasks = next.catch(() => {});
  return next;
}
function yieldForPaint() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      const timer = setTimeout(resolve, 50); // Background tabs may pause animation frames.
      requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
    } else setTimeout(resolve, 0);
  });
}

// Runtime code is local and only evaluated when the scanner is prepared.
// Failed script loads are removed from the cache so an offline download can be retried.
function loadRuntimeScript(file, { reload = false } = {}) {
  if (!reload && runtimeScripts.has(file)) return runtimeScripts.get(file);
  if (!globalThis.document?.head?.appendChild) {
    return Promise.reject(fail('RUNTIME_MISSING', 'The offline runtime is unavailable. Open EcoLens once while connected to finish the offline download.'));
  }
  const pending = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(`./vendor/${file}`, import.meta.url).href;
    script.async = true;
    const timer = setTimeout(() => finish(fail('RUNTIME_MISSING', 'The offline runtime download took too long. Finish preparing offline mode and retry.')), 20000);
    function finish(error) {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error) { script.remove?.(); reject(error); }
      else resolve();
    }
    script.onload = () => finish();
    script.onerror = () => finish(fail('RUNTIME_MISSING', 'The offline runtime is unavailable. Finish preparing offline mode and retry.'));
    try { document.head.appendChild(script); }
    catch { finish(fail('RUNTIME_MISSING', 'This browser could not load the offline runtime. Try preparing offline mode again.')); }
  });
  runtimeScripts.set(file, pending);
  pending.catch(() => { if (runtimeScripts.get(file) === pending) runtimeScripts.delete(file); });
  return pending;
}

export function getOfflineStatus() {
  return {
    ready: Boolean(session), helperReady: Boolean(cocoModel),
    loading: Boolean(initialization), warming: Boolean(warming), warmed, busy: running,
    worker: Boolean(globalThis.ort?.env?.wasm?.proxy) && !workerFallback,
    warning: helperWarning, stage: lastProgress.stage
  };
}

export function letterboxGeometry(width, height, size = INPUT_SIZE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || size <= 0) {
    throw fail('INVALID_IMAGE', 'Choose a valid image before scanning.');
  }
  const scale = Math.min(size / width, size / height);
  const resizedWidth = Math.max(1, Math.round(width * scale));
  const resizedHeight = Math.max(1, Math.round(height * scale));
  return {
    width, height, size, scale, resizedWidth, resizedHeight,
    left: Math.max(0, Math.round((size - resizedWidth) / 2 - 0.1)),
    top: Math.max(0, Math.round((size - resizedHeight) / 2 - 0.1))
  };
}

export function rgbaToPlanarRGB(rgba, width, height, destination) {
  const pixels = width * height;
  if (rgba.length !== pixels * 4) throw fail('INVALID_IMAGE', 'The image pixel data is incomplete.');
  const tensor = destination?.length === pixels * 3 ? destination : new Float32Array(pixels * 3);
  for (let index = 0; index < pixels; index++) {
    tensor[index] = rgba[index * 4] / 255;
    tensor[pixels + index] = rgba[index * 4 + 1] / 255;
    tensor[pixels * 2 + index] = rgba[index * 4 + 2] / 255;
  }
  return tensor;
}

function prepareImage(canvas) {
  const geometry = letterboxGeometry(canvas.width, canvas.height);
  if (!preprocessingCanvas) {
    preprocessingCanvas = document.createElement('canvas');
    preprocessingCanvas.width = preprocessingCanvas.height = INPUT_SIZE;
    preprocessingContext = preprocessingCanvas.getContext('2d', { willReadFrequently: true });
  }
  const context = preprocessingContext;
  if (!context) throw fail('INVALID_IMAGE', 'This browser could not prepare the image. Try uploading a photo.');
  context.fillStyle = 'rgb(114,114,114)';
  context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  context.drawImage(canvas, geometry.left, geometry.top, geometry.resizedWidth, geometry.resizedHeight);
  // ORT's proxy transfers the input buffer to its worker. Reuse only an attached
  // buffer; a transferred buffer must be allocated again on the next scan.
  preprocessingData = rgbaToPlanarRGB(context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data, INPUT_SIZE, INPUT_SIZE, preprocessingData);
  return { geometry, data: preprocessingData };
}

function prepareHelperImage(canvas) {
  const scale = Math.min(1, INPUT_SIZE / Math.max(canvas.width, canvas.height));
  if (scale === 1) return { canvas, scale: 1 };
  if (!helperCanvas) helperCanvas = document.createElement('canvas');
  helperCanvas.width = Math.max(1, Math.round(canvas.width * scale));
  helperCanvas.height = Math.max(1, Math.round(canvas.height * scale));
  const context = helperCanvas.getContext('2d');
  if (!context) throw fail('INVALID_IMAGE', 'This browser could not prepare the object image.');
  context.drawImage(canvas, 0, 0, helperCanvas.width, helperCanvas.height);
  return { canvas: helperCanvas, scaleX: helperCanvas.width / canvas.width, scaleY: helperCanvas.height / canvas.height };
}

export function boxIoU(a, b) {
  const overlapWidth = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const overlapHeight = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const intersection = overlapWidth * overlapHeight;
  const union = a.w * a.h + b.w * b.h - intersection;
  return union > 0 ? intersection / union : 0;
}

export function nonMaximumSuppression(detections, threshold = 0.45, limit = 20) {
  const candidates = detections.slice().sort((a, b) => b.confidence - a.confidence);
  const selected = [];
  for (const candidate of candidates) {
    const duplicate = selected.find(item => {
      const overlap = boxIoU(item.bbox, candidate.bbox);
      if (item.name === candidate.name) return overlap > threshold;
      // Different material labels on almost identical boxes are conflicting
      // predictions for one item. Lower overlap can be two adjacent/stacked
      // objects, so it must not remove a visible component from a group scan.
      const widthRatio = Math.min(item.bbox.w, candidate.bbox.w) / Math.max(item.bbox.w, candidate.bbox.w);
      const heightRatio = Math.min(item.bbox.h, candidate.bbox.h) / Math.max(item.bbox.h, candidate.bbox.h);
      return overlap > 0.85 && widthRatio > 0.9 && heightRatio > 0.9;
    });
    if (!duplicate) selected.push({
      ...candidate, bbox: { ...candidate.bbox },
      ...(candidate.materialCandidates ? { materialCandidates: candidate.materialCandidates.map(guess => ({ ...guess })) } : {}),
      ...(candidate.candidateMaterials ? { candidateMaterials: [...candidate.candidateMaterials] } : {})
    });
    else if (duplicate.name !== candidate.name) {
      const guesses = duplicate.materialCandidates || [{ material: duplicate.material, confidence: duplicate.confidence }];
      for (const guess of candidate.materialCandidates || [{ material: candidate.material, confidence: candidate.confidence }]) {
        if (guess.material !== 'unknown' && !guesses.some(item => item.material === guess.material)) guesses.push({ ...guess });
      }
      duplicate.name = 'Item with uncertain material';
      duplicate.material = 'unknown';
      duplicate.route = 'unknown';
      duplicate.requiresMaterialConfirmation = true;
      duplicate.materialCandidates = guesses;
      duplicate.candidateMaterials = guesses.map(item => item.material).filter(item => item !== 'unknown');
      duplicate.advice = 'Conflicting material guesses refer to this same item. Check its material before sorting.';
    }
    if (selected.length >= limit) break;
  }
  return selected;
}

function float16ToNumber(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function describeWaste(name, ambiguous = false) {
  if (ambiguous) return { material: 'unknown', route: 'unknown', requiresMaterialConfirmation: true, advice: 'The material is uncertain. Confirm it manually before choosing a bin.' };
  const choices = {
    yard: { material: 'plant matter', route: 'organic', advice: 'Remove plastic ties or pots. Use the campus organics collection if accepted.' },
    cardboard: { material: 'cardboard', route: 'recycle', advice: 'Flatten clean, dry cardboard. Separate food-soiled sections and follow campus collection rules.' },
    paper: { material: 'paper', route: 'recycle', advice: 'Keep clean paper dry. Tissues and heavily soiled paper need manual confirmation.' },
    glass: { material: 'glass', route: 'recycle', advice: 'Empty the container. Confirm that campus collection accepts glass; flag broken glass for staff.' },
    metal: { material: 'metal', route: 'recycle', advice: 'Empty and clean packaging. Batteries, sharp scrap and pressurized cans need separate staff guidance.' },
    plastic: { material: 'plastic', route: 'unknown', advice: 'The local model cannot distinguish accepted rigid plastic from multilayer wrappers. Confirm the plastic type and campus collection before selecting a bin.' },
    bag: { material: 'unknown', route: 'unknown', advice: 'A bag can be plastic, fabric or paper. Choose its material manually and empty any contents.' },
    furniture: { material: 'mixed or unknown', route: 'unknown', advice: 'Furniture needs repair, reuse or a campus bulk-waste collection. Do not place it in a small sorting bin.' }
  };
  return choices[name] || { material: 'unknown', route: 'unknown', advice: 'Confirm the material manually.' };
}

export function decodeYoloOutput(output, geometry, scoreThreshold = 0.4, { scene = 'single' } = {}) {
  const dimensions = output.dims;
  if (!Array.isArray(dimensions) || dimensions.length !== 3 || dimensions[0] !== 1 || dimensions[1] !== 12) {
    throw fail('MODEL_SHAPE', 'The local model has an unexpected output shape.');
  }
  const count = dimensions[2];
  const values = output.data;
  if (!values || values.length !== 12 * count) throw fail('MODEL_SHAPE', 'The local model output is incomplete.');
  const read = output.type === 'float16' && values instanceof Uint16Array
    ? (channel, index) => float16ToNumber(values[channel * count + index])
    : (channel, index) => Number(values[channel * count + index]);
  const detections = [];
  for (let index = 0; index < count; index++) {
    let bestClass = 0, bestScore = -Infinity, secondScore = -Infinity;
    for (let classIndex = 0; classIndex < WASTE_LABELS.length; classIndex++) {
      const score = read(classIndex + 4, index);
      if (score > bestScore) { secondScore = bestScore; bestScore = score; bestClass = classIndex; }
      else if (score > secondScore) secondScore = score;
    }
    if (!Number.isFinite(bestScore) || bestScore < scoreThreshold || bestScore > 1.001) continue;
    const centerX = read(0, index), centerY = read(1, index), width = read(2, index), height = read(3, index);
    if (![centerX, centerY, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    const x1 = clamp((centerX - width / 2 - geometry.left) / geometry.scale, 0, geometry.width);
    const y1 = clamp((centerY - height / 2 - geometry.top) / geometry.scale, 0, geometry.height);
    const x2 = clamp((centerX + width / 2 - geometry.left) / geometry.scale, 0, geometry.width);
    const y2 = clamp((centerY + height / 2 - geometry.top) / geometry.scale, 0, geometry.height);
    const bbox = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    if (bbox.w * bbox.h < geometry.width * geometry.height * (scene === 'group' ? 0.003 : 0.006)) continue;
    const name = WASTE_LABELS[bestClass];
    const ambiguous = bestScore < 0.55 || bestScore - secondScore < 0.08;
    const component = { name, confidence: clamp(bestScore, 0, 1), bbox, ...describeWaste(name, ambiguous) };
    if (ambiguous) component.materialCandidates = [{ material: name, confidence: component.confidence }];
    detections.push(component);
  }
  return nonMaximumSuppression(detections);
}

async function loadWasteModel() {
  if (session) return;
  if (modelLoading) return modelLoading;
  modelLoading = (async () => {
    emitProgress('loading-local-model', 0.12);
    if (!globalThis.ort?.InferenceSession) await loadRuntimeScript('ort.min.js');
    if (!globalThis.ort?.InferenceSession) throw fail('RUNTIME_MISSING', 'The offline runtime did not start. Finish preparing offline mode and retry.');
    const configure = proxy => {
      // One thread does not require cross-origin isolation, including on phones.
      globalThis.ort.env.wasm.numThreads = 1;
      globalThis.ort.env.wasm.proxy = proxy;
      globalThis.ort.env.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
    };
    const useWorker = typeof Worker !== 'undefined' && typeof document !== 'undefined' && !workerFallback;
    configure(useWorker);
    const create = () => globalThis.ort.InferenceSession.create(new URL('./models/custom-yolo/GarbageDetector.onnx', import.meta.url).href, {
      executionProviders: ['wasm'], graphOptimizationLevel: 'all'
    });
    try {
      session = await create();
    } catch (error) {
      if (!useWorker) throw fail('MODEL_UNAVAILABLE', 'The local waste model could not load. Finish the offline download and try again.');
      // CSP restrictions or Safari worker support can prevent the proxy from
      // starting. Reload ORT to clear its cached failed backend before retrying.
      workerFallback = true;
      emitProgress('loading-local-model', 0.25);
      try {
        if (globalThis.document?.head?.appendChild) await loadRuntimeScript('ort.min.js', { reload: true });
        configure(false);
        session = await create();
      } catch {
        throw fail('MODEL_UNAVAILABLE', 'The local waste model could not load. Finish the offline download and try again.');
      }
    }
    emitProgress('local-model-ready', cocoModel ? 0.95 : 0.6);
  })();
  try { await modelLoading; }
  finally { modelLoading = null; }
}

async function loadHelperModel() {
  if (cocoModel) return;
  if (helperLoading) return helperLoading;
  helperLoading = (async () => {
    emitProgress('loading-helper-model', 0.18);
    try {
      if (!globalThis.cocoSsd?.load) {
        if (!globalThis.tf) await loadRuntimeScript('tf.min.js');
        await loadRuntimeScript('coco-ssd.min.js');
      }
      if (!globalThis.cocoSsd?.load) throw fail('RUNTIME_MISSING', 'The object helper runtime did not start.');
      await globalThis.tf?.ready?.();
      // COCO's loader warms its own 300px input before resolving.
      cocoModel = await globalThis.cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: new URL('./models/coco/model.json', import.meta.url).href });
      helperWarning = '';
      emitProgress('helper-model-ready', session ? 0.95 : 0.55);
    } catch {
      helperWarning = 'The general-object helper is unavailable. The eight-class waste model is still active; food and electronics may need manual confirmation. Retry preparing the scanner once its offline assets are available.';
    }
  })();
  try { await helperLoading; }
  finally { helperLoading = null; }
}

export async function initOffline(callbackOrOptions) {
  const { onProgress, signal } = typeof callbackOrOptions === 'function'
    ? { onProgress: callbackOrOptions }
    : (callbackOrOptions || {});
  checkAbort(signal);
  if (typeof onProgress === 'function') progressListeners.add(onProgress);
  try {
    if (!initialization) {
      initialization = (async () => {
        // Runtime, model download and initialization overlap instead of making
        // every first scan wait for two full loading sequences.
        await Promise.all([loadWasteModel(), loadHelperModel()]);
        emitProgress('ready', 1);
        return getOfflineStatus();
      })();
      const current = initialization;
      current.finally(() => { if (initialization === current) initialization = null; }).catch(() => {});
    } else if (onProgress) {
      progress(onProgress, lastProgress.stage, lastProgress.progress);
    }
    const result = await waitWithSignal(initialization, signal);
    return { ...result, loading: false };
  } finally {
    progressListeners.delete(onProgress);
  }
}

export async function warmupOffline(callbackOrOptions, options = {}) {
  const settings = typeof callbackOrOptions === 'function'
    ? { ...options, onProgress: callbackOrOptions }
    : { ...(callbackOrOptions || {}), ...options };
  checkAbort(settings.signal);
  await initOffline(settings);
  if (warmed) return getOfflineStatus();
  if (typeof settings.onProgress === 'function') progressListeners.add(settings.onProgress);
  try {
    if (!warming) {
      warming = enqueueOfflineTask(async () => {
        emitProgress('warming-local-model', 0.9);
        await yieldForPaint();
        const tensor = new globalThis.ort.Tensor('float32', new Float32Array(INPUT_SIZE * INPUT_SIZE * 3), [1, 3, INPUT_SIZE, INPUT_SIZE]);
        let outputs;
        try {
          outputs = await session.run({ [session.inputNames[0]]: tensor });
          warmed = true;
        } catch {
          throw fail('INFERENCE_FAILED', 'The local model could not warm up. Try preparing the scanner again.');
        } finally {
          tensor.dispose?.();
          for (const value of Object.values(outputs || {})) value.dispose?.();
        }
        emitProgress('ready', 1);
        return getOfflineStatus();
      });
      const current = warming;
      current.finally(() => { if (warming === current) warming = null; }).catch(() => {});
    }
    const result = await waitWithSignal(warming, settings.signal);
    return { ...result, warming: false };
  } finally {
    progressListeners.delete(settings.onProgress);
  }
}

const FOOD = new Set(['banana', 'apple', 'orange', 'broccoli', 'carrot', 'sandwich', 'hot dog', 'pizza', 'donut', 'cake']);
const ELECTRONICS = new Set(['cell phone', 'laptop', 'keyboard', 'mouse', 'remote', 'tv']);
const NONWASTE = new Set(['person', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'car', 'bus', 'truck', 'train', 'motorcycle', 'bicycle', 'airplane', 'boat']);
const CONTAINERS = new Set(['bottle', 'cup', 'bowl']);
const CONTAINER_NAME = /\b(bottles?|flasks?|thermos(?:es)?|tumblers?|cups?|bowls?|containers?)\b|বোতল|পাত্র|কাপ|बोतल|पात्र|कप/i;

function unverifiedContainer(component, guesses = []) {
  return {
    ...component, material: 'unknown', route: 'unknown',
    requiresMaterialConfirmation: true, reusable: true,
    candidateMaterials: ['metal', 'plastic', 'glass', 'paper'],
    ...(guesses.length ? { materialCandidates: guesses } : {}),
    advice: 'Reuse if intact. If discarded, confirm its actual material; empty and separate visible parts before sorting.'
  };
}

export function helperComponents(predictions, width, height, { scene = 'single', includeNonwaste = scene !== 'group' } = {}) {
  const components = [];
  for (const prediction of predictions) {
    const [x, y, w, h] = prediction.bbox || [];
    if (![x, y, w, h, prediction.score].every(Number.isFinite) || prediction.score < 0.6 || w <= 0 || h <= 0) continue;
    const cx = (x + w / 2) / width, cy = (y + h / 2) / height;
    // Group scans use the entire image. Single scans favor the selected target;
    // neither mode tries to infer contents hidden inside a bag/container.
    if (scene !== 'group' && (cx < 0.1 || cx > 0.9 || cy < 0.1 || cy > 0.9)) continue;
    if (w * h / (width * height) < (scene === 'group' ? 0.003 : 0.015)) continue;
    const x1 = clamp(x, 0, width), y1 = clamp(y, 0, height);
    const x2 = clamp(x + w, 0, width), y2 = clamp(y + h, 0, height);
    if (x2 <= x1 || y2 <= y1) continue;
    const base = { name: prediction.class, confidence: prediction.score, bbox: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } };
    if (FOOD.has(prediction.class)) components.push({ ...base, material: 'food', route: 'organic', advice: 'Confirm this is discarded food. Remove packaging before the campus organics collection.' });
    else if (ELECTRONICS.has(prediction.class)) components.push({ ...base, material: 'electronics', route: 'ewaste', advice: 'Confirm it is being discarded. Keep devices and batteries out of ordinary bins; use the campus e-waste collection.' });
    else if (prediction.class === 'book') components.push({ ...base, material: 'paper', route: 'recycle', advice: 'Prefer donation or reuse. Remove non-paper covers if the book must be recycled.' });
    else if (CONTAINERS.has(prediction.class)) components.push(unverifiedContainer(base));
    else if (includeNonwaste && NONWASTE.has(prediction.class)) components.push({ ...base, material: 'not waste', route: 'nonwaste', advice: 'This appears to be a person, animal or vehicle. Aim the scan at the discarded item.' });
  }
  return components;
}

export async function analyzeOffline(canvas, { signal, onProgress, onPartialResult, queue = false, scene = 'single' } = {}) {
  scene = scene === 'group' ? 'group' : 'single';
  checkAbort(signal);
  while (running) {
    if (!queue) throw fail('SCAN_BUSY', 'Wait for the current scan to finish.');
    // A cancelled ORT/TF operation must drain before another image can reuse
    // the tensor and canvases. Waiting is cancellable without interrupting it.
    await waitWithSignal(currentScanFinished, signal);
    checkAbort(signal);
  }
  running = true;
  let finishScan;
  currentScanFinished = new Promise(resolve => { finishScan = resolve; });
  const started = now();
  try {
    await initOffline({ onProgress, signal });
    return await enqueueOfflineTask(async () => {
      checkAbort(signal);
      progress(onProgress, 'preparing-image', 0.2);
      await yieldForPaint();
      checkAbort(signal);
      const prepareStarted = now();
      const { geometry, data } = prepareImage(canvas);
      const timing = { preprocessMs: Math.round(now() - prepareStarted), inferenceMs: 0, helperMs: 0 };
      const warnings = ['Offline model scores are estimates, not a measured accuracy guarantee. Confirm the material and campus collection rules.'];
      if (helperWarning) warnings.push(helperWarning);
      progress(onProgress, 'detecting-materials', 0.45);
      let helperFinished = !cocoModel;
      const detectMaterials = async () => {
        const modelStarted = now();
        const tensor = new globalThis.ort.Tensor('float32', data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
        let output, detections;
        try {
          output = await session.run({ [session.inputNames[0]]: tensor });
          detections = decodeYoloOutput(output[session.outputNames[0]], geometry, 0.4, { scene });
        } catch (error) {
          if (error.code === 'MODEL_SHAPE') throw error;
          throw fail('INFERENCE_FAILED', 'The offline model could not analyse this image. Try a smaller or clearer image.');
        } finally {
          timing.inferenceMs = Math.round(now() - modelStarted);
          tensor.dispose?.();
          for (const value of Object.values(output || {})) value.dispose?.();
        }
        if (typeof onPartialResult === 'function' && detections.length && !helperFinished && !signal?.aborted) {
          // Preview only copied material data. The helper may still replace a
          // glass false positive with food/electronics or reject a person.
          const preview = {
            source: 'offline', scene, uncertain: true,
            components: detections.map(component => ({
              ...component, bbox: { ...component.bbox },
              ...(component.materialCandidates ? { materialCandidates: component.materialCandidates.map(guess => ({ ...guess })) } : {}),
              ...(component.candidateMaterials ? { candidateMaterials: [...component.candidateMaterials] } : {})
            })),
            warnings: [...warnings, 'Checking food, electronics and background objects. Wait for the complete result before confirming disposal.']
          };
          try { onPartialResult(preview); } catch { /* A preview rendering failure must not discard final AI checks. */ }
          await yieldForPaint();
        }
        return detections;
      };
      const detectObjects = async () => {
        if (!cocoModel) return [];
        const helperStarted = now();
        try {
          const prepared = prepareHelperImage(canvas);
          const predictions = await cocoModel.detect(prepared.canvas, 20, 0.55);
          const scaleX = prepared.scaleX ?? 1, scaleY = prepared.scaleY ?? 1;
          return helperComponents(predictions.map(prediction => ({
            ...prediction,
            bbox: prediction.bbox?.map((value, index) => value / (index % 2 === 0 ? scaleX : scaleY))
          })), canvas.width, canvas.height, { scene, includeNonwaste: true });
        } finally {
          timing.helperMs = Math.round(now() - helperStarted);
          helperFinished = true;
        }
      };
      // WASM's worker and TF's graphics backend can work concurrently. Always
      // await both: food/electronics checks and person rejection still apply.
      const [materials, objects] = await Promise.allSettled([detectMaterials(), detectObjects()]);
      checkAbort(signal);
      if (materials.status === 'rejected') throw materials.reason;
      warmed = true;
      let components = scene === 'group' ? materials.value.filter(component => component.name !== 'furniture') : materials.value;
      const helperUnavailable = !cocoModel || objects.status === 'rejected';
      if (objects.status === 'rejected') {
        warnings.push('The object helper could not analyse this image. Material detections remain available, but confirm every material manually before sorting.');
      } else {
        for (const helper of objects.value) {
          const overlap = components.findIndex(component => boxIoU(component.bbox, helper.bbox) > 0.4);
          if (overlap >= 0) {
            if (helper.route === 'organic' || helper.route === 'ewaste') components[overlap] = helper;
            else if (helper.requiresMaterialConfirmation) {
              // COCO recognizes the shape, not the material. A confident glass
              // or plastic waste-model label must not overrule this ambiguity.
              const material = components[overlap];
              const guesses = material.materialCandidates || [{ material: material.material, confidence: material.confidence }];
              components[overlap] = unverifiedContainer(helper, guesses);
            }
            else if (helper.route === 'nonwaste' && helper.confidence >= 0.85 && boxIoU(components[overlap].bbox, helper.bbox) > 0.7) {
              // Reject a material false positive on the same person/animal/vehicle.
              // Small waste held in someone's hand has much lower box overlap.
              components.splice(overlap, 1);
              if (components.length === 0 && scene !== 'group') components.push(helper);
            }
          } else if (helper.route !== 'nonwaste' || (components.length === 0 && scene !== 'group')) components.push(helper);
        }
      }
      // Background people must never create a mixed-waste checklist alongside waste.
      if (components.some(component => component.route !== 'nonwaste')) components = components.filter(component => component.route !== 'nonwaste');
      if (!components.length) {
        components.push({ name: 'Unidentified item', material: 'unknown', route: 'unknown', confidence: 0, advice: 'Retake a close, well-lit photo or select the material manually. The offline model does not cover every waste type.' });
      }
      progress(onProgress, 'complete', 1);
      timing.totalMs = Math.round(now() - started);
      const needsHelperConfirmation = helperUnavailable && components.some(component => component.route !== 'nonwaste');
      if (needsHelperConfirmation) {
        components = components.map(component => component.route === 'nonwaste' ? component : {
          ...component, material: 'unknown', route: 'unknown', requiresMaterialConfirmation: true,
          materialCandidates: component.materialCandidates || (component.material !== 'unknown' ? [{ material: component.material, confidence: component.confidence }] : []),
          advice: 'Object checks are unavailable. Confirm the actual material and whether this item is discarded before sorting.'
        });
      }
      if (needsHelperConfirmation && objects.status !== 'rejected') {
        warnings.push('The object helper is unavailable. Confirm every material manually; food, electronics and background objects could not be checked.');
      }
      return { source: 'offline', scene, components: components.slice(0, 20), warnings, uncertain: needsHelperConfirmation || components.some(component => component.requiresMaterialConfirmation || component.route === 'unknown' || component.confidence < 0.55), timing };
    });
  } finally { running = false; finishScan(); }
}

export function validateOnlineResult(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.components) || raw.components.length < 1 || raw.components.length > 20) {
    throw fail('INVALID_RESPONSE', 'The online analyser returned an invalid result.');
  }
  const components = raw.components.map(component => {
    if (!component || typeof component.name !== 'string' || typeof component.material !== 'string' || !ROUTES.includes(component.route) || !Number.isFinite(component.confidence) || component.confidence < 0 || component.confidence > 1) {
      throw fail('INVALID_RESPONSE', 'The online analyser returned an invalid component.');
    }
    const result = { name: component.name.slice(0, 100), material: component.material.slice(0, 100), route: component.confidence < 0.55 && component.route !== 'nonwaste' ? 'unknown' : component.route, confidence: component.confidence };
    for (const flag of ['requiresMaterialConfirmation', 'reusable']) {
      if (component[flag] !== undefined && typeof component[flag] !== 'boolean') throw fail('INVALID_RESPONSE', 'The online analyser returned an invalid material flag.');
      if (typeof component[flag] === 'boolean') result[flag] = component[flag];
    }
    if (component.candidateMaterials !== undefined) {
      if (!Array.isArray(component.candidateMaterials) || component.candidateMaterials.length > 6 || component.candidateMaterials.some(value => typeof value !== 'string' || value.length > 100)) throw fail('INVALID_RESPONSE', 'The online analyser returned invalid material candidates.');
      result.candidateMaterials = [...new Set(component.candidateMaterials)];
    }
    if (component.materialCandidates !== undefined) {
      if (!Array.isArray(component.materialCandidates) || component.materialCandidates.length > 6 || component.materialCandidates.some(value => !value || typeof value.material !== 'string' || value.material.length > 100 || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1)) throw fail('INVALID_RESPONSE', 'The online analyser returned invalid material candidates.');
      result.materialCandidates = component.materialCandidates.map(value => ({ material: value.material, confidence: value.confidence }));
    }
    if (typeof component.advice === 'string') result.advice = component.advice.slice(0, 600);
    if (component.bbox && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(component.bbox[key])) && component.bbox.w > 0 && component.bbox.h > 0) result.bbox = component.bbox;
    if (result.requiresMaterialConfirmation || CONTAINER_NAME.test(result.name)) {
      result.materialCandidates ||= result.material !== 'unknown' ? [{ material: result.material, confidence: result.confidence }] : [];
      result.requiresMaterialConfirmation = true;
      result.material = 'unknown';
      result.route = 'unknown';
      if (CONTAINER_NAME.test(result.name)) {
        result.reusable = true;
        result.candidateMaterials ||= ['metal', 'plastic', 'glass', 'paper'];
      }
    }
    return result;
  });
  return {
    source: 'online', ...(raw.scene === 'group' ? { scene: 'group' } : {}), components,
    warnings: (Array.isArray(raw.warnings) ? raw.warnings.filter(item => typeof item === 'string').slice(0, 8).map(item => item.slice(0, 600)) : []),
    uncertain: Boolean(raw.uncertain) || components.some(component => component.requiresMaterialConfirmation || component.route === 'unknown' || component.confidence < 0.55)
  };
}

export async function analyzeOnline(canvas, { endpoint = './api/analyze', signal, language = 'en', timeoutMs = 12000, scene = 'single' } = {}) {
  scene = scene === 'group' ? 'group' : 'single';
  checkAbort(signal);
  const url = new URL(endpoint, location.href);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw fail('INSECURE_ENDPOINT', 'Use a secure HTTPS online endpoint or the local EcoLens server.');
  if (url.username || url.password) throw fail('INVALID_ENDPOINT', 'The online endpoint must not contain credentials.');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, clamp(Number(timeoutMs) || 12000, 1000, 60000));
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    let upload = canvas;
    const uploadEdge = scene === 'group' ? 1024 : 768;
    if (Number.isFinite(canvas.width) && Number.isFinite(canvas.height) && Math.max(canvas.width, canvas.height) > uploadEdge) {
      const scale = uploadEdge / Math.max(canvas.width, canvas.height);
      upload = document.createElement('canvas');
      upload.width = Math.max(1, Math.round(canvas.width * scale));
      upload.height = Math.max(1, Math.round(canvas.height * scale));
      const context = upload.getContext('2d');
      if (!context) throw fail('INVALID_IMAGE', 'This browser could not prepare an online photo.');
      context.drawImage(canvas, 0, 0, upload.width, upload.height);
    }
    const image = upload.toDataURL('image/jpeg', 0.84).split(',')[1];
    if (!image || image.length > 4_000_000) throw fail('IMAGE_TOO_LARGE', 'Use a smaller image for online analysis.');
    const response = await waitWithSignal(fetch(url.href, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
      body: JSON.stringify({ image, language: ['en', 'bn', 'hi'].includes(language) ? language : 'en', scene })
    }), controller.signal);
    const raw = await waitWithSignal(response.json().catch(() => null), controller.signal);
    if (!response.ok) {
      const allowedCodes = ['NOT_CONFIGURED', 'FREE_TIER_REQUIRED', 'QUOTA_STORAGE_REQUIRED', 'RATE_LIMIT', 'DAILY_LIMIT', 'PROVIDER_QUOTA', 'PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'INVALID_RESPONSE', 'INVALID_IMAGE', 'IMAGE_TOO_LARGE', 'ORIGIN_DENIED'];
      const code = allowedCodes.includes(raw?.error?.code) ? raw.error.code : 'ONLINE_UNAVAILABLE';
      const messages = {
        NOT_CONFIGURED: 'Online analysis has not been configured. Offline scanning is available.',
        FREE_TIER_REQUIRED: 'Online analysis is disabled until the server is explicitly configured for a free-tier project.',
        QUOTA_STORAGE_REQUIRED: 'The online server needs a durable quota limiter before it can accept scans.',
        RATE_LIMIT: 'Too many online scans. Wait a minute or use offline mode.',
        DAILY_LIMIT: 'The daily online scan allowance is reached. Use offline mode.',
        PROVIDER_QUOTA: 'The free online quota is unavailable or exhausted. Use offline mode.',
        PROVIDER_TIMEOUT: 'The online analyser took too long. Try again or use offline mode.',
        INVALID_RESPONSE: 'The online analyser could not return a reliable result.',
        ORIGIN_DENIED: 'This website is not allowed to use the configured online endpoint.'
      };
      throw fail(code, messages[code] || 'Online analysis is currently unavailable. Try offline mode.');
    }
    return { ...validateOnlineResult(raw), scene };
  } catch (error) {
    if (timedOut) throw fail('ONLINE_TIMEOUT', 'The online analyser took too long. Try again or use offline mode.');
    if (signal?.aborted) throw new DOMException('Scan cancelled.', 'AbortError');
    if (error.code) throw error;
    throw fail('ONLINE_UNAVAILABLE', 'Could not reach the online analyser. Check your connection or use offline mode.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
