import type { NotificationEvent } from '@memeforge/shared';
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import type { ChannelRecipient, NotificationChannelAdapter } from './types.js';

export class TelegramChannel implements NotificationChannelAdapter {
  readonly key = 'telegram';

  isReady(): boolean {
    return Boolean(env.telegram.botToken && env.telegram.chatId);
  }

  async send(event: NotificationEvent, _recipient: ChannelRecipient): Promise<void> {
    const text = `${event.emoji ?? ''} *${event.title}*\n${event.body}`;
    if (!this.isReady()) {
      logger.info({ text }, '[telegram:console] would send');
      return;
    }
    try {
      await fetch(`https://api.telegram.org/bot${env.telegram.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.telegram.chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      });
    } catch (err) {
      logger.warn({ err }, 'Telegram send failed');
    }
  }
}
