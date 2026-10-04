/**
 * The complete product discovery scan, from a terminal, with no time limit:
 *
 *   DATABASE_URL=… node scripts/discovery-full-scan.mjs            # start or resume
 *   DATABASE_URL=… node scripts/discovery-full-scan.mjs --restart  # from the beginning
 *
 * Same steps, same rules, same per-host spacing as the admin button — just no
 * 30-second function limit between them. Uses the partner-API credentials
 * stored in the database / environment, like the server does.
 */
const { ensureReady } = await import('../src/app.js');
await ensureReady();
const P = await import('../src/services/discovery/discoveryPipeline.js');
const restart = process.argv.includes('--restart');
let st = await P.startFullScan({ actor: 'cli', restart });
console.log(`Complete scan ${st.id}: ${st.queries?.length ?? '?'} search terms`);
for (;;) {
  // eslint-disable-next-line no-await-in-loop
  st = await P.fullScanStep({ budgetMs: 60_000 });
  console.log(`  ${st.phase}: terms ${st.qi}/${st.totalQueries}, candidates ${st.ei}/${st.totalCandidates ?? '…'}, observations ${st.recorded}`);
  if (st.phase === 'done' || st.phase === 'idle') break;
}
console.log('\nResult:', JSON.stringify({ byGate: st.byGate, added: st.added, unavailableSources: st.unavailable }, null, 2));
process.exit(0);
