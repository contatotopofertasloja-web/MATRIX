import "dotenv/config";
import express from "express";
import { withRateLimit } from "./middlewares/rateLimit.js";
import { runFlow } from "./flows/index.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(withRateLimit({ windowMs: 3000, max: 5 }));

app.get("/", (_req, res) => res.send("Matrix Cláudia 2.0 online ✅"));

app.post("/chat", async (req, res) => {
  try {
    const { message = "", userId = "anon", stage = "greet", model = "gpt-4o-mini" } = req.body ?? {};
    const result = await runFlow({ message, userId, stage, model });
    res.json(result);
  } catch (err) {
    console.error("[chat] error", err);
    res.status(500).json({ error: "internal_error" });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`[HTTP] running on ${port}`));