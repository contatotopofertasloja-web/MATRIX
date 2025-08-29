// src/adapters/whatsapp/meta/index.ts
import type { WhatsAppAdapter } from '../index.js';
export async function sendMessage(): Promise<void> { throw new Error('Adapter "meta" ainda não implementado.'); }
export async function sendImage(): Promise<void> { throw new Error('Adapter "meta" ainda não implementado.'); }
export function onMessage(): void { throw new Error('Adapter "meta" ainda não implementado.'); }
export function isReady(): boolean { return false; }
export async function getQrDataURL(): Promise<string | null> { return null; }
export const adapter: WhatsAppAdapter = { sendMessage, sendImage, onMessage, isReady, getQrDataURL };
