// src/core/queue/dispatcher.js
// -----------------------------------------------------------------------------
// Dispatcher compatível com o base antigo do projeto.
// Mantém a mesma API (enqueueOutbox, startOutboxWorkers, stopOutboxWorkers, queueSize)
// porém delega para o controlador global criado em src/core/queue.js.
// -----------------------------------------------------------------------------
//
// Por que assim?
// - O index atual cria o outbox via createOutbox() e já dá start() nos workers.
// - Este arquivo passa a ser um "shim" de compatibilidade para quem ainda
//   chama as funções do dispatcher antigo, sem quebrar a arquitetura 2.0.
//
// Exports:
//   enqueueOutbox({ topic, to, content, meta? })
//   startOutboxWorkers(opts)        // no-op (compat), retorna { ok: true }
//   stopOutboxWorkers(topic?)       // encerra workers do outbox global
//   queueSize(topic)                // -1 (mem) | tenta Redis quando disponível
//
// Obs: se no futuro você reativar o modelo "por tópico" via Redis puro,
//      dá para plugar aqui uma implementação por LIST/BRPOP sem tocar no index.
//

import { _getGlobalOutboxController } from '../queue.js';

// ------------- helpers -------------
const isObj = (v) => v && typeof v === 'object' && !Buffer.isBuffer(v);

/** Converte o "content" legado em { kind, payload } aceito pelo outbox 2.0 */
function normalizeContent(content) {
  // Se já vier no novo formato
  if (isObj(content) && (content.kind || content.payload)) {
    const kind = content.kind || 'text';
    const payload = content.payload || (isObj(content) ? { ...content } : { text: String(content ?? '') });
    return { kind, payload };
  }

  // Se vier só texto
  if (!isObj(content)) return { kind: 'text', payload: { text: String(content ?? '') } };

  // Se vier objeto simples sem "kind"
  // heurísticas mínimas:
  if (content.imageUrl || content.url) {
    return { kind: 'image', payload: { url: content.imageUrl || content.url, caption: content.caption || '' } };
  }
  if (content.text) {
    return { kind: 'text', payload: { text: String(content.text) } };
  }

  // fallback: vira texto com JSON
  return { kind: 'text', payload: { text: JSON.stringify(content) } };
}

// ------------- API -------------
// enqueueOutbox({ topic, to, content, meta? })
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

// startOutboxWorkers({...})
// Compatibilidade: hoje o index já inicia os workers (createOutbox().start()).
// Mantemos a função para não quebrar chamadas legadas.
export async function startOutboxWorkers(/* opts */) {
  return { ok: true, message: 'workers já iniciados pelo index (compat no-op)' };
}

// stopOutboxWorkers(topic?)
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

// queueSize(topic)
export async function queueSize(/* topic */) {
  try {
    const ctrl = _getGlobalOutboxController();
    // Para backends em memória não temos introspecção de tamanho.
    if (!ctrl) return -1;

    // Se for ioredis/node-redis, poderíamos implementar aqui um LLen.
    // Como a chave é interna ao ctrl, retornamos -1 por padrão para não quebrar.
    // (Se você quiser LLEN real, expanda o ctrl para expor a key ou um método size)
    return -1;
  } catch {
    return -1;
  }
}

export default { enqueueOutbox, startOutboxWorkers, stopOutboxWorkers, queueSize };
