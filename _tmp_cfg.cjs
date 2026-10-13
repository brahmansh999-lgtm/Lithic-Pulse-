const { chromium } = require('playwright');
const OUT='C:/Users/prana/AppData/Local/Temp/claude/e--PLANNER---Copy/dd068276-f999-4f5e-87ee-dae8d87b9dc1/scratchpad';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function clickBtn(page,re){const b=page.locator('button');const n=await b.count();for(let i=0;i<n;i++){const t=((await b.nth(i).innerText().catch(()=>''))||'').trim();if(re.test(t)){await b.nth(i).click().catch(()=>{});return t;}}return null;}
async function clickText(page,re){const el=page.getByText(re).first();if(await el.count()){await el.click().catch(()=>{});return true;}return false;}
(async()=>{
  const browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1500,height:950}});
  const errs=[];page.on('pageerror',e=>errs.push(e.message.slice(0,140)));page.on('console',m=>{if(m.type()==='error')errs.push('[e]'+m.text().slice(0,110));});
  await page.goto('http://localhost:5173',{waitUntil:'networkidle',timeout:30000});await wait(1200);
  await clickBtn(page,/LAUNCH/i);await wait(1000);
  await clickBtn(page,/HOME ?OWNER/i);await wait(2500);
  // pick first site
  await clickText(page,/Torrington Park/i);await wait(2500);
  await page.screenshot({path:OUT+'/cfg_site.png'});
  let txt=await page.locator('body').innerText().catch(()=>'');
  console.log('AFTER SITE:', txt.slice(0,180).replace(/\n+/g,' | '));
  // continue / pick unit repeatedly until we see rc-vis-chip
  for(let i=0;i<6;i++){
    const chips=await page.locator('.rc-vis-chip').count();
    if(chips>0){console.log('toggles appeared at step',i);break;}
    // click any forward-ish control
    let did=await clickBtn(page,/CONTINUE|CONFIGURE|SELECT|NEXT|→|VIEW|CHOOSE THIS|START/i);
    if(!did){ // maybe unit cards are divs
      did = await clickText(page,/1B|2B|3B|4B|Studio|Unit/i);
    }
    console.log('step',i,'action:',did);
    await wait(3000);
  }
  await page.screenshot({path:OUT+'/cfg_configure.png'});
  const chips=page.locator('.rc-vis-chip');const nc=await chips.count();const labels=[];
  for(let i=0;i<nc;i++)labels.push(((await chips.nth(i).innerText().catch(()=>''))||'').trim());
  console.log('LAYER TOGGLES:',labels.join(' | ')||'(none)');
  console.log('ERRORS:',errs.slice(0,6).join(' || ')||'none');
  await browser.close();
})();
