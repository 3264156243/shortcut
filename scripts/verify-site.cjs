/* Browser regression for all public routes and the main interactive flows.
 * Run: $env:SC_PLAYWRIGHT_MODULE='<path to playwright>'; node scripts/verify-site.cjs
 * Every write request is intercepted; the live feedback store is never touched.
 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.SC_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.SC_SITE_BASE||'http://127.0.0.1:8877';
const out=process.env.SC_SITE_QA_DIR||path.join(require('node:os').tmpdir(),'shortcut-site-v4-qa');
fs.mkdirSync(out,{recursive:true});
const routes=['','features/shortcut.html','features/taskwall.html','features/scball.html','features/control.html','features/transfer.html','features/android.html','download.html','changelog.html','faq.html','feedback.html'];
const failures=[];let checks=0;
(async()=>{
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({reducedMotion:'reduce'});
let submissions=0;
await context.route('**/updates/latest.json',r=>r.fulfill({json:{version:'2.5.1',pub_date:'2026-10-19',notes:'新增手机联动体验\n优化任务墙\n修复窗口交互',platforms:{'windows-x86_64':{url:base+'/updates/ShortCut_2.5.1_x64-setup.exe',size:7654321}}}}));
await context.route('**/updates/android/latest.json',r=>r.fulfill({json:{versionName:'0.2.4',versionCode:24,size:8000000,apkUrl:base+'/updates/android/ShortCut-0.2.4.apk'}}));
await context.route('**/sync/feedback.php',async r=>{
 const body=r.request().postDataJSON()||{};
 if(body.action!=='publicList'){submissions++;return r.fulfill({json:{ok:true}})}
 const en=r.request().headers().referer?.includes('/en/');
 const items=[{id:'demo-01',title:en?'A clearer keyboard hint':'希望增加更清楚的快捷键提示',details:en?'Show the shortcut beside the action.':'希望在相关操作旁边标明快捷键，便于记忆和使用。',type:'feature',area:en?'Quick Launch':'快捷方式',status:'resolved',time:'2026-10-20T12:00:00Z',version:'2.5.1',contact:'PRIVATE_CONTACT_SHOULD_NOT_RENDER',reply:{body:en?'Thank you. The shortcut reference is on the feature page.':'谢谢建议，功能页已经提供快捷键参考。',time:'2026-10-21T10:00:00Z'}},{id:'demo-02',title:en?'Mobile note layout':'手机端纸条布局建议',details:en?'Could the note use more of the screen?':'希望纸条在较小屏幕上拥有更多可读空间。',type:'ui',area:en?'Task Wall':'任务墙',status:'pending',time:'2026-10-21T12:00:00Z'}].filter(i=>(body.status==='all'||!body.status||i.status===body.status)&&(body.type==='all'||!body.type||i.type===body.type)&&(!body.query||(i.title+i.details).includes(body.query)));
 return r.fulfill({json:{ok:true,items}});
});
const page=await context.newPage();
let errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning'&&m.text().startsWith('[site]'))errors.push(m.text());});
for(const width of [1440,768,390]){
 await page.setViewportSize({width,height:width===1440?1000:844});
 for(const lang of ['', 'en/'])for(const route of routes){
  const url=base+'/'+lang+route;errors=[];
  const response=await page.goto(url,{waitUntil:'networkidle'});
  await page.evaluate(async()=>{await Promise.all([...document.images].map(i=>{i.loading='eager';return i.decode().catch(()=>{});}));});
  const info=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,badImages:[...document.images].filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src),h1:document.querySelectorAll('h1').length,dupes:[...document.querySelectorAll('[id]')].map(n=>n.id).filter((x,i,a)=>a.indexOf(x)!==i),privateLeak:document.body.innerText.includes('PRIVATE_CONTACT_SHOULD_NOT_RENDER')}));
  if(response.status()!==200||info.overflow||info.badImages.length||info.h1!==1||info.dupes.length||info.privateLeak||errors.length)failures.push({url,width,...info,errors});
  const broken=await page.evaluate(()=>[...document.querySelectorAll('a[href^="#"]')].filter(a=>a.hash&&a.hash!=='#'&&!document.getElementById(decodeURIComponent(a.hash.slice(1)))).map(a=>a.getAttribute('href')));
  if(broken.length)failures.push({url,width,broken});
  if((width===1440||width===390)&&!lang){await page.screenshot({path:path.join(out,(route||'home').replace(/[/\.]/g,'-')+'-'+width+'.png'),fullPage:true});}
  checks++;
 }
}
// The site must remain readable in dark mode on every route.
await page.setViewportSize({width:1440,height:1000});
await page.evaluate(()=>localStorage.setItem('sc-mode','dark'));
for(const route of routes){await page.goto(base+'/'+route);assert.equal(await page.locator('html').getAttribute('data-mode'),'dark');checks++;}
await page.screenshot({path:path.join(out,'feedback-dark.png'),fullPage:true});
await page.evaluate(()=>localStorage.setItem('sc-mode','light'));
for(const lang of ['', 'en/']){
 await page.goto(base+'/'+lang);
 const search=page.locator('[data-demo-search]');await search.fill(lang?'Files':'文件');assert.equal(await page.locator('[data-app]:visible').count(),1);await search.press('Enter');assert.match(await page.locator('[data-demo-status]').innerText(),lang?/Demo: opened/:/演示：已打开/);
 await page.locator('[data-note-complete]').click();assert.equal(await page.locator('[data-note-complete]').getAttribute('aria-pressed'),'true');
 await page.locator('[data-ball-toggle]').click();assert.equal(await page.locator('.ball-expanded').isVisible(),true);await page.locator('[data-ball-play]').click();assert.equal(await page.locator('[data-ball-play]').getAttribute('aria-pressed'),'true');
 await page.goto(base+'/'+lang+'features/transfer.html');await page.locator('[data-send-demo]').click();assert.match(await page.locator('[data-transfer-status]').innerText(),lang?/received/:/已收到/);
 await page.goto(base+'/'+lang+'faq.html');await page.locator('#faqSearch').fill(lang?'update':'更新');assert.ok(await page.locator('.faq').count()>0);await page.locator('#faqSearch').fill('NO_SUCH_QUESTION_999');assert.equal(await page.locator('.faq').count(),0);assert.equal(await page.locator('.faq-empty').isVisible(),true);
 await page.goto(base+'/'+lang+'changelog.html');await page.waitForLoadState('networkidle');assert.ok(await page.locator('.release-record').count()>3);assert.equal(await page.locator('.release-record[open]').count(),1);await page.locator('#releaseSearch').fill('NO_SUCH_RELEASE_999');assert.equal(await page.locator('#releaseEmpty').isVisible(),true);await page.locator('#releaseReset').click();await page.locator('[data-release-filter="fix"]').click();assert.equal(await page.locator('[data-release-filter="fix"]').getAttribute('aria-pressed'),'true');
 await page.goto(base+'/'+lang+'feedback.html');await page.waitForLoadState('networkidle');await page.locator('#fbSubmit').click();assert.ok((await page.locator('#fbStatus').innerText()).length>0);await page.locator('#fbTitle').fill(lang?'A sample message':'这是测试留言');await page.locator('#fbDetails').fill(lang?'Details for a mocked browser test only.':'这是浏览器拦截的测试内容，不会提交到线上。');await page.locator('#fbContact').fill('test-private@example.invalid');await page.locator('#fbSubmit').click();await page.waitForFunction(()=>document.querySelector('#fbStatus').classList.contains('is-success'));await page.locator('#fbStatusFilter').selectOption('resolved');await page.waitForTimeout(300);assert.equal(await page.locator('.feedback-message').count(),1);
 await page.goto(base+'/'+lang+'download.html');await page.waitForLoadState('networkidle');assert.match(await page.locator('#dlMain').getAttribute('href'),/setup\.exe$/);await page.locator('#channelGrid button').first().click();assert.equal(await page.locator('.modal').count(),1);await page.keyboard.press('Escape');assert.equal(await page.locator('.modal').count(),0);
 checks+=8;
}
// Mobile navigation, language pairing, and keyboard-focus visibility.
await page.setViewportSize({width:390,height:844});await page.goto(base+'/en/features/shortcut.html');await page.locator('.nav__burger').click();assert.equal(await page.locator('.drawer').getAttribute('data-open'),'true');await page.keyboard.press('Escape');assert.equal(await page.locator('.drawer').getAttribute('data-open'),'false');assert.equal(await page.locator('.nav__lang').getAttribute('href'),'/features/shortcut.html');
// Full motion path checks event forwarding and explicitly replayable demonstrations.
await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/');await page.mouse.move(1000,600);await page.mouse.move(1050,620);await page.waitForTimeout(150);assert.notEqual(await page.locator('[data-tilt]').evaluate(n=>n.style.getPropertyValue('--tilt-y')),'');await page.locator('.demo-run').click();await page.waitForTimeout(2300);assert.match(await page.locator('[data-demo-status]').innerText(),/演示：已打开/);
assert.equal(submissions,2);
await browser.close();
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,submissions,failures},null,2));console.log(JSON.stringify({checks,mockedSubmissions:submissions,failures,artifacts:out},null,2));if(failures.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
