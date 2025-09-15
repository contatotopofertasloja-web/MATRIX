// src/core/queue/dispatcher.js
// -----------------------------------------------------------------------------
// Dispatcher compatível com a base antiga do projeto.
// Mantém a mesma API (enqueueOutbox, startOutboxWorkers, stopOutboxWorkers, queueSize)
// porém delega para o controlador global criado em src/core/queue.js.
// -----------------------------------------------------------------------------

import { _getGlobalOutboxController } from '../queue.js';

// --------- helpers ----------
const isObj = (v) => v && typeof v === 'object' && !Buffer.isBuffer(v);

/** Converte o "content" legado em { kind, payload } aceito pelo outbox 2.0 */
function normalizeContent(content) {
  // Já no novo formato
  if (isObj(content) && (content.kind || content.payload)) {
    const kind = content.kind || 'text';
    const payload = content.payload || (isObj(content) ? { ...content } : { text: String(content ?? '') });
    return { kind, payload };
  }
  // Só texto
  if (!isObj(content)) return { kind: 'text', payload: { text: String(content ?? '') } };
  // Objeto simples sem "kind"
  if (content.imageUrl || content.url) {
    return { kind: 'image', payload: { url: content.imageUrl || content.url, caption: content.caption || '' } };
  }
  if (content.text) {
    return { kind: 'text', payload: { text: String(content.text) } };
  }
  // fallback
  return { kind: 'text', payload: { text: JSON.stringify(content) } };
}

// --------- API ----------
export async function enqueueOutbox({ topic, to, content, meta = {} }) {
  const ctrl = _getGlobalOutboxController();
  if (!ctrl || typeof ctrl.publish !== 'function') {
    throw new Error('enqueueOutbox: outbox não inicializado (createOutbox/start não chamados)');
  }
  if (!to) throw new Error('enqueueOutbox: "to" obrigatório');
  const { kind, payload } = normalizeContent(content);
  await ctrl.publish({ to, kind, payload, meta });
  return { ok: true, enqueued: true, topic: ctrl._topic || topic || 'default' };
}

// Compat: hoje o index já inicia os workers (createOutbox().start()).
export async function startOutboxWorkers(/* opts */) {
  return { ok: true, message: 'workers já iniciados pelo index (compat no-op)' };
}

export async function stopOutboxWorkers(/* topic */) {
  try {
    const ctrl = _getGlobalOutboxController();
    if (ctrl && typeof ctrl.stop === 'function') {
      await ctrl.stop();
      return { ok: true };
    }
    return { ok: false, error: 'outbox controller ausente' };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function queueSize(/* topic */) {
  try {
    const ctrl = _getGlobalOutboxController();
    if (!ctrl) return -1;
    return -1; // sem introspecção padrão (pode expor via ctrl no futuro)
  } catch {
    return -1;
  }
}

// ÚNICO default export
const api = { enqueueOutbox, startOutboxWorkers, stopOutboxWorkers, queueSize };
export default api;
