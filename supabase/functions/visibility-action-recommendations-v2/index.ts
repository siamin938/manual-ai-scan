import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_FUNCTION="visibility-action-recommendations";
const LEGACY_SOURCE_ID="source:dedicated_site_candidate:trust";
const LEGACY_GROUP_KEY="dedicated_site_candidate";
const MARKET_GROUP_KEY="business_brand_site";
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
function isObj(v:unknown):v is Record<string,unknown>{return!!v&&typeof v==="object"&&!Array.isArray(v)}
function readKey(n:string){const raw=Deno.env.get(n)?.trim();if(!raw)return;try{const p=JSON.parse(raw) as unknown;if(!isObj(p))return;if(typeof p.default==="string"&&p.default.trim())return p.default.trim();for(const v of Object.values(p))if(typeof v==="string"&&v.trim())return v.trim()}catch{}return}
function env(){return{url:Deno.env.get("SUPABASE_URL")?.trim()||"",secret:readKey("SUPABASE_SECRET_KEYS")??Deno.env.get("SUPABASE_SECRET_KEY")?.trim()??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()??""}}
function n(v:unknown,fallback=0){const x=Number(v);return Number.isFinite(x)?x:fallback}
function hasLegacyHomepageGroup(rec:unknown){if(!isObj(rec))return false;if(rec.id===LEGACY_SOURCE_ID)return true;const groups=Array.isArray(rec.sourceGroups)?rec.sourceGroups:[];return groups.some(g=>isObj(g)&&g.key===LEGACY_GROUP_KEY)}
function marketSentence(data:unknown){if(!isObj(data))return null;const groups=Array.isArray(data.sourceGroups)?data.sourceGroups:[];const group=groups.find(g=>isObj(g)&&g.key===MARKET_GROUP_KEY);const meta=isObj(data.benchmark)?data.benchmark:{};if(!group||!isObj(group))return null;const total=n(meta.highVisibilityEntityCount),count=n(group.highEntityCount),days=n(meta.windowDays,90),share=n(group.highEntitySharePct,Number.NaN);if(total<=0||count<=0)return null;const shareText=Number.isFinite(share)?` (${share.toFixed(1)}%)`:"";return{label:typeof group.label==="string"&&group.label.trim()?group.label.trim():"업체·브랜드 홈페이지·독립 사이트",text:`참고로 최근 ${days}일 자동차 시장 익명 집계에서도 고노출 업체 ${total}곳 중 ${count}곳${shareText}에서 같은 유형의 출처가 관찰됐습니다.`}}
function enrichRecommendation(rec:unknown,market:{label:string;text:string}){if(!isObj(rec)||!hasLegacyHomepageGroup(rec))return rec;const summary=typeof rec.summary==="string"?rec.summary:"";const sourceGroups=Array.isArray(rec.sourceGroups)?rec.sourceGroups.map(g=>{if(!isObj(g)||g.key!==LEGACY_GROUP_KEY)return g;return{...g,key:MARKET_GROUP_KEY,name:market.label}}):rec.sourceGroups;return{...rec,id:`source:${MARKET_GROUP_KEY}:trust`,summary:summary.includes(market.text)?summary:`${summary}${summary?" ":""}${market.text}`,sourceGroups}}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  const auth=req.headers.get("authorization")??"";
  if(!auth.startsWith("Bearer "))return json({ok:false,error:"UNAUTHORIZED"},401);
  const e=env();if(!e.url||!e.secret)return json({ok:false,error:"SERVER_NOT_CONFIGURED"},500);
  let body:unknown;try{body=await req.json()}catch{return json({ok:false,error:"INVALID_REQUEST"},400)}
  if(!isObj(body))return json({ok:false,error:"INVALID_REQUEST"},400);
  const orgId=typeof body.orgId==="string"?body.orgId:"",businessId=typeof body.businessId==="string"?body.businessId:"";
  if(!UUID_RE.test(orgId)||!UUID_RE.test(businessId))return json({ok:false,error:"INVALID_REQUEST"},400);

  let baseResp:Response;
  try{baseResp=await fetch(`${e.url}/functions/v1/${LEGACY_FUNCTION}`,{method:"POST",headers:{authorization:auth,apikey:e.secret,"Content-Type":"application/json"},body:JSON.stringify({orgId,businessId})})}catch(err){console.error(JSON.stringify({function:"visibility-action-recommendations-v2",code:"LEGACY_FETCH_FAILED",message:err instanceof Error?err.message:String(err)}));return json({ok:false,error:"INTERNAL_ERROR"},500)}
  let basePayload:unknown;try{basePayload=await baseResp.json()}catch{return json({ok:false,error:"INTERNAL_ERROR"},500)}
  if(!baseResp.ok||!isObj(basePayload)||basePayload.ok!==true)return json(basePayload,baseResp.status);
  const recs=Array.isArray(basePayload.recommendations)?basePayload.recommendations:[];
  if(!recs.some(hasLegacyHomepageGroup))return json(basePayload);

  const db=createClient(e.url,e.secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const{data:benchmark,error:benchmarkError}=await db.rpc("get_global_high_visibility_source_patterns_v02",{p_requesting_org_id:orgId,p_business_id:businessId});
  if(benchmarkError){console.error(JSON.stringify({function:"visibility-action-recommendations-v2",code:"BENCHMARK_RPC_FAILED",message:benchmarkError.message}));return json(basePayload)}
  const market=marketSentence(benchmark);
  if(!market)return json(basePayload);
  return json({...basePayload,recommendations:recs.map(rec=>enrichRecommendation(rec,market))});
});