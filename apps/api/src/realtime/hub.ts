import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { WS_CHANNELS, type WsChannel } from '@memeforge/shared';
import { verifyToken } from '../lib/jwt.js';
import { logger } from '../lib/logger.js';

interface Client {
  socket: WebSocket;
  userId: string;
  channels: Set<WsChannel>;
}

/**
 * Realtime hub. Clients connect to /realtime?token=<jwt>, then subscribe to
 * channels. The rest of the platform calls `realtime.publish(channel, payload)`
 * (optionally scoped to a userId) to push diffs.
 */
class RealtimeHub {
  private wss: WebSocketServer | null = null;
  private clients = new Set<Client>();

  attach(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/realtime' });
    this.wss.on('connection', (socket, req) => this.onConnection(socket, req.url ?? ''));
    logger.info('Realtime hub attached at /realtime');

    // Heartbeat to drop dead sockets.
    setInterval(() => {
      for (const c of this.clients) {
        if (c.socket.readyState === c.socket.OPEN) c.socket.ping();
      }
    }, 30_000).unref();
  }

  private onConnection(socket: WebSocket, url: string) {
    const token = new URL(url, 'http://localhost').searchParams.get('token');
    if (!token) {
      socket.close(4401, 'Missing token');
      return;
    }
    let userId: string;
    try {
      userId = verifyToken(token).id;
    } catch {
      socket.close(4401, 'Invalid token');
      return;
    }

    const client: Client = { socket, userId, channels: new Set(WS_CHANNELS) };
    this.clients.add(client);
    this.send(socket, 'system', { message: 'connected', channels: [...client.channels] });

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { action: string; channel?: WsChannel };
        if (msg.action === 'subscribe' && msg.channel) client.channels.add(msg.channel);
        if (msg.action === 'unsubscribe' && msg.channel) client.channels.delete(msg.channel);
      } catch {
        /* ignore malformed */
      }
    });

    socket.on('close', () => this.clients.delete(client));
    socket.on('error', () => this.clients.delete(client));
  }

  private send(socket: WebSocket, channel: string, payload: unknown) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ channel, payload, ts: Date.now() }));
    }
  }

  /** Broadcast to everyone subscribed to a channel (optionally a single user). */
  publish(channel: WsChannel, payload: unknown, userId?: string) {
    for (const c of this.clients) {
      if (userId && c.userId !== userId) continue;
      if (!c.channels.has(channel)) continue;
      this.send(c.socket, channel, payload);
    }
  }

  get connectionCount() {
    return this.clients.size;
  }
}

export const realtime = new RealtimeHub();
