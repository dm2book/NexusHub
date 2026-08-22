process.env.DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
const { all } = await import('/home/user/NexusHub/server/src/db/index.js');
const cats=['clashroyale','eafc','freefire','gta','league','mlbb','pubg','discord-nitro','minecraft','pokemongo'];
for (const c of cats) {
  const rows = await all("SELECT name, sku FROM products WHERE active=1 AND category=@c ORDER BY price", {c});
  console.log(c.padEnd(15), rows.map(r=>r.name).join(' | '));
}
process.exit(0);
