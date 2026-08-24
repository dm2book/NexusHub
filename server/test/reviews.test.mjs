/**
 * Reviews, against a real database.
 *
 * The system was already honest about the thing that matters most: the public
 * star rating averages only reviews tied to a completed order, so a Discord
 * /vouch — which proves you are human, not that you ever bought anything —
 * cannot vote on the number the whole shop is judged on. That is untouched.
 *
 * What was missing:
 *
 *   A vouch published itself. One message typed in the server was live on the
 *   storefront immediately, under the shop's own name, next to reviews from
 *   real orders — and it had already earned the reviewer role by the time a
 *   moderator saw it.
 *
 *   One review per order is enforced by a unique index, and the code checked
 *   for a duplicate with a SELECT before inserting. Between the two sits a
 *   window that a double-tapped submit button is enough to find: the loser hit
 *   the constraint and it travelled out as a 500, telling a customer their
 *   review broke the site when their other click had just saved it.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_reviews_test';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };

const { ensureReady } = await import('../src/app.js');
await ensureReady();
await new Promise((r) => setTimeout(r, 3500));
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const R = await import('../src/services/reviewsService.js');

await run(`DELETE FROM reviews`);

/** A completed order belonging to an account, the way the pipeline leaves one. */
async function buyer({ orders = 1 } = {}) {
  const uid = newId('usr');
  const email = `rev-${uid.slice(-6)}@example.com`;
  await run(`INSERT INTO users (id, email, created_at, updated_at) VALUES (@id,@e,@at,@at)`,
    { id: uid, e: email, at: nowIso() });
  const ids = [];
  for (let n = 0; n < orders; n++) {
    const oid = newId('ord');
    await run(`INSERT INTO orders (id, number, user_id, email, status, total, currency, created_at, updated_at)
               VALUES (@id,@num,@u,@e,'completed',999,'EUR',@at,@at)`,
      { id: oid, num: `FM-T-${oid.slice(-6)}`, u: uid, e: email, at: nowIso() });
    ids.push(oid);
  }
  return { uid, email, orders: ids };
}

console.log('— A review from a real order publishes itself —');
{
  const b = await buyer();
  const res = await R.addVerifiedReview({
    userId: b.uid, email: b.email, orderId: b.orders[0],
    author: 'Sam', stars: 5, body: 'Arrived in under a minute, exactly as described.',
  });
  ok('it is accepted', !!res.id && !res.deduped);
  const row = await get(`SELECT status, verified, order_id FROM reviews WHERE id=@id`, { id: res.id });
  ok('it is visible immediately', row.status === 'visible', row.status);
  ok('it is marked verified', row.verified === 1);
  ok('it remembers which order it is about', row.order_id === b.orders[0]);
}

console.log('\n— One per order, even when the button is double-tapped —');
{
  const b = await buyer();
  const write = () => R.addVerifiedReview({
    userId: b.uid, email: b.email, orderId: b.orders[0],
    author: 'Sam', stars: 4, body: 'Good, would buy again from this shop.',
  });
  const [a, c] = await Promise.all([write().catch((e) => ({ err: e })), write().catch((e) => ({ err: e }))]);
  ok('neither call throws', !a.err && !c.err, `${a.err?.message || ''} ${c.err?.message || ''}`);
  ok('both point at the same review', a.id === c.id, `${a.id} vs ${c.id}`);
  const n = await get(`SELECT COUNT(*) AS n FROM reviews WHERE order_id=@o`, { o: b.orders[0] });
  ok('exactly one row exists', Number(n.n) === 1, `${n.n}`);

  // And a later, sequential attempt is the same answer, not an error.
  const again = await write();
  ok('a second review for the same order is refused politely', again.deduped === true);
}

console.log('\n— A vouch waits for a person —');
{
  const res = await R.addReview({
    author: 'someone', stars: 5, body: 'best shop ever!!', source: 'discord',
    externalId: 'msg-1', discordUid: '4242',
  });
  ok('it is stored', !!res.id);
  ok('…but not published', res.pending === true);
  const row = await get(`SELECT status FROM reviews WHERE id=@id`, { id: res.id });
  ok('…and it sits in pending', row.status === 'pending', row.status);

  const stats = await R.reviewStats();
  const pub = await R.listReviews({ limit: 50 });
  ok('it does not move the public rating',
    !pub.some((r) => r.id === res.id), 'a pending review is on the storefront');
  ok('…and never counted towards it anyway (vouches are not verified)',
    stats.count === (await get(`SELECT COUNT(*) AS n FROM reviews WHERE verified=1 AND status='visible'`)).n * 1);

  const queue = await R.listPendingReviews();
  ok('it shows up in the moderation queue', queue.some((r) => r.id === res.id));

  // The same message twice is one review, not two.
  const dupe = await R.addReview({
    author: 'someone', stars: 5, body: 'best shop ever!!', source: 'discord', externalId: 'msg-1' });
  ok('the same message id does not create a second', dupe.deduped === true && dupe.id === res.id);

  ok('approving it publishes it', await R.setReviewStatus(res.id, 'visible'));
  const after = await R.listReviews({ limit: 50 });
  ok('…and now it is on the storefront', after.some((r) => r.id === res.id));
  ok('approving twice changes nothing', (await R.setReviewStatus(res.id, 'visible')) === false);
  ok('hiding it takes it back off', await R.setReviewStatus(res.id, 'hidden')
    && !(await R.listReviews({ limit: 50 })).some((r) => r.id === res.id));
}

