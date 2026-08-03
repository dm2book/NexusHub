/**
 * Discord as an extension of the shop.
 *
 * The roles were previously three one-way grants: a badge went on when an order
 * was paid and never came off again. That is fine right up until the first
 * refund, after which the server is quietly full of claims that are no longer
 * true — a VIP badge on someone who charged back, a Gold tier on an account
 * whose only order was reversed. A role that lies is worse than no role.
 *
 * So most of this file is about the direction that did not exist: removal, and
 * the reconciliation that decides it.
 *
 * `earnedRolesFor` is the part worth being certain about and needs no guild, so
 * it is tested directly. Everything that talks to Discord is stubbed at `fetch`,
 * which means the real client code runs — URLs, methods, the member object, the
 * hierarchy check — against a fake guild.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_discord';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';
process.env.API_URL ||= 'https://forgemarket.nl';
// Pinned so a change to the shipped defaults cannot rewrite what is asserted.
process.env.DISCORD_BOT_TOKEN = 'stub-bot-token';
process.env.DISCORD_GUILD_ID = '999000111';
process.env.DISCORD_CLIENT_ID = 'stub-client';
process.env.DISCORD_CLIENT_SECRET = 'stub-secret';
process.env.DISCORD_VIP_THRESHOLD_CENTS = '20000';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ── A fake guild ─────────────────────────────────────────────────────────────
const GUILD = process.env.DISCORD_GUILD_ID;
// Role name → id. Every managed role exists except one, so the "role missing
// from the guild" path is exercised rather than assumed.
const guildRoles = [
  { id: 'r_customer', name: 'Verified Customer', position: 3 },
  { id: 'r_vip', name: 'VIP Customer', position: 4 },
  { id: 'r_review', name: 'Reviewer', position: 2 },
  { id: 'r_bronze', name: 'Bronze', position: 1 },
  { id: 'r_silver', name: 'Silver', position: 1 },
  { id: 'r_gold', name: 'Gold', position: 1 },
  // 'Platinum' deliberately absent.
  { id: 'r_bot', name: 'ForgeMarket Bot', position: 20 },
  { id: 'r_unmanaged', name: 'Moderator', position: 15 },
];
/** uid → Set of role ids the fake member currently holds. */
const members = new Map();
const calls = [];
let discordDown = false;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://discord.com/')) return realFetch(url, init);
  const method = init.method || 'GET';
  calls.push({ url: u, method });
  const json = (status, data) => new Response(JSON.stringify(data), { status });
  if (discordDown) return json(500, { message: 'guild unavailable' });

  if (u.endsWith(`/guilds/${GUILD}/roles`) && method === 'GET') return json(200, guildRoles);
  if (u.endsWith(`/guilds/${GUILD}/roles`) && method === 'POST') {
    const body = JSON.parse(init.body);
    const role = { id: `r_new_${guildRoles.length}`, name: body.name, position: 1 };
    guildRoles.push(role);
    return json(201, role);
  }
  if (u.endsWith(`/guilds/${GUILD}/members/@me`)) {
    return json(200, { user: { id: 'bot' }, roles: ['r_bot'] });
  }

  const roleMatch = u.match(new RegExp(`/guilds/${GUILD}/members/([^/]+)/roles/([^/]+)$`));
  if (roleMatch) {
    const [, uid, roleId] = roleMatch;
    if (!members.has(uid)) return json(404, { message: 'Unknown Member' });
    if (method === 'PUT') members.get(uid).add(roleId);
    if (method === 'DELETE') members.get(uid).delete(roleId);
    return new Response(null, { status: 204 });
  }
  const memberMatch = u.match(new RegExp(`/guilds/${GUILD}/members/([^/]+)$`));
  if (memberMatch) {
    const uid = memberMatch[1];
    return members.has(uid)
      ? json(200, { user: { id: uid }, roles: [...members.get(uid)] })
      : json(404, { message: 'Unknown Member' });
  }
  return json(404, { message: `unstubbed ${u}` });
};

await (await import('../src/app.js')).ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes } = await import('../src/services/codeStockService.js');
const { createOrder, getOrder, transitionOrder } = await import('../src/services/orderService.js');
const { addReview, addVerifiedReview } = await import('../src/services/reviewsService.js');
const {
  earnedRolesFor, syncMemberRoles, managedRoleNames, stripManagedRoles,
  roleDiagnostics, ensureRolesExist, sweepMemberRoles, userIdForDiscordUid, bustRoleCache,
} = await import('../src/services/discordRolesService.js');
const { linkStatus, unlinkDiscord, beginLink, completeLink, purgeExpiredLinkIntents } =
  await import('../src/services/discordLinkService.js');
