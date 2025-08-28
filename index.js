 
import express from "express";
import { chatWithModel } from "./src/llm.js";

const app = express();
app.use(express.json());

// health
app.get("/health", (_req, res) => res.json({ ok: true, service: "matrix" }));

// endpoint simples para testar o roteamento por fase (intent)
app.post("/ask", async (req, res) => {
  try {
    const { intent = "greet", text = "" } = req.body || {};
    const { answer, model, latencyMs, raw } = await chatWithModel(intent, [
      { role: "user", content: text }
    ]);

    // (por enquanto só loga no console; depois gravamos no Postgres)
    console.log(`[telemetry] intent=${intent} model=${model} latency=${latencyMs}ms`);

    res.json({
      reply: answer,
      meta: { intent, model, latency_ms: latencyMs },
      // opcional: raw para debug
      // raw
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed", details: String(e?.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[matrix] listening on port ${PORT}`));
