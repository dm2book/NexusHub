'use client';

import { useEffect, useRef, useState } from 'react';
import { REALTIME_ENABLED, WS_URL } from './config';
import { useAuth } from './auth';

type Handler = (payload: unknown) => void;

interface RealtimeMessage {
  channel: string;
  payload: unknown;
  ts: number;
}

/**
 * Subscribe to realtime channels from the API WebSocket hub. Reconnects with
 * backoff and dispatches messages to per-channel handlers.
 */
export function useRealtime(handlers: Record<string, Handler>) {
  const token = useAuth((s) => s.accessToken);
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    // On serverless (Vercel) there is no WS server — SWR polling carries data.
    if (!token || !REALTIME_ENABLED || !WS_URL) return;
    let ws: WebSocket | null = null;
    let retry = 0;
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(`${WS_URL}?token=${token}`);
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as RealtimeMessage;
          handlersRef.current[msg.channel]?.(msg.payload);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        retry += 1;
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry, 15_000));
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [token]);

  return { connected };
}
