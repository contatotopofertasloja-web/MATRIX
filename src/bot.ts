import { runEngine } from './core/engine';

export const bot = {
  async handleMessage({ userId, text, context }: { userId: string, text: string, context: any }) {
    // Delegar toda a decisão para o engine (FSM + intents)
    const reply = await runEngine({ text, context });
    return reply;
  }
};
