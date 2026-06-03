import type { NotificationEvent } from '@memeforge/shared';

export interface NotificationChannelAdapter {
  readonly key: string;
  /** Whether this channel is configured/ready to send. */
  isReady(): boolean;
  send(event: NotificationEvent, recipient: ChannelRecipient): Promise<void>;
}

export interface ChannelRecipient {
  email?: string;
  pushSubscriptions?: Array<{ endpoint: string; p256dh: string; auth: string }>;
}
