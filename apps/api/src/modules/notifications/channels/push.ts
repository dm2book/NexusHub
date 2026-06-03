import webpush from 'web-push';
import type { NotificationEvent } from '@memeforge/shared';
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import type { ChannelRecipient, NotificationChannelAdapter } from './types.js';

let configured = false;
function configure(): boolean {
  if (configured) return true;
  if (!env.vapid.publicKey || !env.vapid.privateKey) return false;
  webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey);
  configured = true;
  return true;
}

export class PushChannel implements NotificationChannelAdapter {
  readonly key = 'push';

  isReady(): boolean {
    return Boolean(env.vapid.publicKey && env.vapid.privateKey);
  }

  async send(event: NotificationEvent, recipient: ChannelRecipient): Promise<void> {
    if (!recipient.pushSubscriptions?.length) return;
    if (!configure()) {
      logger.info({ title: event.title }, '[push:console] would send');
      return;
    }
    const payload = JSON.stringify({
      title: `${event.emoji ?? ''} ${event.title}`.trim(),
      body: event.body,
      data: { tokenAddress: event.tokenAddress, type: event.type },
    });
    await Promise.all(
      recipient.pushSubscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
        } catch (err) {
          logger.warn({ err }, 'Push send failed');
        }
      }),
    );
  }
}
