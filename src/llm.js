// src/llm.js
// Proxy: reexporta a lógica central do src/core/llm.js
export * from "./core/llm.js";
import { callLLM } from "./core/llm.js";
export default callLLM;
