// src/adapters/whatsapp/index.ts
import 'dotenv/config';

export interface WhatsAppAdapter {
  sendMessage(to: string, text: string): Promise<void>;
  sendImage(to: string, url: string, caption?: string): Promise<void>;
  onMessage(
    handler: (msg: { from: string; text: string; hasMedia?: boolean }) => Promise<string>
  ): void;
  isReady?(): boolean;
  getQrDataURL?(): Promise<string | null>;
}

export * as baileys from './baileys/index.js';
export * as meta from './meta/index.js';

import * as _baileys from './baileys/index.js';
import * as _meta from './meta/index.js';

type MaybeAdapter = Partial<WhatsAppAdapter>;
const WPP_ADAPTER = (process.env.WPP_ADAPTER || 'baileys').toLowerCase();

const registry: Record<string, MaybeAdapter> = {
  baileys: _baileys as unknown as MaybeAdapter,
  meta: _meta as unknown as MaybeAdapter,
};

const chosenName = registry[WPP_ADAPTER] ? WPP_ADAPTER : 'baileys';
const chosen: MaybeAdapter = registry[chosenName];

console.log(`[wpp] Adapter selecionado: ${chosenName}`);

const hasFn = (obj: any, k: string) => !!obj && typeof obj[k] === 'function';

async function _sendMessage(to: string, text: string): Promise<void> {
  if (!hasFn(chosen, 'sendMessage')) throw new Error(`Adapter "${chosenName}" não implementa sendMessage`);
  return (chosen as WhatsAppAdapter).sendMessage!(to, text);
}
async function _sendImage(to: string, url: string, caption?: string): Promise<void> {
  if (!hasFn(chosen, 'sendImage')) throw new Error(`Adapter "${chosenName}" não implementa sendImage`);
  return (chosen as WhatsAppAdapter).sendImage!(to, url, caption);
}
function _onMessage(
  handler: (msg: { from: string; text: string; hasMedia?: boolean }) => Promise<string>
): void {
  if (!hasFn(chosen, 'onMessage')) throw new Error(`Adapter "${chosenName}" não implementa onMessage`);
  return (chosen as WhatsAppAdapter).onMessage!(handler);
}

export function isReady(): boolean {
  try { if (hasFn(chosen, 'isReady')) return (chosen as WhatsAppAdapter).isReady!(); } catch {}
  return false;
}
export async function getQrDataURL(): Promise<string | null> {
  try { if (hasFn(chosen, 'getQrDataURL')) return (chosen as WhatsAppAdapter).getQrDataURL!(); } catch {}
  return null;
}

export const adapter: WhatsAppAdapter = {
  sendMessage: _sendMessage,
  sendImage: _sendImage,
  onMessage: _onMessage,
  isReady,
  getQrDataURL,
};
