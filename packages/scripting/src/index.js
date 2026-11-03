/**
 * Availability experiment for TRUSTED LOCAL JavaScript snippets.
 * A same-origin worker is NOT a security boundary for untrusted projects.
 * @param {string} source JavaScript function body; no imports or TypeScript syntax.
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<unknown>}
 */
export function runIsolated(source, { timeoutMs = 1000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      reject(new Error('Timeout must be a positive finite number.'));
      return;
    }
    if (signal?.aborted) {
      reject(new Error('Script cancelled.'));
      return;
    }
    // The host owns the deadline. A busy worker cannot service its own timer.
    const bootstrap = `
      const send = self.postMessage.bind(self);
      self.onmessage = async ({ data }) => {
        try {
          const execute = new Function(data);
          const value = await execute();
          send({ ok: true, value });
        } catch (error) {
          send({ ok: false, message: String(error) });
        }
      };
    `;
    const url = URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }));
    /** @type {Worker | undefined} */
    let worker;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    let finished = false;
    /** @param {Error | null} error @param {unknown} [value] */
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker?.terminate();
      URL.revokeObjectURL(url);
      signal?.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve(value);
    };
    const cancel = () => finish(new Error('Script cancelled.'));
    try {
      worker = new Worker(url);
      worker.onmessage = ({ data }) => {
        if (data?.ok === true) finish(null, data.value);
        else finish(new Error(data?.message ?? 'Invalid script response.'));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(new Error(event.message || 'Worker failed.'));
      };
      worker.onmessageerror = () => finish(new Error('Script result could not be received.'));
      signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => finish(new Error(`Script exceeded ${timeoutMs} ms and was terminated.`)), timeoutMs);
      worker.postMessage(source);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Run a local JavaScript function body in a disposable opaque-origin iframe and
 * a nested worker. This is defense in depth for project scripts, not a complete
 * security boundary against browser bugs or memory exhaustion.
 * @param {string} source JavaScript function body; no imports or TypeScript syntax.
 * @param {{ timeoutMs?: number, signal?: AbortSignal, input?: unknown, maxSourceBytes?: number, maxPayloadBytes?: number, maxResultBytes?: number }} [options]
 * @returns {Promise<unknown>}
 */
