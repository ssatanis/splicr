import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const user='10000000-0000-4000-8000-000000000001', org='10000000-0000-4000-8000-000000000002', screen='10000000-0000-4000-8000-000000000003', researcher='10000000-0000-4000-8000-000000000004';
function harness({member=true,role='member'}={}) {
 const writes=[];
 const client={from(table){const chain={select(){return chain},eq(){return chain},update(data){writes.push({table,data});return chain},maybeSingle:async()=>({data:table==='screens'?{id:screen,org_id:org,status:'draft',archived_at:null}:table==='org_members'?(member?{user_id:researcher}:null):{full_name:'Lab colleague',email:'colleague@example.org'},error:null}),then(resolve){resolve({error:null})}};return chain;}};
 const actions=loadTs('lib/intake/actions.ts',{mocks:{'server-only':{},'next/cache':{revalidatePath(){}},'@/lib/ingest/modal':{kickPrivateScreenQueue:async()=>{}},'@/lib/data/org':{getCurrentContext:async()=>({user:{id:user},org:{id:org}}),getOrgRole:async()=>role},'@/lib/supabase/server':{createClient:async()=>client},'./inspect':{},'./r2.server':{parseR2Uri:()=>null,deleteR2:async()=>{}}}});
 return {actions,writes};
}
const input={screenId:screen,name:'Custom screen',experimentDate:'2025-06-27',researcherId:researcher,config:{libraryLabel:'Lab map',comparisons:[{name:'Edited contrast'}]}};
test('draft saves editable metadata with a verified colleague and keeps the actual submitter unchanged',async()=>{
 const h=harness();assert.equal((await h.actions.saveIntakeDraft(input)).ok,true);
 assert.equal(h.writes.length,1);assert.equal(h.writes[0].data.researcher_name,'Lab colleague');assert.equal(h.writes[0].data.researcher_id,researcher);assert.equal(h.writes[0].data.experiment_date,'2025-06-27');assert.deepEqual(h.writes[0].data.intake_config,input.config);assert.equal(Object.hasOwn(h.writes[0].data,'created_by'),false);
});
test('out-of-workspace researchers cannot be attributed to a saved draft',async()=>{
 const h=harness({member:false});assert.equal((await h.actions.saveIntakeDraft(input)).ok,false);assert.deepEqual(h.writes,[]);
});
test('invalid calendar dates and oversized plans fail before any mutation',async()=>{
 const h=harness();for(const date of ['','2025-02-30','2025-99-01'])assert.equal((await h.actions.saveIntakeDraft({...input,experimentDate:date})).ok,false);
 assert.equal((await h.actions.saveIntakeDraft({...input,config:{large:'a'.repeat(512001)}})).ok,false);assert.deepEqual(h.writes,[]);
});
test('read-only members cannot save draft metadata',async()=>{
 const h=harness({role:'viewer'});assert.equal((await h.actions.saveIntakeDraft(input)).ok,false);assert.deepEqual(h.writes,[]);
});
