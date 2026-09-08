import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';

test.use({channel:'chrome', headless:true, trace:'off', screenshot:'off', video:'off', viewport:{width:1512,height:982}});

test('workspace prioritizes the stage and reveals context without crowded permanent panels', async ({browser}) => {
  const base=process.env.NAV_TEST_ORIGIN || 'http://127.0.0.1:5173';
  const context=await browser.newContext({viewport:{width:1512,height:982}});
  const errors:string[]=[];
  try {
    if(base.startsWith('https:')) {
      const token=readFileSync('D:/Projects/astra-operator-token.txt','utf8').trim();
      expect((await context.request.post(`${base}/api/auth`,{headers:{Origin:base},data:{token}})).status()).toBe(200);
    }
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);
    const setup=page.getByRole('button',{name:'Setup',exact:true});
    const code=page.getByRole('button',{name:'Code',exact:true});
    const timeline=page.getByRole('button',{name:'Timeline',exact:true});
    await expect(setup).toHaveAttribute('aria-expanded','false');
    await expect(code).toHaveAttribute('aria-expanded','false');
    await expect(timeline).toHaveAttribute('aria-expanded','false');
    await expect(page.locator('#setup-drawer')).not.toBeVisible();
    await expect(page.locator('#workspace-inspector')).not.toBeVisible();
    const stage=await page.locator('.stage-container').boundingBox();
    expect(stage).not.toBeNull();
    expect(stage!.width).toBeGreaterThan(1512*.9);
    expect(stage!.height).toBeGreaterThan(982*.65);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await setup.click();
    await expect(page.getByRole('dialog',{name:'Scene setup'})).toBeVisible();
    await expect(setup).toHaveAttribute('aria-expanded','true');
    await page.keyboard.press('Escape');
    await expect(setup).toHaveAttribute('aria-expanded','false');
    await expect(setup).toBeFocused();
    await code.click();
    await expect(page.getByRole('complementary',{name:'Workspace inspector'})).toBeVisible();
    await expect(code).toHaveAttribute('aria-expanded','true');
    await page.getByRole('button',{name:'Evidence',exact:true}).click();
    await expect(page.getByRole('button',{name:'Evidence',exact:true})).toHaveAttribute('aria-expanded','true');
    await page.getByRole('button',{name:'Trace',exact:true}).click();
    await expect(page.getByRole('button',{name:'Trace',exact:true})).toHaveAttribute('aria-expanded','true');
    await page.getByRole('button',{name:'Close inspector',exact:true}).click();
    await expect(page.locator('#workspace-inspector')).not.toBeVisible();
    await timeline.click();
    await expect(timeline).toHaveAttribute('aria-expanded','true');
    await expect(page.locator('#simulation-timeline')).toBeVisible();
    await timeline.click();
    await expect(timeline).toHaveAttribute('aria-expanded','false');
    await page.getByRole('button',{name:'World',exact:true}).click();
    await expect(page.locator('.simulation-stage')).toHaveAttribute('data-model-ready','true',{timeout:60000});
    await expect(page.getByRole('button',{name:/^Run baseline/})).toBeVisible();
    await page.getByRole('button',{name:'Camera overlay',exact:true}).click();
    await expect(page.locator('.camera-overlay-stage')).toBeVisible();
    await mkdir('artifacts/qa',{recursive:true});
    await page.screenshot({path:`artifacts/qa/${base.startsWith('https:')?'remote':'desktop'}-clean-navigation.png`});
    expect(errors).toEqual([]);
  } finally {await context.close();}
});
