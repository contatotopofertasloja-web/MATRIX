// src/core/queue/dispatcher.js
import { _getGlobalOutboxController } from '../queue.js';

const isObj = (v) => v && typeof v === 'object' && !Buffer.isBuffer(v);

function normalizeContent(content) {
  if (isObj(content) && (content.kind || content.payload)) {
    const kind = content.kind || 'text';
    const payload = content.payload || (isObj(content) ? { ...content } : { text: String(content ?? '') });
    return { kind, payload };
  }
  if (!isObj(content)) return { kind: 'text', payload: { text: String(content ?? '') } };
  if (content.imageUrl || content.url) return { kind: 'image', payload: { url: content.imageUrl || content.url, caption: content.caption || '' } };
  if (content.audioBuffer) return { kind: 'audio', payload: { buffer: content.audioBuffer, mime: content.mime || 'audio/ogg', fallbackText: content.fallbackText || '' } };
  if (content.text) return { kind: 'text', payload: { text: String(content.text) } };
  return { kind: 'text', payload: { text: JSON.stringify(content) } };
}

export async function enqueueOutbox({ topic, to, content, meta = {} }) {
  const ctrl = _getGlobalOutboxController();
  if (!ctrl?.publish) throw new Error('enqueueOutbox: outbox não inicializado');
  if (!to) throw new Error('enqueueOutbox: "to" obrigatório');
  const { kind, payload } = normalizeContent(content);
  console.log(`[outbox/enqueue] topic=${topic} to=${to} kind=${kind} preview=${String(payload?.text||payload?.caption||"").slice(0,50)}`);
  await ctrl.publish({ to, kind, payload, meta: { ...(meta || {}) } });
}

export async function startOutboxWorkers(handler) {
  const ctrl = _getGlobalOutboxController();
  if (!ctrl?.start) throw new Error('startOutboxWorkers: outbox não inicializado');
  console.log("[outbox] iniciando workers…");
  await ctrl.start(handler);
}

export async function stopOutboxWorkers() {
  const ctrl = _getGlobalOutboxController();
  if (!ctrl?.stop) return;
  console.log("[outbox] parando workers…");
  await ctrl.stop();
}

export async function queueSize() {
  const ctrl = _getGlobalOutboxController();
  return ctrl?.size ? await ctrl.size() : 0;
}
