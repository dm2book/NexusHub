import { chromium } from '/tmp/claude-0/-home-user-NexusHub/9a720bf2-59fa-5528-b1ab-c3ac8dc7368c/scratchpad/node_modules/playwright-core/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
process.env.DATABASE_URL='postgres://postgres:postgres@127.0.0.1:5432/forge_arch';
process.env.NODE_ENV='development'; process.env.LAUNCH_DATE='';
const { default: handler } = await import('/home/user/NexusHub/api/index.js');
const DIST='/home/user/NexusHub/dist';
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.ico':'image/x-icon'};
const srv=http.createServer((req,res)=>{
  const p=new URL(req.url,'http://x').pathname;
  if(p.startsWith('/api/')||p==='/sitemap.xml'||p.startsWith('/product/')) return handler(req,res);
  for(const f of [path.join(DIST,p),path.join(DIST,p,'index.html'),path.join(DIST,'index.html')])
    if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});return res.end(fs.readFileSync(f));}
  res.writeHead(404);res.end();
});
await new Promise(r=>srv.listen(0,r));
const base=`http://127.0.0.1:${srv.address().port}`;
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:1400,height:820}})).newPage();
await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
await page.goto(base+'/shop?sort=name',{waitUntil:'load',timeout:45000});
await page.waitForTimeout(3500);
await page.evaluate(()=>window.scrollTo(0,905));
await page.waitForTimeout(900);
await page.screenshot({path:`/tmp/shot-${process.env.SHOT||'x'}.png`});
console.log('shot',process.env.SHOT);
await b.close();srv.close();process.exit(0);