export function runSandboxed(source, { timeoutMs = 1000, signal, input = null, maxSourceBytes = 256 * 1024, maxPayloadBytes = 256 * 1024, maxResultBytes = 256 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof source !== 'string') { reject(new TypeError('Script source must be a string.')); return; }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) { reject(new Error('Timeout must be a positive finite number.')); return; }
    if (![maxSourceBytes, maxPayloadBytes, maxResultBytes].every(value => Number.isSafeInteger(value) && value > 0)) { reject(new RangeError('Source, payload and result limits must be positive safe integers.')); return; }
    if (signal?.aborted) { reject(new Error('Script cancelled.')); return; }
    let inputJson;
    try {
      if (new TextEncoder().encode(source).byteLength > maxSourceBytes) throw new RangeError(`Script source exceeds ${maxSourceBytes} bytes.`);
      inputJson = JSON.stringify(input);
      if (inputJson === undefined) throw new TypeError('Script input must be JSON serializable.');
      if (new TextEncoder().encode(inputJson).byteLength > maxPayloadBytes) throw new RangeError(`Script input exceeds ${maxPayloadBytes} bytes.`);
    } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); return; }

    const frameDocument = `<!doctype html><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob: 'unsafe-eval'; worker-src blob:; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
      <script>
        (() => {
          let worker;
          let workerUrl;
          let resultLimit = 262144;
          const cleanup = () => { worker?.terminate(); if (workerUrl) URL.revokeObjectURL(workerUrl); worker = undefined; workerUrl = undefined; };
          addEventListener('pagehide', cleanup, { once: true });
          addEventListener('message', event => {
            if (event.source !== parent || event.data?.type !== 'run' || typeof event.data.source !== 'string') return;
            cleanup();
            resultLimit = event.data.maxResultBytes;
            const workerSource = "self.onmessage = async event => { try { const execute = new Function('input', event.data.source); const value = await execute(event.data.input); const json = value === undefined ? undefined : JSON.stringify(value); if (value !== undefined && json === undefined) throw new TypeError('Script result must be JSON serializable.'); if (json !== undefined && new TextEncoder().encode(json).byteLength > event.data.maxResultBytes) throw new RangeError('Script result exceeds ' + event.data.maxResultBytes + ' bytes.'); self.postMessage({ ok: true, json, undefinedValue: value === undefined }); } catch (error) { self.postMessage({ ok: false, message: String(error) + (error?.stack ? '\\\\n' + error.stack : '') }); } };";
            workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
            try {
              worker = new Worker(workerUrl);
              worker.onmessage = ({ data }) => {
                const validUndefined = data?.undefinedValue === true;
                const validJson = typeof data?.json === 'string' && new TextEncoder().encode(data.json).byteLength <= resultLimit;
                if (data?.ok === true && !validUndefined && !validJson) parent.postMessage({ type: 'result', ok: false, message: 'Sandbox returned an invalid or oversized result.' }, '*');
                else parent.postMessage({ type: 'result', ok: data?.ok === true, json: validJson ? data.json : undefined, undefinedValue: validUndefined, message: typeof data?.message === 'string' ? data.message.slice(0, 4096) : 'Sandbox script failed.' }, '*');
                cleanup();
              };
              worker.onerror = event => { event.preventDefault(); parent.postMessage({ type: 'result', ok: false, message: (event.message || 'Sandbox worker failed.').slice(0, 4096) }, '*'); cleanup(); };
              worker.onmessageerror = () => { parent.postMessage({ type: 'result', ok: false, message: 'Sandbox result could not be cloned.' }, '*'); cleanup(); };
              worker.postMessage({ source: event.data.source, input: event.data.input, maxResultBytes: event.data.maxResultBytes });
            } catch (error) {
              parent.postMessage({ type: 'result', ok: false, message: String(error) }, '*'); cleanup();
            }
          });
        })();
      <\/script>`;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'display:none;width:0;height:0;border:0';
    frame.srcdoc = frameDocument;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    let finished = false;
    /** @param {Error | null} error @param {unknown} [value] */
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      window.removeEventListener('message', onMessage);
      frame.remove(); // Removing the sandbox also destroys nested workers.
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(new Error('Script cancelled.'));
    /** @param {MessageEvent} event */
    const onMessage = event => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'result') return;
      if (event.data.ok === true) {
        if (event.data.undefinedValue === true) { finish(null, undefined); return; }
        if (typeof event.data.json !== 'string' || new TextEncoder().encode(event.data.json).byteLength > maxResultBytes) { finish(new Error('Sandbox returned an invalid or oversized result.')); return; }
        try { finish(null, JSON.parse(event.data.json)); }
        catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
      }
      else finish(new Error(event.data.message || 'Sandbox script failed.'));
    };
    try {
      window.addEventListener('message', onMessage);
      signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => finish(new Error(`Script exceeded ${timeoutMs} ms and the sandbox was terminated.`)), timeoutMs);
      document.body.append(frame);
      frame.addEventListener('load', () => frame.contentWindow?.postMessage({ type: 'run', source, input: JSON.parse(inputJson), maxResultBytes }, '*'), { once: true });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Create a Play-lifetime sandbox worker. Each invocation has its own host deadline; closing/cancelling destroys the opaque iframe and worker. */
