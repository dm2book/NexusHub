import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { Readable } from 'node:stream';
import { createApp } from '@memeforge/api/app';

/**
 * All-on-Vercel adapter.
 *
 * MemeForge's backend is a complete Express app. Vercel is serverless (no
 * long-running server), so instead of running it as a process we mount the same
 * Express app behind a Next.js Route Handler. This gives a same-origin API at
 * `/api/v1/*` with zero code duplication. The realtime WebSocket hub and the
 * in-process scheduler are intentionally NOT started here — realtime degrades to
 * polling and automation is driven by Vercel Cron hitting `/api/v1/cron/*`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Build the Express app once per warm lambda.
const app = createApp();

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const bodyBuf =
    req.method === 'GET' || req.method === 'HEAD'
      ? undefined
      : Buffer.from(await req.arrayBuffer());

  // Fake a Node IncomingMessage backed by a stream carrying the body.
  const socket = new Socket();
  const nodeReq = new IncomingMessage(socket);
  nodeReq.method = req.method;
  nodeReq.url = url.pathname + url.search;
  nodeReq.headers = Object.fromEntries(req.headers.entries());
  if ((nodeReq.headers['x-forwarded-for'] ?? '') === '') {
    nodeReq.headers['x-forwarded-for'] = '127.0.0.1';
  }

  const source = Readable.from(bodyBuf ? [bodyBuf] : []);
  nodeReq.push = source.push.bind(source) as typeof nodeReq.push;
  // Pipe the readable's data into the IncomingMessage consumers.
  source.on('data', (chunk) => nodeReq.emit('data', chunk));
  source.on('end', () => nodeReq.emit('end'));

  const nodeRes = new ServerResponse(nodeReq);

  return new Promise<Response>((resolve) => {
    const chunks: Buffer[] = [];
    const origWrite = nodeRes.write.bind(nodeRes);
    const origEnd = nodeRes.end.bind(nodeRes);

    nodeRes.write = ((chunk: unknown, ...rest: unknown[]) => {
      if (chunk) chunks.push(Buffer.from(chunk as Buffer));
      return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof nodeRes.write;

    nodeRes.end = ((chunk?: unknown, ...rest: unknown[]) => {
      if (chunk && typeof chunk !== 'function') chunks.push(Buffer.from(chunk as Buffer));
      const result = (origEnd as (...a: unknown[]) => ServerResponse)(chunk, ...rest);
      const headers = new Headers();
      for (const [k, v] of Object.entries(nodeRes.getHeaders())) {
        if (v === undefined) continue;
        if (Array.isArray(v)) v.forEach((vv) => headers.append(k, String(vv)));
        else headers.set(k, String(v));
      }
      resolve(new Response(chunks.length ? Buffer.concat(chunks) : null, { status: nodeRes.statusCode, headers }));
      return result;
    }) as typeof nodeRes.end;

    // Hand the request to Express.
    (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(nodeReq, nodeRes);
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
