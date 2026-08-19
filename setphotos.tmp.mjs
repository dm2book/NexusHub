import fs from 'node:fs';
process.env.DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/forge_arch';
process.env.NODE_ENV='development';
const p = JSON.parse(fs.readFileSync('/tmp/photos.json','utf8'));
const { all, run } = await import('/home/user/NexusHub/server/src/db/index.js');
const want = [['Xbox Game Pass Ultimate — 3 Months', p.black], ['Netflix Gift Card €25', p.white],
              ['1,200 PokéCoins — Pokémon GO', p.render], ['3,500 Minecoins — Minecraft', p.navy],
              ['Whale Shark Card — GTA', p.grey], ['1,200 Gems — Clash Royale', p.black],
              ['565 Diamonds — Mobile Legends', p.grey]];
for (const [name, uri] of want) {
  const r = await all('SELECT id,metadata FROM products WHERE name=@n LIMIT 1', { n: name });
  if (!r[0]) continue;
  const md = { ...(JSON.parse(r[0].metadata||'{}')), image: uri };
  await run('UPDATE products SET metadata=@m WHERE id=@p', { m: JSON.stringify(md), p: r[0].id });
}
console.log('art gezet');
process.exit(0);
