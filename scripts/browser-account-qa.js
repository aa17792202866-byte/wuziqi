async (page) => {
 await page.reload();await page.getByRole('heading',{name:'对弈大厅',exact:true}).waitFor();
 const account=await page.evaluate(async()=> (await (await fetch('/api/session')).json()).me.account);
 const context=await page.context().browser().newContext({viewport:{width:390,height:844}});
 const mobile=await context.newPage();await mobile.goto('http://localhost:3211');
 await mobile.getByLabel('账号',{exact:true}).fill(account);await mobile.getByLabel('密码',{exact:true}).fill('Browser-QA-password');
 await mobile.getByRole('button',{name:'登录并进入大厅',exact:true}).click();await mobile.getByRole('heading',{name:'对弈大厅',exact:true}).waitFor();
 await mobile.getByRole('button',{name:'我的对局',exact:true}).click();await mobile.getByRole('button',{name:'复盘',exact:true}).waitFor();
 await mobile.getByRole('button',{name:'复盘',exact:true}).click();await mobile.getByRole('button',{name:'终局',exact:true}).click();
 if(await mobile.locator('#replay-step').innerText()!=='第 3 / 3 手')throw new Error('Cross-device history mismatch');
 const before=await page.evaluate(async()=>{const s=await (await fetch('/api/session')).json();return s.players.filter(p=>p.id===s.me.id).length});if(before!==1)throw new Error('Duplicate lobby identity');
 await mobile.locator('#replay-range').fill('1');if(await mobile.locator('#replay-board .stone').count()!==1)throw new Error('Slider replay mismatch');
 await mobile.screenshot({path:'output/playwright/v2-mobile-replay.png',fullPage:true});
 if(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Overflow');
 await context.close();
 const fresh=await page.context().browser().newContext();const challenger=await fresh.newPage();await challenger.goto('http://localhost:3211');
 await challenger.getByRole('button',{name:'注册账号',exact:true}).click();await challenger.getByLabel('账号',{exact:true}).fill('invite_'+String(Date.now()).slice(-7));await challenger.getByLabel('昵称',{exact:true}).fill('邀请通知检查');await challenger.getByLabel('密码',{exact:true}).fill('Browser-QA-password');await challenger.getByLabel('确认密码',{exact:true}).fill('Browser-QA-password');await challenger.getByRole('button',{name:'注册并进入大厅',exact:true}).click();await challenger.getByRole('heading',{name:'对弈大厅',exact:true}).waitFor();
 const nickname=await page.locator('#nickname-button').innerText();await page.getByRole('button',{name:'我的对局',exact:true}).click();
 await challenger.locator('.player-row').filter({hasText:nickname}).getByRole('button',{name:'邀请对战'}).click();
 await page.getByRole('button',{name:'查看邀请',exact:true}).click();await page.getByRole('button',{name:'拒绝',exact:true}).click();
 await fresh.close();
 await page.evaluate(()=>document.documentElement.dataset.qaResult='PASS: cross-device login, durable history, unique presence, slider, mobile replay, background invitation');
}