console.log('\n— Nothing is invented —');
{
  await run(`DELETE FROM reviews`);
  const empty = await R.reviewStats();
  ok('no reviews means a count of zero', empty.count === 0);
  const ins = await R.reviewInsights();
  ok('…and no average at all, rather than a flattering one',
    ins.average === null, String(ins.average));
  ok('…and an empty distribution', Object.values(ins.distribution).every((n) => n === 0));
  ok('…and no coverage percentage to quote', ins.coverage.percent === null);
  ok('…and no recent average', ins.recent.average === null);
}

console.log('\n— Statistics a shopper could check and an owner could act on —');
{
  const spread = [5, 5, 5, 4, 2];
  for (const stars of spread) {
    const b = await buyer();
    await R.addVerifiedReview({ userId: b.uid, email: b.email, orderId: b.orders[0],
      author: 'B', stars, body: `A review worth ${stars} stars, written out properly.` });
  }
  const ins = await R.reviewInsights();
  ok('it counts every published verified review', ins.count === 5, `${ins.count}`);
  ok('the average is the real one', ins.average === 4.2, `${ins.average}`);
  ok('the distribution adds up', ins.distribution[5] === 3 && ins.distribution[4] === 1
    && ins.distribution[2] === 1, JSON.stringify(ins.distribution));
  ok('the positive share is computed, not guessed', ins.positiveShare === 80, `${ins.positiveShare}`);
  ok('recent reviews are counted in their own window', ins.recent.count === 5, `${ins.recent.count}`);
  ok('the pending queue is reported', typeof ins.pending === 'number');

  // Coverage counts only orders that were actually asked.
  const asked = await buyer();
  await run(`UPDATE orders SET review_request_sent_at=@at WHERE id=@id`,
    { at: nowIso(), id: asked.orders[0] });
  const ins2 = await R.reviewInsights();
  ok('an order that was asked and did not answer lowers coverage',
    ins2.coverage.asked === 1 && ins2.coverage.reviewed === 0 && ins2.coverage.percent === 0,
    JSON.stringify(ins2.coverage));

  await R.addVerifiedReview({ userId: asked.uid, email: asked.email, orderId: asked.orders[0],
    author: 'B', stars: 5, body: 'Answered the request, so coverage should move.' });
  const ins3 = await R.reviewInsights();
  ok('…and answering raises it', ins3.coverage.reviewed === 1 && ins3.coverage.percent === 100,
    JSON.stringify(ins3.coverage));
}

console.log('\n— Reputation is counted, never stored —');
{
  ok('nobody starts as anything', R.reputationFor({ reviews: 0, orders: 0 }).key === 'new');
  ok('one delivered order is a verified buyer', R.reputationFor({ reviews: 0, orders: 1 }).key === 'buyer');
  ok('a buyer who wrote one is a reviewer', R.reputationFor({ reviews: 1, orders: 1 }).key === 'reviewer');
  ok('three delivered orders is a regular', R.reputationFor({ reviews: 0, orders: 3 }).key === 'regular');
  ok('three orders and a review is trusted', R.reputationFor({ reviews: 1, orders: 3 }).key === 'trusted');
  ok('three of each is the top', R.reputationFor({ reviews: 3, orders: 3 }).key === 'top');
  ok('no level can be reached by writing alone',
    R.reputationFor({ reviews: 99, orders: 0 }).key === 'new', 'reviews alone promoted someone');

  const b = await buyer({ orders: 3 });
  for (const oid of b.orders) {
    await R.addVerifiedReview({ userId: b.uid, email: b.email, orderId: oid,
      author: 'Loyal', stars: 5, body: 'One of three real orders from this account.' });
  }
  const rep = await R.reputationOf(b.uid);
  ok('a real account resolves to a real level', rep.key === 'top', JSON.stringify(rep));
  ok('…with the counts it was derived from', rep.reviews === 3 && rep.orders === 3, JSON.stringify(rep));

  /* Counted, not cached: a refund takes the order back out and the level falls
     with it. A stored number would have gone on flattering someone whose
     orders were all reversed. */
  await run(`UPDATE orders SET status='refunded' WHERE id=@id`, { id: b.orders[0] });
  const after = await R.reputationOf(b.uid);
  ok('a refunded order stops counting immediately', after.orders === 2, JSON.stringify(after));
  ok('…and the level follows it down', after.key !== 'top', after.key);

  const anon = await R.reputationOf(null);
  ok('an unknown author has no level to claim', anon.key === 'new' && anon.orders === 0);
}

console.log('\n— The badge travels with the review —');
{
  const list = await R.listReviews({ limit: 50 });
  const mine = list.find((r) => r.author === 'Loyal');
  ok('a review from an account carries a reputation', !!mine?.reputation?.label, JSON.stringify(mine?.reputation));
  ok('…and its verified-purchase status', mine?.verified === 1 || mine?.verified === true, String(mine?.verified));

  const v = await R.addReview({ author: 'ghost', stars: 5, body: 'a vouch with no account behind it',
    source: 'discord', externalId: 'msg-ghost' });
  await R.setReviewStatus(v.id, 'visible');
  const withGhost = await R.listReviews({ limit: 50 });
  const ghost = withGhost.find((r) => r.id === v.id);
  ok('a vouch with no account gets no level rather than the lowest one',
    ghost && ghost.reputation === null, JSON.stringify(ghost?.reputation));
  ok('…and is not shown as a verified purchase', !ghost.verified);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