/** @param {string} source @param {{ timeoutMs?: number, signal?: AbortSignal, maxSourceBytes?: number, maxPayloadBytes?: number, maxResultBytes?: number }} [options] */
export function createSandboxedSession(source, { timeoutMs = 500, signal, maxSourceBytes = 256 * 1024, maxPayloadBytes = 256 * 1024, maxResultBytes = 256 * 1024 } = {}) {
  if (typeof source !== 'string' || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes <= 0 || new TextEncoder().encode(source).byteLength > maxSourceBytes) throw new RangeError('Invalid or oversized sandbox source.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes <= 0 || !Number.isSafeInteger(maxResultBytes) || maxResultBytes <= 0) throw new RangeError('Session timeout and payload limits must be positive finite values.');
  if (signal?.aborted) throw new Error('Script cancelled.');
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('aria-hidden', 'true'); frame.style.cssText = 'display:none;width:0;height:0;border:0';
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob: 'unsafe-eval'; worker-src blob:; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><script>(()=>{let w,u,ready=false;const clean=()=>{w?.terminate();if(u)URL.revokeObjectURL(u)};addEventListener('pagehide',clean,{once:true});addEventListener('message',e=>{if(e.source!==parent)return;if(e.data?.type==='invoke'){w?.postMessage(e.data);return}if(e.data?.type!=='init'||ready)return;ready=true;const src="let run,source,max;self.onmessage=async e=>{if(e.data.type==='init'){source=e.data.source;max=e.data.maxResultBytes;return}try{run??=new Function('input',source);const v=await run(e.data.input);const json=JSON.stringify(v);if(json===undefined)throw Error('Non-JSON script result');if(new TextEncoder().encode(json).length>max)throw Error('Oversized script result');postMessage({type:'result',id:e.data.id,ok:true,json})}catch(x){postMessage({type:'result',id:e.data.id,ok:false,message:String(x?.stack||x)})}}";u=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));w=new Worker(u);w.onmessage=({data})=>parent.postMessage(data,'*');w.onerror=x=>parent.postMessage({type:'result',id:0,ok:false,message:x.message},'*');w.postMessage({type:'init',source:e.data.source,maxResultBytes:e.data.maxResultBytes})})})()<\/script>`;
  let id = 0, closed = false, busy = false;
  /** @type {(reason: Error) => void} */
  let rejectReady = () => {};
  const pending = new Map();
  const close = (reason = new Error('Script session closed.')) => {
    if (closed) return; closed = true; window.removeEventListener('message', receive); signal?.removeEventListener('abort', abort); frame.remove();
    rejectReady?.(reason);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(reason); } pending.clear();
  };
  const abort = () => close(new Error('Script cancelled.'));
  /** @param {MessageEvent} event */
  const receive = event => {
    if (event.source !== frame.contentWindow || event.data?.type !== 'result') return;
    const requestId = Number.isSafeInteger(event.data.id) ? event.data.id : pending.keys().next().value;
    const item = pending.get(requestId); if (!item) return;
    pending.delete(event.data.id); clearTimeout(item.timer); busy = false;
    if (event.data.ok && typeof event.data.json === 'string' && new TextEncoder().encode(event.data.json).byteLength <= maxResultBytes) { try { item.resolve(JSON.parse(event.data.json)); } catch (error) { item.reject(error); } }
    else { const error = new Error(event.data.message || 'Invalid sandbox response.'); item.reject(error); close(error); }
  };
  window.addEventListener('message', receive); signal?.addEventListener('abort', abort, { once: true });
  const ready = new Promise((resolve, reject) => {
    rejectReady = reject;
    const timer = setTimeout(() => { reject(new Error('Sandbox session failed to initialize.')); close(); }, 2000);
    frame.addEventListener('load', () => { clearTimeout(timer); if (!closed) { frame.contentWindow?.postMessage({ type: 'init', source, maxResultBytes }, '*'); resolve(undefined); } }, { once: true });
  });
  ready.catch(() => {});
  document.body.append(frame);
  return {
    /** @param {unknown} input */
    async invoke(input) {
      if (closed) throw new Error('Script session is closed.');
      if (busy) throw new Error('Script session invocations must be sequential.');
      if (signal?.aborted) throw new Error('Script cancelled.');
      const json = JSON.stringify(input);
      if (json === undefined || new TextEncoder().encode(json).byteLength > maxPayloadBytes) throw new RangeError('Invalid or oversized sandbox input.');
      await ready; busy = true; const requestId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); busy = false; const error = new Error(`Script exceeded ${timeoutMs} ms and was terminated.`); reject(error); close(error); }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        frame.contentWindow?.postMessage({ type: 'invoke', id: requestId, input: JSON.parse(json) }, '*');
      });
    },
    close,
  };
}

export { GraphExecutionBudgetError, runNodeGraph } from './node-graph.js';
export { ScriptBinding, scriptBindingSchema } from './binding.ts';
export { applyScriptCommandBuffer } from './command-buffer.ts';
export { VISUAL_NODE_KINDS, evaluateVisualGraph, graphPorts, validateVisualGraph } from './visual-graph.ts';
export { CODE_SCRIPT_ERROR_LINE_OFFSET, createCodeScriptSource } from './code-runner.js';
export { ScriptApiError, SCRIPT_LIFECYCLE_PHASES, createScriptApi, defineScriptDefinition, validateScriptProperties } from './api.ts';
