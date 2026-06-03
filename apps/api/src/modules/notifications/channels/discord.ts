import type { NotificationEvent } from '@memeforge/shared';
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import type { ChannelRecipient, NotificationChannelAdapter } from './types.js';

/**
 * Discord channel. If a bot token + alert channel are configured it posts via
 * the REST API; otherwise it logs to console. (The standalone bot in apps/bot
 * handles slash commands; this just relays alerts.)
 */
export class DiscordChannel implements NotificationChannelAdapter {
  readonly key = 'discord';

  isReady(): boolean {
    return Boolean(env.discord.botToken && env.discord.alertChannelId);
  }

  async send(event: NotificationEvent, _recipient: ChannelRecipient): Promise<void> {
    const content = `${event.emoji ?? ''} **${event.title}**\n${event.body}`;
    if (!this.isReady()) {
      logger.info({ content }, '[discord:console] would send');
      return;
    }
    try {
      await fetch(
        `https://discord.com/api/v10/channels/${env.discord.alertChannelId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bot ${env.discord.botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content }),
        },
      );
    } catch (err) {
      logger.warn({ err }, 'Discord send failed');
    }
  }
}
