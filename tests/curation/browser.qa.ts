import {chromium,expect} from '@playwright/test';
import express from 'express';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import {Store} from '../../gateway/curation/store.js';
import {createCurationApp} from '../../gateway/curation/app.js';
const root=mkdtempSync(path.resolve('runtime/curation-browser-'));
mkdirSync(path.join(root,'sources'));
mkdirSync('artifacts/curation',{recursive:true});
const store=new Store(path.join(root,'db'));
const app=createCurationApp(store,path.join(root,'sources'),'fixture-worker');
app.use(express.static(path.resolve('dist')));
app.get('/curation',(_q,r)=>r.sendFile(path.resolve('dist/index.html')));
const server=app.listen(0,'127.0.0.1');
await new Promise<void>(r=>server.once('listening',r));
const port=(server.address() as any).port;
const context=await chromium.launchPersistentContext(path.join(root,'browser'),{
 channel:'chrome',headless:true,viewport:{width:1440,height:1000},
 env:{...process.env,TEMP:root,TMP:root} as Record<string,string>});
const page=await context.newPage();
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try{
 for(const theme of ['light','dark'] as const){
 await page.emulateMedia({colorScheme:theme});
 await page.goto('http://127.0.0.1:'+port+'/curation');
 await expect(page.getByRole('heading',{name:'Library',exact:true})).toBeVisible();
 await expect(page.getByText('Start with a small, recorded task.')).toBeVisible();
 await page.screenshot({path:'artifacts/curation/library-'+theme+'.png',fullPage:true});
 }
 await page.getByRole('button',{name:'Collections',exact:true}).click();
 await page.getByLabel('Name',{exact:true}).fill('Browser fixture collection');
 await page.getByLabel('Intended use',{exact:true}).fill('Evaluation fixture; not training data');
 await page.getByRole('button',{name:'Create',exact:true}).click();
 await expect(page.getByRole('button',{name:/Browser fixture collection/})).toBeVisible();
 await page.reload();
 await page.getByRole('button',{name:'Collections',exact:true}).click();
 await expect(page.getByRole('button',{name:/Browser fixture collection/})).toBeVisible();
 await page.getByRole('button',{name:/Browser fixture collection/}).click();
 await expect(page.getByRole('button',{name:'Freeze immutable version'})).toBeDisabled();
 await page.getByRole('button',{name:'Register source',exact:true}).focus();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'Register a local BotFails snapshot'})).toBeVisible();
 await page.getByLabel('Name',{exact:true}).first().focus();
 if(await page.evaluate(()=>document.activeElement?.tagName)!=='INPUT')throw new Error('Keyboard focus failed');
 await page.screenshot({path:'artifacts/curation/source-form.png',fullPage:true});
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('Browser QA passed: light/dark, keyboard activation, persisted collection, empty-version rejection; no page errors.');
}finally{
 await context.close();
 await new Promise<void>(r=>server.close(()=>r()));
 store.close();
 rmSync(root,{recursive:true,force:true});
}
