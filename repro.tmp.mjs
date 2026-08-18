/** Load a real product page the way a visitor does, through the Vercel entry. */
import { chromium } from '/tmp/claude-0/-home-user-NexusHub/9a720bf2-59fa-5528-b1ab-c3ac8dc7368c/scratchpad/node_modules/playwright-core/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
process.env.DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/forge_arch';
process.env.NODE_ENV='development'; process.env.LAUNCH_DATE='';
const { default: handler } = await import('/home/user/NexusHub/api/index.js');
const { get } = await import('/home/user/NexusHub/server/src/db/index.js');
const DIST='/home/user/NexusHub/dist';
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon','.jpg':'image/jpeg'};
const srv=http.createServer((req,res)=>{
  const p=new URL(req.url,'http://x').pathname;
  if(p.startsWith('/api/')||p==='/sitemap.xml'||p.startsWith('/product/')) return handler(req,res);
  for(const f of [path.join(DIST,p),path.join(DIST,p,'index.html'),path.join(DIST,'index.html')])
    if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});return res.end(fs.readFileSync(f));}
  res.writeHead(404);res.end();
});
await new Promise(r=>srv.listen(0,r));
const base=`http://127.0.0.1:${srv.address().port}`;
const prod=await get("SELECT id,name FROM products WHERE active=1 AND name LIKE '%Robux%' LIMIT 1")
        || await get("SELECT id,name FROM products WHERE active=1 LIMIT 1");
console.log('product:', prod.name, prod.id);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1280,height:900}});
const page=await ctx.newPage();
const errors=[];
page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE: '+m.text().slice(0,160));});
await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
await page.goto(`${base}/product/${prod.id}`,{waitUntil:'load',timeout:45000});
await page.waitForTimeout(3500);
const text=(await page.textContent('body')||'').replace(/\s+/g,' ').trim();
console.log('zichtbare tekst (eerste 180):', text.slice(0,180) || '(LEEG)');
console.log('body height:', await page.evaluate(()=>document.body.scrollHeight));
console.log('root children:', await page.evaluate(()=>document.getElementById('root')?.children.length ?? 'geen #root'));
errors.slice(0,6).forEach(e=>console.log(' ',e));
await page.screenshot({path:'/tmp/product-page.png',fullPage:false});
await b.close();srv.close();process.exit(0);
