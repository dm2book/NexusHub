import nodemailer, { type Transporter } from 'nodemailer';
import type { NotificationEvent } from '@memeforge/shared';
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import type { ChannelRecipient, NotificationChannelAdapter } from './types.js';

export class EmailChannel implements NotificationChannelAdapter {
  readonly key = 'email';
  private transporter: Transporter | null = null;

  private get(): Transporter | null {
    if (!env.smtp.host) return null;
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: env.smtp.host,
        port: env.smtp.port,
        secure: env.smtp.port === 465,
        auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
      });
    }
    return this.transporter;
  }

  isReady(): boolean {
    return Boolean(env.smtp.host);
  }

  async send(event: NotificationEvent, recipient: ChannelRecipient): Promise<void> {
    if (!recipient.email) return;
    const transporter = this.get();
    const subject = `${event.emoji ?? ''} ${event.title}`.trim();
    if (!transporter) {
      logger.info({ to: recipient.email, subject }, '[email:console] would send');
      return;
    }
    await transporter.sendMail({
      from: env.smtp.from,
      to: recipient.email,
      subject,
      text: event.body,
      html: `<div style="font-family:Inter,system-ui,sans-serif;background:#0a0a0f;color:#e2e8f0;padding:24px;border-radius:12px">
        <h2 style="margin:0 0 8px">${event.emoji ?? ''} ${event.title}</h2>
        <p style="color:#94a3b8;white-space:pre-line">${event.body}</p>
      </div>`,
    });
  }
}
