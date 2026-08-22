process.env.DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
const { all } = await import('/home/user/NexusHub/server/src/db/index.js');
const rows = await all("SELECT name, category, metadata FROM products WHERE active=1 ORDER BY category, name");
const byCat = {};
for (const r of rows) {
  const img = (JSON.parse(r.metadata||'{}').image)||'(geen)';
  (byCat[r.category] = byCat[r.category] || []).push(img.replace('/products/',''));
}
const packs = Object.entries(byCat).filter(([,v])=>v.some(i=>i.startsWith('packs/')));
const icons = Object.entries(byCat).filter(([,v])=>v.every(i=>!i.startsWith('packs/')));
console.log('categorieën die packs gebruiken:', packs.length);
for (const [c,v] of packs.slice(0,4)) console.log('  ',c, v.slice(0,3).join(' | '));
console.log('\ncategorieën met >1 product die GEEN pack gebruiken:');
for (const [c,v] of icons) if (v.length>1) console.log('  ', c.padEnd(14), v.length+'x', [...new Set(v)].join(' | '));
process.exit(0);
