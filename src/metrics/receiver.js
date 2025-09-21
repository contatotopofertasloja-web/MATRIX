// src/core/metrics/receiver.js
// Router Express neutro p/ receber métricas e expor healthcheck.
// NÂO tem “cheiro” de bot; é módulo de core.
//
// Endpoints:
//  - POST /metrics/webhook   { events: [...] }   -> 202/400
//  - GET  /metrics/health    -> { queueSize, sink, batchMax, flushMs }
//
// Uso (no teu server Express):
//   import { createMetricsRouter, attachMetricsRoutes } from "./core/metrics/receiver.js";
//   // opção 1 (uma linha):
//   attachMetricsRoutes(app, "/");
//   // opção 2 (manual):
//   app.use(createMetricsRouter({ basePath: "/" }));
//
// Integra com o middleware via import dinâmico (evita acoplamento forte).

import express from "express";

// Helper para tentar importar as funções do middleware.
async function _loadMiddleware() {
  try {
    const mod = await import("./middleware.js");
    return mod || {};
  } catch (e) {
    console.warn("[metrics/receiver] middleware ausente:", e?.message || e);
    return {};
  }
}

export function createMetricsRouter({ basePath = "/" } = {}) {
  const router = express.Router();

  // Parse seguro de JSON, limit básico (evita payloads gigantes)
  router.use(express.json({ limit: "512kb" }));

  // POST /metrics/webhook  — recebe { events: [...] }
  router.post("/metrics/webhook", async (req, res) => {
    try {
      const { events } = req.body || {};
      if (!Array.isArray(events) || !events.length) {
        return res.status(400).json({ ok: false, error: "payload inválido (events[] requerido)" });
      }

      const { captureFromActions } = await _loadMiddleware();
      if (typeof captureFromActions !== "function") {
        // Se o middleware não existir aqui, ainda assim aceitamos (no-op),
        // porque este endpoint pode ser externo ao coletor local.
        return res.status(202).json({ ok: true, accepted: events.length, sink: "external" });
      }

      // Converte cada evento em uma "action" mínima para reuso do pipeline.
      // Aqui seguimos o contrato do nosso middleware: captureFromActions(actions, ctx).
      // Agrupamos tudo em uma única chamada para reduzir custo.
      const actions = events.map(ev => {
        // Mapeamento simples: se veio "type", converte para "kind".
        const kind = ev?.type?.startsWith("action_")
          ? ev.type.replace(/^action_/, "")
          : (ev?.kind || "other");
        return { kind, meta: { stage: ev?.stage || null, variant: ev?.variant || null } };
      });

      // Contexto: pegamos o 1º evento como base (se existirem campos).
      const ctxSample = events[0] || {};
      const context = {
        botId: ctxSample.botId || "unknown-bot",
        jid: ctxSample.jid || "unknown-user",
        stage: ctxSample.stage || null,
        variant: ctxSample.variant || null,
        askedPrice: !!ctxSample.askedPrice,
        askedLink: !!ctxSample.askedLink,
      };

      await captureFromActions(actions, context);
      return res.status(202).json({ ok: true, accepted: events.length, sink: "internal" });
    } catch (e) {
      console.error("[metrics/receiver] erro:", e?.message || e);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // GET /metrics/health
  router.get("/metrics/health", async (_req, res) => {
    try {
      const mod = await _loadMiddleware();
      const sink = (process.env.METRICS_SINK || (process.env.NODE_ENV === "production" ? "none" : "console")).toLowerCase();
      const batchMax = Number(process.env.METRICS_BATCH_MAX || 50);
      const flushMs = Number(process.env.METRICS_FLUSH_MS || 1500);

      // Se o middleware expuser uma fila interna futuramente, podemos ler aqui.
      // Por ora, retornamos dados de config + ping simples (timestamp).
      return res.json({
        ok: true,
        ts: new Date().toISOString(),
        sink,
        batchMax,
        flushMs,
        // compat — se o middleware expuser getQueueSize(), usamos; senão null
        queueSize: typeof mod.getQueueSize === "function" ? Number(mod.getQueueSize()) : null,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
    }
  });

  return router;
}

/**
 * Atacha o router ao app Express num basePath.
 * Ex.: attachMetricsRoutes(app, "/") → monta /metrics/...
 */
export function attachMetricsRoutes(app, basePath = "/") {
  const r = createMetricsRouter({ basePath });
  // Normaliza basePath
  const bp = String(basePath || "/");
  // Garante uma única barra
  const prefix = bp.endsWith("/") ? bp.slice(0, -1) : bp;
  app.use(prefix, r);
}

export default { createMetricsRouter, attachMetricsRoutes };
