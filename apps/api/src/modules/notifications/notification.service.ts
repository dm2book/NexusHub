import { NotificationChannel, type NotificationEvent } from '@memeforge/shared';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { realtime } from '../../realtime/hub.js';
import { EmailChannel } from './channels/email.js';
import { DiscordChannel } from './channels/discord.js';
import { TelegramChannel } from './channels/telegram.js';
import { PushChannel } from './channels/push.js';
import type { NotificationChannelAdapter } from './channels/types.js';

const email = new EmailChannel();
const discord = new DiscordChannel();
const telegram = new TelegramChannel();
const push = new PushChannel();

const adapterByChannel: Record<Exclude<NotificationChannel, 'IN_APP'>, NotificationChannelAdapter> = {
  [NotificationChannel.EMAIL]: email,
  [NotificationChannel.DISCORD]: discord,
  [NotificationChannel.TELEGRAM]: telegram,
  [NotificationChannel.PUSH]: push,
};

/**
 * NotificationBus — fans a single NotificationEvent out to every enabled
 * channel for a user, always persisting an in-app record and pushing it over
 * the realtime hub.
 */
class NotificationBus {
  async dispatch(userId: string, event: NotificationEvent): Promise<void> {
    // 1. Persist in-app + push over websocket.
    const record = await prisma.notification.create({
      data: {
        userId,
        type: String(event.type),
        title: event.title,
        body: event.body,
        emoji: event.emoji,
        meta: (event.meta ?? {}) as object,
      },
    });
    realtime.publish('notifications', { kind: 'new', notification: record }, userId);

    // 2. Resolve preferences + recipient details.
    const [pref, user, subs] = await Promise.all([
      prisma.notificationPref.findUnique({ where: { userId } }),
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.pushSubscription.findMany({ where: { userId } }),
    ]);
    if (!user) return;

    const recipient = {
      email: user.email,
      pushSubscriptions: subs.map((s) => ({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })),
    };

    const wanted = event.channels;
    const enabled = (ch: NotificationChannel): boolean => {
      if (wanted && !wanted.includes(ch)) return false;
      if (!pref) return ch === NotificationChannel.EMAIL; // sensible default
      switch (ch) {
        case NotificationChannel.EMAIL:
          return pref.email;
        case NotificationChannel.DISCORD:
          return pref.discord;
        case NotificationChannel.TELEGRAM:
          return pref.telegram;
        case NotificationChannel.PUSH:
          return pref.push;
        default:
          return false;
      }
    };

    // 3. Fan out to external channels.
    await Promise.all(
      (Object.keys(adapterByChannel) as Array<keyof typeof adapterByChannel>).map(async (ch) => {
        if (!enabled(ch)) return;
        try {
          await adapterByChannel[ch].send(event, recipient);
        } catch (err) {
          logger.warn({ err, channel: ch }, 'Notification channel failed');
        }
      }),
    );
  }

  /** Broadcast to all owners/admins (used by automated system alerts). */
  async dispatchToOwners(event: NotificationEvent): Promise<void> {
    const owners = await prisma.user.findMany({
      where: { role: { in: ['OWNER', 'ADMIN'] } },
      select: { id: true },
    });
    await Promise.all(owners.map((o) => this.dispatch(o.id, event)));
  }
}

export const notifications = new NotificationBus();