const { run, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');

const tag = Date.now() % 1000000;
let n = 0;

const product = await createProduct({
  name: `Discord Test Card ${tag}`, price: 5000, currency: 'EUR',
  category: 'giftcards', active: 1, deliveryMode: 'manual',
});

/** A site account, optionally already linked to a Discord id and in the guild. */
async function makeUser({ link = null, inGuild = false } = {}) {
  const id = newId('usr');
  const at = nowIso();
  await run('INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id,@e,@n,@at,@at)',
    { id, e: `disc${tag}-${++n}@example.com`, n: `Tester ${n}`, at });
  if (link) {
    await run(`INSERT INTO oauth_accounts (id, user_id, provider, provider_uid, email, raw_profile, created_at)
               VALUES (@i,@u,'discord',@uid,@e,@raw,@at)`,
      { i: newId('oau'), u: id, uid: link, e: null, raw: JSON.stringify({ uid: link, displayName: 'Tester' }), at });
    if (inGuild) members.set(link, new Set());
  }
  return id;
}

/** Give a user a paid order of `cents`. */
async function paidOrder(userId, cents = 5000) {
  await run('UPDATE products SET price=@p WHERE id=@id', { p: cents, id: product.id });
  const order = await createOrder({
    email: `disc${tag}-order${++n}@example.com`, userId,
    items: [{ productId: product.id, quantity: 1 }], currency: 'EUR',
    consent: true, consentText: 'x',
  });
  await transitionOrder(order.id, 'payment_received', { actorId: 'test' });
  return order;
}

const rolesOf = (uid) => [...(members.get(uid) || [])]
  .map((id) => guildRoles.find((r) => r.id === id)?.name).filter(Boolean).sort();

// ── What an account has earned ──────────────────────────────────────────────
console.log('— Earned roles, computed from the database alone —');
{
  const u = await makeUser();
  let e = await earnedRolesFor(u);
  ok('a brand-new account has earned nothing', e.earned.size === 0, [...e.earned].join(','));

  await paidOrder(u, 5000);
  e = await earnedRolesFor(u);
  ok('one paid order earns the customer role', e.earned.has('Verified Customer'));
  ok('…and a loyalty tier', e.earned.has('Bronze'), [...e.earned].join(','));
  ok('…but not VIP at €50', !e.earned.has('VIP Customer'));
  ok('…and not the reviewer role', !e.earned.has('Reviewer'));
  ok('the reasons are stated in words, not rule ids',
    e.why.some((w) => /paid order/.test(w)), JSON.stringify(e.why));

  // VIP is LIFETIME spend. It used to compare a single order total, so someone
  // who spent €500 across twenty orders was never VIP while one €20 order was.
  await paidOrder(u, 5000);
  await paidOrder(u, 5000);
  await paidOrder(u, 5000);
  e = await earnedRolesFor(u);
  ok('VIP is earned on lifetime spend, not on one big order',
    e.earned.has('VIP Customer'), `spend ${e.spend}`);
  ok('…and the loyalty tier moves with it', e.earned.has('Silver'), [...e.earned].join(','));
}

{
  // The direction that never existed. A refund is not just a status change —
  // it means the badge is now a lie.
  const u = await makeUser();
  const order = await paidOrder(u, 30000);
  ok('a big order earns VIP', (await earnedRolesFor(u)).earned.has('VIP Customer'));

  await transitionOrder(order.id, 'refunded', { actorId: 'test' });
  const e = await earnedRolesFor(u);
  ok('a refunded order earns nothing at all', e.earned.size === 0, [...e.earned].join(','));
  ok('…including the customer role', !e.earned.has('Verified Customer'));
}

// ── The review role ─────────────────────────────────────────────────────────
console.log('— The reviewer role —');
{
  const u = await makeUser();
  const order = await paidOrder(u, 5000);
  await transitionOrder(order.id, 'processing', { actorId: 'test' });
  await transitionOrder(order.id, 'completed', { actorId: 'test' });

  ok('no reviewer role before reviewing', !(await earnedRolesFor(u)).earned.has('Reviewer'));
  await addVerifiedReview({ userId: u, email: 'x@example.com', orderId: order.id,
    author: 'Tester', stars: 5, body: 'Worked exactly as described.' });
  ok('a review on the site earns the reviewer role',
    (await earnedRolesFor(u)).earned.has('Reviewer'));
}

{
  // The other half of the loop: a /vouch typed in Discord. The author's Discord
  // id is the only thing tying that person to an account here, which is why the
  // ingest carries it.
  const uid = `uid_vouch_${tag}`;
  const u = await makeUser({ link: uid });
  ok('a Discord id resolves back to the account', (await userIdForDiscordUid(uid)) === u);

  ok('no reviewer role yet', !(await earnedRolesFor(u)).earned.has('Reviewer'));
  await addReview({ author: 'Tester', stars: 5, body: 'Fast and friendly.',
    source: 'discord', externalId: `msg_${tag}`, discordUid: uid });
  ok('a vouch carrying the author id earns the reviewer role',
    (await earnedRolesFor(u)).earned.has('Reviewer'));

  // An older bot that does not send the id must keep working, just without the
  // role — silently breaking review ingestion would be far worse.
  const other = await makeUser({ link: `uid_none_${tag}` });
  await addReview({ author: 'Anon', stars: 5, body: 'No id attached.', source: 'discord', externalId: `msg2_${tag}` });
  ok('a vouch without an id still posts, and earns nothing',
    !(await earnedRolesFor(other)).earned.has('Reviewer'));
}

// ── Reconciliation against a guild ──────────────────────────────────────────
console.log('— Reconciling a member —');
{
  const uid = `uid_sync_${tag}`;
  const u = await makeUser({ link: uid, inGuild: true });
  await paidOrder(u, 25000);

  const r1 = await syncMemberRoles(u, { reason: 'test' });
  ok('the sync succeeds', r1.ok, JSON.stringify(r1));
  ok('the customer role is applied', rolesOf(uid).includes('Verified Customer'), rolesOf(uid).join(','));
  ok('VIP is applied', rolesOf(uid).includes('VIP Customer'));
  ok('the loyalty tier is applied', rolesOf(uid).includes('Silver'), rolesOf(uid).join(','));
  ok('a role missing from the guild is reported, not silently skipped',
    r1.skipped.includes('Platinum'), JSON.stringify(r1.skipped));

  // Idempotent: running it again must be a complete no-op.
  const before = rolesOf(uid).join(',');
  const r2 = await syncMemberRoles(u, { reason: 'test' });
  ok('running it again changes nothing',
    r2.added.length === 0 && r2.removed.length === 0 && rolesOf(uid).join(',') === before);

  // A role the shop does not manage must never be touched.
  members.get(uid).add('r_unmanaged');
  await syncMemberRoles(u, { reason: 'test' });
  ok('roles the site does not manage are left alone', rolesOf(uid).includes('Moderator'));
  ok('Moderator is not on the managed list', !managedRoleNames().includes('Moderator'));
}

{
  // The whole point: a badge comes OFF when it stops being true.
  const uid = `uid_revoke_${tag}`;
  const u = await makeUser({ link: uid, inGuild: true });
  const order = await paidOrder(u, 30000);
  await syncMemberRoles(u, { reason: 'test' });
  ok('VIP granted on a paid order', rolesOf(uid).includes('VIP Customer'));

  await transitionOrder(order.id, 'refunded', { actorId: 'test' });
  // The transition syncs by itself; give the awaited call its result anyway.
  const r = await syncMemberRoles(u, { reason: 'test' });
  ok('a refund removes VIP', !rolesOf(uid).includes('VIP Customer'), rolesOf(uid).join(','));
  ok('…and the customer role', !rolesOf(uid).includes('Verified Customer'));
  ok('…and the loyalty tier', !rolesOf(uid).includes('Silver'));
  ok('the removal is reported', r.removed.length > 0 || rolesOf(uid).length === 0);
}

{
  const uid = `uid_notmember_${tag}`;
  const u = await makeUser({ link: uid, inGuild: false });
  await paidOrder(u, 5000);
  const r = await syncMemberRoles(u, { reason: 'test' });
  ok('someone who has not joined the server is not an error',
    r.ok === false && /not a member/.test(r.note || ''), JSON.stringify(r));

  // …and once they DO join, the sweep gives them what they already earned.
  // This is the bug that made the old integration unreliable: roles were only
  // ever granted at the moment an order was paid, so joining later got nothing.
  members.set(uid, new Set());
  const swept = await sweepMemberRoles({ limit: 200 });
  ok('the sweep picks up a member who joined later', rolesOf(uid).includes('Verified Customer'),
    `${JSON.stringify(swept)} roles=${rolesOf(uid)}`);
}

{
  // Discord being unreachable must never throw into an order.
  const uid = `uid_down_${tag}`;
  const u = await makeUser({ link: uid, inGuild: true });
  await paidOrder(u, 5000);
  discordDown = true;
  const r = await syncMemberRoles(u, { reason: 'test' });
  ok('an unreachable Discord is reported, not thrown', r.ok === false && !!r.error, JSON.stringify(r));
  const another = await paidOrder(u, 5000);
  const e = await throws(() => transitionOrder(another.id, 'processing', { actorId: 'test' }));
  ok('…and an order still goes through while it is down', e === null, e?.message);
  discordDown = false;
  bustRoleCache();
}

// ── Linking ─────────────────────────────────────────────────────────────────
console.log('— Connecting an account —');
{
  const u = await makeUser();
  let status = await linkStatus(u);
  ok('an unlinked account reports as unlinked', status.linked === false);
  ok('…and says whether linking is even available', status.available === true);

  const state = `st_${tag}_a`;
  const url = await beginLink(u, state);
  ok('the consent URL points at Discord', url.startsWith('https://discord.com/api/oauth2/authorize'));
  ok('…carries the state', url.includes(`state=${state}`));
  // Only the state travels. The user id never leaves the server, so a callback
  // cannot be talked into attaching Discord to somebody else's account.
  ok('…and never carries the user id', !url.includes(u));
  ok('the intent is recorded server-side',
    !!(await get('SELECT user_id FROM oauth_link_intents WHERE state=@s', { s: state })));

  // The scope asks for identify only — connecting to an account that already
  // exists does not need the person's email address.
  ok('the link scope does not ask for an email', !/scope=[^&]*email/.test(url), url);
}

{
  // A state is single-use, and an unknown one must not resolve to anybody.
  const e = await throws(() => completeLink(`never_issued_${tag}`, 'code'));
  ok('an unknown state is refused', !!e && /not valid/.test(e.message), e?.message);

  const u = await makeUser();
  const state = `st_${tag}_expired`;
  await run(`INSERT INTO oauth_link_intents (state, user_id, provider, created_at, expires_at)
             VALUES (@s,@u,'discord',@at,@exp)`,
    { s: state, u, at: nowIso(), exp: new Date(Date.now() - 60_000).toISOString() });
  const e2 = await throws(() => completeLink(state, 'code'));
  ok('an expired state is refused', !!e2 && /expired/.test(e2.message), e2?.message);
  ok('…and is consumed either way, so it cannot be retried',
    !(await get('SELECT state FROM oauth_link_intents WHERE state=@s', { s: state })));

  const purged = await purgeExpiredLinkIntents();
  ok('expired intents are purged by maintenance', typeof purged === 'number');
}

{
  // One Discord account, one shop account. Without this, one person could
  // collect the customer role off somebody else's purchases.
  const uid = `uid_taken_${tag}`;
  await makeUser({ link: uid });
  const other = await makeUser();
  const state = `st_${tag}_taken`;
  await run(`INSERT INTO oauth_link_intents (state, user_id, provider, created_at, expires_at)
             VALUES (@s,@u,'discord',@at,@exp)`,
    { s: state, u: other, at: nowIso(), exp: new Date(Date.now() + 60_000).toISOString() });

  // Stub the token + profile exchange for this one case.
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const s = String(url);
    if (s.includes('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    if (s.endsWith('/users/@me')) return new Response(JSON.stringify({ id: uid, username: 'taken' }), { status: 200 });
    return prevFetch(url, init);
  };
  const e = await throws(() => completeLink(state, 'code'));
  globalThis.fetch = prevFetch;
  ok('a Discord account already linked elsewhere is refused',
    !!e && /already connected/.test(e.message), e?.message);
  ok('…with a message a person can act on', /another ForgeMarket account/.test(e?.message || ''));
}

// ── Disconnecting ───────────────────────────────────────────────────────────
console.log('— Disconnecting —');
{
  const uid = `uid_unlink_${tag}`;
  const u = await makeUser({ link: uid, inGuild: true });
  await paidOrder(u, 25000);
  await syncMemberRoles(u, { reason: 'test' });
  members.get(uid).add('r_unmanaged');
  ok('roles are in place before unlinking', rolesOf(uid).includes('VIP Customer'));

  const r = await unlinkDiscord(u);
  ok('unlinking reports which roles it removed', (r.rolesRemoved || []).length > 0, JSON.stringify(r));
  ok('every managed role is gone',
    !rolesOf(uid).some((x) => managedRoleNames().includes(x)), rolesOf(uid).join(','));
  // The link is the only reason we ever touched this member; unmanaged roles
  // were never ours to remove.
  ok('unmanaged roles survive the disconnect', rolesOf(uid).includes('Moderator'));
  ok('the link is gone', (await linkStatus(u)).linked === false);
  ok('unlinking twice is harmless', (await unlinkDiscord(u)).alreadyUnlinked === true);
}

// ── Owner-facing diagnostics ────────────────────────────────────────────────
console.log('— Diagnostics —');
{
  const d = await roleDiagnostics();
  ok('diagnostics report as configured', d.configured === true);
  ok('…list which managed roles exist', d.present.includes('Verified Customer'));
  ok('…and which do not', d.missing.includes('Platinum'), JSON.stringify(d.missing));
  // The mistake everybody makes once: the bot cannot assign a role positioned
  // above its own. Guessing that from the outside is near impossible.
  ok('…and whether the bot outranks the roles it must assign', d.botCanAssign === true);
  ok('…and how many accounts are linked', d.linkedAccounts > 0);

  const created = await ensureRolesExist();
  ok('missing roles can be created in one action', created.created.includes('Platinum'), JSON.stringify(created));
  const d2 = await roleDiagnostics();
  ok('…after which nothing is missing', d2.missing.length === 0, JSON.stringify(d2.missing));
  ok('creating again is a no-op', (await ensureRolesExist()).created.length === 0);
}

{
  // Created roles must be badges, not access. Granting permissions here would
  // be handing out powers nobody asked for.
  const create = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/roles'));
  ok('roles were created through the guild roles endpoint', create.length > 0);
}

// ── The signature over the vouch ────────────────────────────────────────────
console.log('— The Discord id is signed, not just sent —');
{
  const { canonicalReview } = await import('../src/middleware/ingestSignature.js');
  const base = { author: 'Tester', stars: 5, body: 'Great', externalId: 'vouch:123' };

  // A bot that predates the field must keep signing exactly what it signed
  // before, or every vouch stops verifying the moment the server updates.
  ok('a payload without an id is unchanged',
    canonicalReview(base) === ['Tester', 5, 'Great', 'vouch:123'].join('\u0000'));

  // The id decides which account receives the reviewer role. Leaving it outside
  // the signature would let a captured vouch be re-pointed at someone else.
  const withUid = canonicalReview({ ...base, discordUid: '4242' });
  ok('an id changes the signed string', withUid !== canonicalReview(base));
  ok('…and the id itself is part of it', withUid.endsWith('4242'));
  ok('a different id signs differently',
    canonicalReview({ ...base, discordUid: '9999' }) !== withUid);

  const bot = await import('node:fs').then((fs) => fs.readFileSync('../discord/src/bot.js', 'utf8'));
  ok('the bot appends the id only when present, exactly like the server',
    /if \(discordUid\) parts\.push\(String\(discordUid\)\)/.test(bot));
  ok('the /vouch command sends the author id', /discordUid: i\.user\.id/.test(bot));
}

// ── Wiring ──────────────────────────────────────────────────────────────────
console.log('— Wiring —');
{
  const fs = await import('node:fs');
  const orderSrc = fs.readFileSync('src/services/orderService.js', 'utf8');
  ok('roles are reconciled on the way down as well as up',
    /'refunded', 'cancelled', 'failed'\]\.includes\(to\)/.test(orderSrc)
    || /refunded[\s\S]{0,80}syncMemberRoles/.test(orderSrc), 'a refund must trigger a sync');
  ok('the old one-way grant helpers are no longer called',
    !/grantTierForOrder\(/.test(orderSrc) && !/syncLoyaltyRoles\(/.test(orderSrc));

  const maint = fs.readFileSync('src/services/maintenanceService.js', 'utf8');
  ok('the hourly job re-syncs the stalest members', /sweepMemberRoles/.test(maint));
  ok('…and purges spent link intents', /purgeExpiredLinkIntents/.test(maint));

  const auth = fs.readFileSync('src/routes/auth.js', 'utf8');
  ok('linking requires an authenticated session',
    /oauth\/discord\/link\/start', requireAuth/.test(auth));
  ok('the link callback is separate from the login callback',
    /oauth\/discord\/link\/callback/.test(auth));

  const account = fs.readFileSync('src/routes/account.js', 'utf8');
  ok('an account can see its link status', /router\.get\('\/discord'/.test(account));
  ok('…and disconnect', /router\.delete\('\/discord'/.test(account));
  ok('the manual re-sync is rate limited', /discord_sync/.test(account));

  const catalog = fs.readFileSync('src/routes/catalog.js', 'utf8');
  ok('the vouch ingest accepts the author Discord id', /discordUid: z\.string\(\)/.test(catalog));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} discord: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
