import fs from 'node:fs';
import path from 'node:path';
import {expect,test} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {readEnv} from '../fixtures/handles';
const artifact=path.resolve(process.cwd(),'../../artifacts/gse145743-screen-20261005');
test('repeat the independent HeLa count analysis through the UI and verify both requested callers',async({page})=>{
 test.skip(process.env.SPLICR_E2E_OTHER_RESULTS!=='1','Requires the reviewed independent-study cloud run.');test.setTimeout(900_000);
 const raw=process.env.SPLICR_E2E_RAW_RESULTS==='1';
 const manifest=JSON.parse(fs.readFileSync(path.join(artifact,raw?'raw-ui-queued-run.json':'ui-queued-runs.json'),'utf8'));
 const env=readEnv();const admin=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
 await page.goto(`/dashboard/screens/${manifest.screen.id}`);
 if(process.env.SPLICR_E2E_RERUN==='1'){
  await page.getByRole('button',{name:'Run saved analysis again',exact:true}).click();
  await expect(page.getByRole('button',{name:'Run saved analysis again',exact:true})).toBeHidden({timeout:60_000});
 }
 await expect.poll(async()=>{const {data,error}=await admin.from('screens').select('status').eq('id',manifest.screen.id).single();if(error)throw error;if(data.status==='failed')throw new Error('Independent study cloud run failed.');return data.status;},{timeout:780_000,intervals:[10_000]}).toBe('complete');
 const {data:screen,error}=await admin.from('screens').select('id,name,current_run_id').eq('id',manifest.screen.id).single();if(error)throw error;
 const {data:run,error:runError}=await admin.from('runs').select('id,status,settings').eq('id',screen.current_run_id).single();if(runError)throw runError;
 const {data:stage,error:stageError}=await admin.from('run_stages').select('metrics').eq('run_id',run.id).eq('stage','hits').single();if(stageError)throw stageError;
 expect(stage.metrics.methods).toEqual(expect.arrayContaining(['mageck_rra','drugz']));
 const {count:drugz,error:hitError}=await admin.from('hits').select('id',{count:'exact',head:true}).eq('run_id',run.id).not('drugz_fdr','is',null);if(hitError)throw hitError;expect(drugz).toBeGreaterThan(20_000);
 await page.reload();await expect(page.getByRole('heading',{name:screen.name,exact:true})).toBeVisible();
 const response=await page.request.get(`/api/report/${screen.id}?format=json`);expect(response.ok()).toBeTruthy();
 const exported=await response.json();expect(exported.run.settings.fdr_threshold).toBe(0.05);expect(exported.run.settings.review_confirmed).toBe(true);
 const plot=page.getByRole('region',{name:'Effect and significance'});await plot.scrollIntoViewIfNeeded();
 await expect(plot).toContainText(`${exported.rows.count.toLocaleString('en-US')} genes drawn`);
 fs.writeFileSync(path.join(artifact,raw?'cloud-raw-export.json':'cloud-count-export.json'),JSON.stringify(exported,null,2));
 fs.writeFileSync(path.join(artifact,raw?'raw-completed-run.json':'repeat-ui-run.json'),JSON.stringify({screen,run,hit_stage:stage,drugz_rows:drugz},null,2));
 await page.screenshot({path:path.join(artifact,raw?'raw-results.png':'count-results.png'),fullPage:true});
});
