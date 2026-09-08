import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-visibility-postprocess-token","Access-Control-Allow-Methods":"POST,OPTIONS"};
const ATTRIBUTION_VERSION="0.1.0";
const COMPARATIVE_GUARD_VERSION="0.1";
const DIRECT_MAX_DISTANCE=450;
const SECTION_MAX_DISTANCE=1800;

type Citation={url:string;domain:string|null;title:string|null;start:number;end:number};
type Span={start:number;end:number;text:string};
type Entity={canonicalKey:string;displayName:string;mentionId:string|null;names:string[];spans:Span[]};

function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
function isRecord(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==="object"&&!Array.isArray(v)}
function readDefaultKey(name:string):string|undefined{const raw=Deno.env.get(name)?.trim();if(!raw)return;try{const p=JSON.parse(raw) as unknown;if(!isRecord(p))return;if(typeof p.default==="string"&&p.default.trim())return p.default.trim();for(const v of Object.values(p))if(typeof v==="string"&&v.trim())return v.trim()}catch{}return}
function env(){return{url:Deno.env.get("SUPABASE_URL")?.trim()||"",secret:readDefaultKey("SUPABASE_SECRET_KEYS")??Deno.env.get("SUPABASE_SECRET_KEY")?.trim()??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()??""}}
function normDomain(url:string):string|null{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,"")}catch{return null}}
function uniqueNames(values:(string|null|undefined)[]):string[]{const out:string[]=[];const seen=new Set<string>();for(const raw of values){const v=raw?.trim();if(!v)continue;const k=v.toLocaleLowerCase("ko-KR");if(!seen.has(k)){seen.add(k);out.push(v)}}return out.sort((a,b)=>b.length-a.length)}
function findAll(text:string,needle:string):Span[]{const out:Span[]=[];if(!needle)return out;const lower=text.toLocaleLowerCase("ko-KR"),n=needle.toLocaleLowerCase("ko-KR");let at=0;while(at<lower.length){const i=lower.indexOf(n,at);if(i<0)break;out.push({start:i,end:i+needle.length,text:text.slice(i,i+needle.length)});at=i+Math.max(1,n.length)}return out}
function lineBounds(text:string,pos:number){const s=text.lastIndexOf("\n",Math.max(0,pos-1))+1;const e0=text.indexOf("\n",pos);return{start:s,end:e0<0?text.length:e0}}
function sentenceStart(text:string,pos:number):number{let best=0;for(const mark of ["\n",".","!","?","。"]){const i=text.lastIndexOf(mark,Math.max(0,pos-1));if(i>=0)best=Math.max(best,i+1)}return best}
function looksLikeSectionStarter(text:string,span:Span):boolean{const b=lineBounds(text,span.start);const line=text.slice(b.start,b.end).trim();if(/^#{1,6}\s+/.test(line))return true;if(/^\s*(?:\d{1,2}[.)]|[①-⑳])\s*/u.test(line))return true;if(/^\s*[-*•]\s+/.test(line)&&line.indexOf(span.text)>=0&&line.indexOf(span.text)<80)return true;return false}
function collectCitations(payload:unknown):Citation[]{const out:Citation[]=[];const seen=new Set<string>();const walk=(node:unknown)=>{if(!node||typeof node!=="object")return;if(Array.isArray(node)){for(const x of node)walk(x);return}const r=node as Record<string,unknown>;if(r.type==="url_citation"&&typeof r.url==="string"&&Number.isFinite(Number(r.start_index))&&Number.isFinite(Number(r.end_index))){const start=Number(r.start_index),end=Number(r.end_index),url=r.url.replace(/#.*$/,"");const key=`${url}|${start}|${end}`;if(!seen.has(key)){seen.add(key);out.push({url,domain:normDomain(url),title:typeof r.title==="string"?r.title.slice(0,500):null,start,end})}}for(const v of Object.values(r))walk(v)};walk(payload);return out.sort((a,b)=>a.start-b.start||a.end-b.end)}
function nearestNextSectionStart(text:string,entities:Entity[],after:number):number{let next=text.length;for(const e of entities){for(const s of e.spans){if(s.start>after&&looksLikeSectionStarter(text,s)&&s.start<next)next=s.start}}return next}
function isComparativeTarget(text:string,span:Span,citationStart:number):boolean{
  if(citationStart<=span.end)return false;
  const between=text.slice(span.end,Math.min(citationStart,span.end+120)).replace(/^[\s*_`~()\[\]{}<>:;,.!?—–-]+/u,"");
  return /^(?:보다|에\s*비해(?:서)?|와\s*비교|과\s*비교|대비해(?:서)?)/u.test(between);
}
function chooseAttribution(text:string,c:Citation,entities:Entity[]):{entity:Entity;span:Span;level:"direct"|"section";relation:string;distance:number}|null{
  const directs:{entity:Entity;span:Span;distance:number;relation:string}[]=[];
  for(const e of entities){for(const s of e.spans){if(s.end>c.start)continue;if(isComparativeTarget(text,s,c.start))continue;const distance=c.start-s.end;if(distance>DIRECT_MAX_DISTANCE)continue;const lb=lineBounds(text,c.start);if(s.start>=lb.start&&s.end<=lb.end){directs.push({entity:e,span:s,distance,relation:text.slice(lb.start,lb.end).trim().startsWith("|")?"same_row":"same_line"});continue}const ss=sentenceStart(text,c.start);if(s.start>=ss){directs.push({entity:e,span:s,distance,relation:"same_sentence"})}}}
  if(directs.length){directs.sort((a,b)=>a.distance-b.distance||b.span.end-a.span.end);const best=directs[0];return{...best,level:"direct"}}
  const sections:{entity:Entity;span:Span;distance:number}[]=[];
  for(const e of entities){for(const s of e.spans){if(s.end>c.start||!looksLikeSectionStarter(text,s))continue;if(isComparativeTarget(text,s,c.start))continue;const distance=c.start-s.end;if(distance>SECTION_MAX_DISTANCE)continue;const next=nearestNextSectionStart(text,entities,s.start);if(c.start<next)sections.push({entity:e,span:s,distance})}}
  if(sections.length){sections.sort((a,b)=>a.distance-b.distance);const best=sections[0];return{...best,level:"section",relation:"same_section"}}
  return null;
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  const e=env();if(!e.url||!e.secret)return json({ok:false,error:"SERVER_NOT_CONFIGURED"},500);
  const db=createClient(e.url,e.secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const supplied=req.headers.get("x-visibility-postprocess-token")?.trim()??"";if(!supplied)return json({ok:false,error:"FORBIDDEN"},403);
  const{data:tokenRow,error:tokenError}=await db.from("visibility_postprocess_tokens").select("name").eq("token",supplied).eq("active",true).maybeSingle();if(tokenError||!tokenRow)return json({ok:false,error:"FORBIDDEN"},403);
  let body:unknown;try{body=await req.json()}catch{return json({ok:false,error:"INVALID_REQUEST"},400)}
  if(!isRecord(body)||typeof body.runId!=="string")return json({ok:false,error:"INVALID_REQUEST"},400);
  const runId=body.runId;
  const{data:run,error:runErr}=await db.from("measurement_runs").select("id,org_id,business_id,run_type,phase,status,experiment_id").eq("id",runId).maybeSingle();
  if(runErr||!run)return json({ok:false,error:"RUN_NOT_FOUND"},404);
  if(run.run_type!=="audit"||run.phase!=="standalone"||run.experiment_id!==null||!["completed","partial"].includes(String(run.status)))return json({ok:false,error:"RUN_NOT_ELIGIBLE"},409);
  const orgId=String(run.org_id),businessId=String(run.business_id);
  const{data:business,error:bizErr}=await db.from("businesses").select("id,name,aliases").eq("id",businessId).eq("org_id",orgId).maybeSingle();if(bizErr||!business)return json({ok:false,error:"BUSINESS_NOT_FOUND"},404);
  const targetNames=uniqueNames([String(business.name),...((business.aliases??[]) as string[])]);
  const{data:measurements,error:mErr}=await db.from("measurements").select("id,job_id,response_text").eq("org_id",orgId).eq("run_id",runId);if(mErr)return json({ok:false,error:"MEASUREMENT_READ_FAILED"},500);
  const{data:canon,error:cErr}=await db.from("measurement_entity_canonicalizations").select("canonical_key,canonical_display_name,measurement_id,measurement_mention_id").eq("org_id",orgId).eq("business_id",businessId).eq("source_run_id",runId);if(cErr)return json({ok:false,error:"CANONICAL_READ_FAILED"},500);
  const mentionIds=[...new Set((canon??[]).map(r=>r.measurement_mention_id?String(r.measurement_mention_id):null).filter(Boolean))] as string[];
  const{data:mentions,error:mmErr}=mentionIds.length?await db.from("measurement_mentions").select("id,display_name,matched_alias").eq("org_id",orgId).in("id",mentionIds):{data:[],error:null};if(mmErr)return json({ok:false,error:"MENTION_READ_FAILED"},500);
  const mentionMap=new Map((mentions??[]).map(r=>[String(r.id),r]));
  let inserted=0,direct=0,section=0,withPayload=0;
  for(const m of measurements??[]){
    const text=String(m.response_text??"");if(!text)continue;
    const{data:p,error:pErr}=await db.from("provider_payloads").select("response_payload").eq("job_id",m.job_id).maybeSingle();if(pErr)return json({ok:false,error:"PAYLOAD_READ_FAILED"},500);if(!p)continue;withPayload++;
    const citations=collectCitations(p.response_payload);if(!citations.length)continue;
    const entities:Entity[]=[];
    const targetSpans=targetNames.flatMap(n=>findAll(text,n));
    if(targetSpans.length)entities.push({canonicalKey:`business:${businessId}`,displayName:String(business.name),mentionId:null,names:targetNames,spans:targetSpans});
    const rows=(canon??[]).filter(r=>String(r.measurement_id)===String(m.id)&&String(r.canonical_key)!==`business:${businessId}`);
    const byKey=new Map<string,{display:string;mentionIds:string[]}>();
    for(const r of rows){const key=String(r.canonical_key),cur=byKey.get(key)??{display:String(r.canonical_display_name??""),mentionIds:[]};if(r.measurement_mention_id)cur.mentionIds.push(String(r.measurement_mention_id));byKey.set(key,cur)}
    for(const [key,g] of byKey){const names:string[]=[g.display];for(const id of g.mentionIds){const mr=mentionMap.get(id) as Record<string,unknown>|undefined;if(mr){if(typeof mr.display_name==="string")names.push(mr.display_name);if(typeof mr.matched_alias==="string")names.push(mr.matched_alias)}}const ns=uniqueNames(names);const spans=ns.flatMap(n=>findAll(text,n));if(spans.length)entities.push({canonicalKey:key,displayName:g.display,mentionId:g.mentionIds[0]??null,names:ns,spans})}
    if(!entities.length)continue;
    const payloadRows:Record<string,unknown>[]=[];
    for(const cit of citations){const a=chooseAttribution(text,cit,entities);if(!a)continue;payloadRows.push({org_id:orgId,business_id:businessId,source_run_id:runId,measurement_id:String(m.id),measurement_mention_id:a.entity.mentionId,canonical_key:a.entity.canonicalKey,canonical_display_name:a.entity.displayName,citation_url:cit.url,domain:cit.domain,title:cit.title,citation_start_index:cit.start,citation_end_index:cit.end,entity_start_index:a.span.start,entity_end_index:a.span.end,attribution_level:a.level,attribution_version:ATTRIBUTION_VERSION,evidence:{distance_chars:a.distance,relation:a.relation,entity_match_text:a.span.text,comparative_guard_version:COMPARATIVE_GUARD_VERSION}});if(a.level==="direct")direct++;else section++}
    if(payloadRows.length){const{error:upErr}=await db.from("measurement_citation_attributions").upsert(payloadRows,{onConflict:"measurement_id,canonical_key,citation_url,citation_start_index,attribution_version",ignoreDuplicates:true});if(upErr)return json({ok:false,error:"ATTRIBUTION_SAVE_FAILED",detail:upErr.message},500);inserted+=payloadRows.length}
  }
  await db.from("system_events").insert({org_id:orgId,run_id:runId,event_type:"visibility_citation_attribution_completed",severity:"info",message:"Citation-to-entity attribution completed.",metadata:{attribution_version:ATTRIBUTION_VERSION,comparative_guard_version:COMPARATIVE_GUARD_VERSION,rows_seen:inserted,direct_rows:direct,section_rows:section,measurements_with_payload:withPayload}});
  return json({ok:true,runId,attributionVersion:ATTRIBUTION_VERSION,comparativeGuardVersion:COMPARATIVE_GUARD_VERSION,rowsSeen:inserted,directRows:direct,sectionRows:section,measurementsWithPayload:withPayload});
});
