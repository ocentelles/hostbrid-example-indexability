import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createFixture, sentence } from './server.mjs';

assert.equal(process.version, 'v22.23.3');
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const evidence = await mkdtemp('/tmp/hostbrid-indexability-'); await chmod(evidence, 0o700);
const commands = []; const cleanup = { chromeExitsAwaited:0, profilesRemoved:0, serverClosed:false, closedOriginRejectsRequest:false, browserCloseRequested:false };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, browserClosed, profile, ws, browserStderr = '';
let nextId = 0; const pending = new Map();
function cdp(method, params = {}, sessionId) {
  const id = ++nextId;
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); },10000);
    pending.set(id,{resolve: value => { clearTimeout(timer); resolve(value); },reject: error => { clearTimeout(timer); reject(error); }});
    ws.send(JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})}));
  });
}
async function execute(bin, args) {
  const child = spawn(bin, args, {stdio:['ignore','pipe','pipe']});
  let stdout = '', stderr = ''; child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  const [code, signal] = await once(child, 'close').finally(() => clearTimeout(timer));
  commands.push({binary:bin,args,code,signal,stdout,stderr});
  assert.equal(code, 0, `Command failed (${signal}): ${stderr}`); return stdout;
}
const npm = (await execute('npm', ['--version'])).trim(); assert.equal(npm, '10.9.9');
const chromeVersion = (await execute(chrome, ['--version'])).trim();
const server = createFixture(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
assert.equal(server.address().address, '127.0.0.1');
const origin = `http://127.0.0.1:${server.address().port}`;
const paths = ['/static','/javascript','/meta-noindex','/header-noindex','/remove-noindex','/missing'];
const content = html => html.match(/<p id="content">([^<]*)<\/p>/)?.[1];
const noindex = html => /<meta\s+name="robots"\s+content="noindex"\s*\/?\s*>/i.test(html);
const cases = [];
try {
  profile=await mkdtemp('/tmp/hostbrid-indexability-chrome-');await chmod(profile,0o700);
  const args=['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--metrics-recording-only','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'];
  browser=spawn(chrome,args,{stdio:['ignore','ignore','pipe']});browser.stderr.on('data', b => browserStderr+=b);
  browserClosed=once(browser,'close');
  let endpoint;
  for(let attempt=0;attempt<100;attempt++) {try {endpoint=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');break;}catch{await sleep(100);}}
  assert.ok(endpoint,'Chrome did not expose its owned loopback debugging endpoint');
  ws=new WebSocket(`ws://127.0.0.1:${endpoint[0]}${endpoint[1]}`);await once(ws,'open');
  ws.addEventListener('message', event => {const message=JSON.parse(event.data);if(!message.id)return;const operation=pending.get(message.id);if(!operation)return;pending.delete(message.id);message.error?operation.reject(new Error(JSON.stringify(message.error))):operation.resolve(message.result);});
  for (const path of paths) {
    const response = await fetch(origin + path); const html = await response.text();
    const expectedStatus = path === '/missing' ? 404 : 200;
    assert.equal(response.status, expectedStatus); assert.match(response.headers.get('content-type'), /^text\/html/);
    const initialContent = content(html), initialNoindex = noindex(html), headerNoindex = response.headers.get('x-robots-tag') === 'noindex';
    assert.equal(initialNoindex, ['/meta-noindex','/remove-noindex'].includes(path));
    assert.equal(headerNoindex, path === '/header-noindex');
    if (['/javascript','/remove-noindex'].includes(path)) { assert.equal(initialContent, ''); assert.ok(!html.includes(sentence)); }
    else assert.equal(initialContent, path === '/missing' ? 'Recurso ficticio inexistente.' : sentence);
    const id = path.slice(1); await writeFile(join(evidence, `${id}.http.html`), html, {mode:0o600});
    const renders = [];
    for (const width of [390,1280]) {
      const {targetId} = await cdp('Target.createTarget',{url:'about:blank'});
      const {sessionId} = await cdp('Target.attachToTarget',{targetId,flatten:true});
      try {
        await cdp('Page.enable',{},sessionId);
        await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390},sessionId);
        await cdp('Page.navigate',{url:origin+path},sessionId);
        let observed;
        for (let attempt=0;attempt<100;attempt++) {
          const evaluation = await cdp('Runtime.evaluate',{expression:`(async()=>{if(document.readyState!=='complete')return null;await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));const p=document.querySelector('#content');if(!p)return null;const style=getComputedStyle(p),rect=p.getBoundingClientRect();return {dom:document.documentElement.outerHTML,content:p.textContent,metaNoindex:!!document.querySelector('meta[name="robots"][content="noindex"]'),viewportWidth:innerWidth,viewportHeight:innerHeight,scrollWidth:document.documentElement.scrollWidth,fontsReady:document.fonts.status==='loaded',imagesReady:[...document.images].every(i=>i.complete),visible:rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden',bodyText:document.body.innerText};})()`,awaitPromise:true,returnByValue:true},sessionId);
          assert.ok(!evaluation.exceptionDetails,JSON.stringify(evaluation.exceptionDetails));
          observed=evaluation.result.value;if(observed)break;await sleep(50);
        }
        assert.ok(observed,'Navigation did not reach a complete fixture document');
        assert.equal(observed.content,path === '/missing' ? 'Recurso ficticio inexistente.' : sentence);
        assert.equal(observed.metaNoindex,path === '/meta-noindex');
        assert.equal(observed.viewportWidth,width);assert.equal(observed.viewportHeight,900);
        assert.ok(observed.fontsReady&&observed.imagesReady&&observed.visible);assert.ok(observed.scrollWidth<=width);
        assert.ok(observed.bodyText.includes(observed.content));
        const {data}=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);
        const png=Buffer.from(data,'base64'),screenshot=join(evidence,`${id}-${width}.png`);
        assert.ok(png.length>1000);assert.equal(png.readUInt32BE(16),width);assert.equal(png.readUInt32BE(20),900);
        await writeFile(screenshot,png,{mode:0o600});await writeFile(join(evidence,`${id}-${width}.dom.html`),observed.dom,{mode:0o600});
        renders.push({width,height:900,renderedContent:observed.content,renderedMetaNoindex:observed.metaNoindex,actualViewportWidth:observed.viewportWidth,actualViewportHeight:observed.viewportHeight,fontsReady:observed.fontsReady,imagesReady:observed.imagesReady,visible:observed.visible,noHorizontalOverflow:true,screenshot,screenshotSHA256:createHash('sha256').update(png).digest('hex'),domSHA256:createHash('sha256').update(observed.dom).digest('hex')});
      } finally { await cdp('Target.closeTarget',{targetId}); }
    }
    cases.push({path,status:'pass',httpStatus:response.status,initialContent,initialMetaNoindex:initialNoindex,xRobotsTag:response.headers.get('x-robots-tag'),initialHtmlSHA256:createHash('sha256').update(html).digest('hex'),renders,interpretation:path === '/remove-noindex' ? 'Initial noindex is present although local Chrome removes it. This does not establish that Google renders or indexes the page.' : path === '/missing' ? 'Real HTTP404 despite a readable rendered page.' : initialNoindex || headerNoindex ? 'Indexing exclusion directive detected; browser visibility is a different observation.' : 'Text availability observed; no Google crawling/indexing/ranking result measured.'});
  }
} finally {
  try {
    if(browser) {
      if(ws&&ws.readyState===WebSocket.OPEN) {cleanup.browserCloseRequested=true;ws.send(JSON.stringify({id:++nextId,method:'Browser.close'}));}
      const timer=setTimeout(()=>{cleanup.fallbackSignal='SIGTERM';browser.kill('SIGTERM');},5000);
      const killTimer=setTimeout(()=>{cleanup.fallbackSignal='SIGKILL';browser.kill('SIGKILL');},10000);
      const [code,signal]=await browserClosed.finally(()=>{clearTimeout(timer);clearTimeout(killTimer);});
      cleanup.chromeExitsAwaited++;cleanup.chromeExitCode=code;cleanup.chromeExitSignal=signal;
      commands.push({binary:chrome,args:browser.spawnargs.slice(1),code,signal,stderr:browserStderr});
      if(ws)ws.close();assert.ok(code===0||signal==='SIGTERM','Owned Chrome did not close cleanly');
    }
  } finally {
    try {
      if(profile) {await rm(profile,{recursive:true,force:true});cleanup.profilesRemoved++;}
    } finally {
      try {
        await new Promise((resolve,reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); cleanup.serverClosed = true;
        await assert.rejects(fetch(origin + '/static')); cleanup.closedOriginRejectsRequest = true;
      } finally {
        await writeFile(join(evidence,'commands.json'),JSON.stringify(commands,null,2)+'\n',{mode:0o600});
        await writeFile(join(evidence,'cleanup.json'),JSON.stringify({origin,evidence,...cleanup},null,2)+'\n',{mode:0o600});
      }
    }
  }
}
assert.equal(cases.length,6); assert.equal(cleanup.chromeExitsAwaited,1); assert.equal(cleanup.profilesRemoved,1);
const sourceFiles = ['package.json','LICENSE','README.md','server.mjs','essay.mjs'];
const hashes = Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name,createHash('sha256').update(await readFile(new URL(name,import.meta.url))).digest('hex')])));
const result = {date:'2026-10-08',license:'MIT',node:process.version,npm,chrome:chromeVersion,origin,evidence,cases,cleanup,sourceHashes:hashes,limits:['Local synthetic HTTP fixture only; no HTTPS or Hostbrid native export tested','No Googlebot, Search Console, crawl, index or ranking measured','No Lovable, Claude or other tool-generated export tested','No GA events, public deployment or external site crawl','Browser rendering alone is not an indexing decision']};
await writeFile(join(evidence,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(result,null,2));
