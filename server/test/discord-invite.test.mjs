/** Verifies the self-healing Discord invite: signed push endpoint, kv storage,
 *  and the public server-info route serving the live link. */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';
process.env.REVIEW_INGEST_SECRET = 'invite-test-secret';
import { createHmac } from 'node:crypto';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const app = createApp();
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const SECRET = 'invite-test-secret';

const signedPost = (path, body, canonical, { badSig = false, staleTs = false } = {}) => {
  const ts = staleTs ? String(Date.now() - 10 * 60_000) : String(Date.now());
  const sig = createHmac('sha256', badSig ? 'wrong' : SECRET).update(`${ts}.${canonical}`).digest('hex');
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': sig },
    body: JSON.stringify(body),
  });
};

console.log('— Signed invite push —');
const url = 'https://discord.gg/PERMA123';
{
  const res = await signedPost('/api/discord/invite', { url }, `invite:${url}`);
  ok('valid signed push accepted', res.status === 200, `status=${res.status}`);
}
{
  const res = await signedPost('/api/discord/invite', { url }, `invite:${url}`, { badSig: true });
  ok('bad signature rejected', res.status === 403, `status=${res.status}`);
}
{
  const res = await signedPost('/api/discord/invite', { url }, `invite:${url}`, { staleTs: true });
  ok('stale timestamp rejected (replay window)', res.status === 403, `status=${res.status}`);
}
{
  const evil = 'https://evil.example/phish';
  const res = await signedPost('/api/discord/invite', { url: evil }, `invite:${evil}`);
  ok('non-Discord URL rejected even when correctly signed', res.status === 400, `status=${res.status}`);
}
{
  // Signature binds the URL: signing one URL but sending another must fail.
  const res = await signedPost('/api/discord/invite', { url: 'https://discord.gg/OTHER' }, `invite:${url}`);
  ok('URL is bound into the signature (swap rejected)', res.status === 403, `status=${res.status}`);
}

console.log('\n— Live invite served everywhere —');
{
  const r = await fetch(`${base}/api/discord/server`).then((x) => x.json());
  ok('/api/discord/server serves the pushed permanent invite', r.server?.inviteUrl === url, r.server?.inviteUrl);
}
{
  const { getLiveInviteUrl } = await import('../src/services/discordService.js');
  ok('getLiveInviteUrl reads the stored link', (await getLiveInviteUrl()) === url);
}
{
  // A newer push replaces the old one (self-healing after a deleted invite).
  const url2 = 'https://discord.gg/PERMA456';
  await signedPost('/api/discord/invite', { url: url2 }, `invite:${url2}`);
  const { getLiveInviteUrl } = await import('../src/services/discordService.js');
  ok('a fresh push replaces the stored link', (await getLiveInviteUrl()) === url2);
}

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
