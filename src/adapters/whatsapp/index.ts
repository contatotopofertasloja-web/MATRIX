export interface WhatsAppAdapter {
  sendMessage(to: string, text: string): Promise<void>;
  sendImage(to: string, url: string, caption?: string): Promise<void>;
  onMessage(handler: (msg: { from: string, text: string, hasMedia?: boolean }) => Promise<string>): void;
}

export * as baileys from './baileys/index';
export * as meta from './meta/index';
