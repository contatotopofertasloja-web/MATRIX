// src/llm.js
// Proxy fino: reexporta a lógica central do core e mantém default para callLLM.

export * from "./core/llm.js";
import { callLLM } from "./core/llm.js";
export default callLLM;
