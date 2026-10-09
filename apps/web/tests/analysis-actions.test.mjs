import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
const screenId = "076cc506-df8b-44e5-843b-55831abbe7df";
const runId = "a5a10887-08f4-475a-b04e-d749d2ca61cf";
function harness({role="member", rpc={data:runId,error:null}, unavailable=false}={}) {
  const calls=[];
  const app=loadTs("lib/data/analysis-actions.ts", {mocks:{
    "next/cache": {revalidatePath: p=>calls.push(["refresh",p])},
    "@/lib/data/org": {getCurrentContext:async()=>({user:{id:"researcher"},org:{id:"workspace"},role})},
    "@/lib/supabase/server": {createClient:async()=>({rpc:async(name,args)=>{calls.push(["rpc",name,args]);return rpc;}})},
    "@/lib/ingest/modal": {cancelPrivateScreenRun:async id=>{calls.push(["modal",id]);if(unavailable)throw Error("offline");}},
  }});
  return {...app,calls};
}
test("cancellation checks researcher permission before touching the worker",async()=>{
  for(const role of [null,"viewer"]){const h=harness({role});assert.equal((await h.cancelScreenAnalysis(screenId,runId)).ok,false);assert.deepEqual(h.calls,[]);}
  const h=harness();assert.equal((await h.cancelScreenAnalysis("invalid",runId)).ok,false);assert.deepEqual(h.calls,[]);
});
test("a finished run or rejected workspace cannot cancel any Modal invocation",async()=>{
  for(const rpc of [{data:null,error:null},{data:null,error:{code:"42501"}}]){const h=harness({rpc});assert.equal((await h.cancelScreenAnalysis(screenId,runId)).ok,false);assert.equal(h.calls.filter(c=>c[0]==="modal").length,0);}
});
test("only a durably authorized cancellation reaches Modal, and HTTP failure preserves it for retry",async()=>{
  for(const unavailable of [false,true]){const h=harness({unavailable});assert.equal((await h.cancelScreenAnalysis(screenId,runId)).ok,true);assert.deepEqual(h.calls.slice(0,2),[["rpc","cancel_screen_analysis",{p_screen_id:screenId,p_run_id:runId}],["modal",runId]]);assert.equal(h.calls.filter(c=>c[0]==="refresh").length,2);}
});
