import { chromium, devices } from '@playwright/test'
const OUT='/tmp/claude-0/-home-user-Henry/c86fcc02-f522-5075-9a8b-85812cddab87/scratchpad'
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox','--disable-dev-shm-usage']})
const ctx = await browser.newContext({ ...devices['iPhone 14'], browserName:'chromium', colorScheme:'light'})
const state={schemaVersion:1,settings:{name:'',timezone:'Europe/Prague',startDate:'2025-01-01',onboardedAt:new Date().toISOString(),steps:{weeklyTarget:35000,goalWeeklyTarget:49000,rampEnabled:true,rampStep:3500,distribution:[13,13,13,13,14,17,17],debtCapDays:2,carrySurplus:true,creditCapDays:1},exercise:{blocksPerDay:3,minutesPerBlock:15,level:1,debtCapBlocks:6,graceDaysPerWeek:1,excludedExerciseIds:[]},notifications:{enabled:false,blockTimes:['07:15','12:30','20:00'],stepCheckTime:'17:45',stepCheckThreshold:60,eveningReviewTime:'21:00',weeklyReviewTime:'19:00',quietFrom:'21:30',quietTo:'07:00',tone:'coach'},server:{baseUrl:'',token:''}},days:{},weeklyTasks:[],weeklyTaskLogs:{},measurements:[],ledger:[],bankruptcies:[],achievements:{}}
await ctx.addInitScript(`localStorage.setItem('henry.state.v1', ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem('henry.installHintDismissed','1')`)
const page=await ctx.newPage()
await page.goto('http://127.0.0.1:4173/#/tyden'); await page.waitForTimeout(600)
await page.getByRole('button',{name:'‹'}).click(); await page.waitForTimeout(300)
await page.getByRole('button',{name:'‹'}).click(); await page.waitForTimeout(300)
await page.getByRole('button',{name:'‹'}).click(); await page.waitForTimeout(400)
await page.screenshot({path:`${OUT}/light-tyden-back3.png`})
// dotykové cíle
await page.goto('http://127.0.0.1:4173/#/'); await page.waitForTimeout(600)
const boxes = await page.evaluate(()=>{
  const out=[]
  for (const el of document.querySelectorAll('button,a,input,[role=switch]')) {
    const r=el.getBoundingClientRect()
    if (r.width>0 && (r.height<44||r.width<44)) out.push({t:(el.textContent||el.getAttribute('aria-label')||el.tagName).trim().slice(0,32), w:Math.round(r.width), h:Math.round(r.height), c:el.className})
  }
  return out
})
console.log(JSON.stringify(boxes,null,1))
await ctx.close(); await browser.close()
