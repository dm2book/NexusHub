import { chromium } from '/tmp/claude-0/-home-user-NexusHub/9a720bf2-59fa-5528-b1ab-c3ac8dc7368c/scratchpad/node_modules/playwright-core/index.mjs';
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
const DIR='/home/user/NexusHub/public/products/packs';
const NEW=['clashroyale','eafc','freefire','league','mlbb','pubg','minecraft','pokemongo','gta','discord-nitro'];
const files=fs.readdirSync(DIR).filter(f=>NEW.some(c=>f.startsWith(c+'-'))).sort();
const srv=http.createServer((req,res)=>{
  const p=decodeURIComponent(new URL(req.url,'http://x').pathname);
  const f=path.join(DIR,path.basename(p));
  if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.writeHead(200,{'content-type':'image/svg+xml'});return res.end(fs.readFileSync(f));}
  res.writeHead(200,{'content-type':'text/html'});
  res.end(`<html><body style="margin:0;background:#f6f7fb;font:11px system-ui"><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:16px">
  ${files.map(f=>`<div><div style="border-radius:12px;overflow:hidden;border:1px solid rgba(15,23,42,.1)"><img src="/${f}" style="width:100%;display:block"></div><div style="margin-top:4px;color:#475569">${f.replace('.svg','')}</div></div>`).join('')}
  </div></body></html>`);
});
await new Promise(r=>srv.listen(0,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const pg=await (await b.newContext({viewport:{width:1200,height:900}})).newPage();
await pg.goto(`http://127.0.0.1:${srv.address().port}/x`,{waitUntil:'load'});
await pg.waitForTimeout(900);
await pg.screenshot({path:'/tmp/packs.png',fullPage:true});
console.log(files.length,'nieuwe covers');
await b.close();srv.close();process.exit(0);
