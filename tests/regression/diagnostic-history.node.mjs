import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, it } from 'node:test';
const ORG='11111111-1111-4111-8111-111111111111',BIZ='22222222-2222-4222-8222-222222222222';
const RUN='33333333-3333-4333-8333-333333333333',OLD='44444444-4444-4444-8444-444444444444';
const OTHER='55555555-5555-4555-8555-555555555555';
const source=stripTypeScriptTypes(readFileSync('supabase/functions/visibility-diagnostic/index.ts','utf8').replace(/^import .*\n/,''));
async function execute(compatible,fail=false){
 const base={org_id:ORG,business_id:BIZ,question_set_id:'questions',run_type:'audit',phase:'standalone',status:'completed',experiment_id:null,repetitions:1,selected_providers:['openai'],total_jobs:24,completed_jobs:24,failed_jobs:0};
 const runs=[{...base,id:RUN,name:'latest',completed_at:'2026-09-09T12:00:00Z'},{...base,id:OLD,name:'previous',completed_at:'2026-09-08T12:00:00Z'},{...base,id:OTHER,name:'different conditions',completed_at:'2026-09-07T12:00:00Z'}];
 const tables={organization_members:[{org_id:ORG,user_id:'user'}],businesses:[{id:BIZ,org_id:ORG,name:'fixture',is_client_business:true,active:true}],measurement_runs:runs,
  measurements:Array.from({length:24},(_,i)=>({id:String(i),org_id:ORG,run_id:RUN,question_id:'q'+i,valid:true,was_client_mentioned:i<3,client_position:i<3?1:null})),
  questions:[],run_metrics_overall:runs.map((r,i)=>({run_id:r.id,org_id:ORG,valid_n:24,mention_n:i===0?3:5,inclusion_rate_pct:i===0?12.5:20.83,top3_rate_pct:12.5})),
  measurement_citation_attributions_actionable_v2:[],measurement_citation_attributions:[]};
 const db={auth:{getUser:async()=>({data:{user:{id:'user'}},error:null})},from(table){
  assert.ok(table in tables,table);let rows=[...tables[table]];
  const q={select:()=>q,eq:(k,v)=>{rows=rows.filter(r=>r[k]===v);return q},is:(k,v)=>{rows=rows.filter(r=>r[k]===v);return q},in:(k,vs)=>{rows=rows.filter(r=>vs.includes(r[k]));return q},order:()=>q,limit:n=>{rows=rows.slice(0,n);return q},maybeSingle:async()=>({data:rows[0]??null,error:null}),then:(res,rej)=>Promise.resolve({data:rows,error:null}).then(res,rej)};return q;
 },rpc:async(name)=>{
   if(name==='get_compatible_audit_runs_v01')return {data:compatible.map(run_id=>({run_id})),error:fail?{message:'fixture failure'}:null};
   assert.ok(['get_competitor_significance_v01','get_first_run_independent_site_observations_v01'].includes(name));
   return {data:[],error:null};
 }};
 let handler;runInNewContext(source,{Deno:{env:{get:n=>n==='SUPABASE_URL'?'https://fixture.invalid':n==='SUPABASE_SERVICE_ROLE_KEY'?'fixture':undefined},serve:f=>{handler=f}},createClient:()=>db,Request,Response,URL,console});
 const res=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify({orgId:ORG,businessId:BIZ})}));
 assert.equal(res.status,200);return res.json();
}
describe('diagnostic comparison versus history',()=>{
 it('preserves historical values without declaring them comparable',async()=>{
  const r=await execute([]);assert.equal(r.comparison.status,'unverified');assert.equal(r.history.length,3);assert.equal(r.trend.length,0);assert.equal(r.diagnostic.overview.visibilityRatePct,12.5);
 });
 it('compares only the runs returned by the common RPC',async()=>{
  const r=await execute([RUN,OLD]);assert.equal(r.comparison.status,'verified');assert.equal(r.history.length,3);assert.deepEqual(r.trend.map(x=>x.runId),[OLD,RUN]);
 });
 it('retains history when comparison lookup fails',async()=>{
  const r=await execute([],true);assert.equal(r.comparison.status,'unavailable');assert.equal(r.history.length,3);assert.equal(r.trend.length,0);
 });
});
