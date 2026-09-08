import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_FUNCTION="visibility-action-recommendations";
const LEGACY_SOURCE_ID="source:dedicated_site_candidate:trust";
const LEGACY_GROUP_KEY="dedicated_site_candidate";
const MARKET_GROUP_KEY="business_brand_site";
const PRELIMINARY_SITE_LABEL="여러 답변에서 연결";
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
function isObj(v:unknown):v is Record<string,unknown>{return!!v&&typeof v==="object"&&!Array.isArray(v)}
function readKey(n:string){const raw=Deno.env.get(n)?.trim();if(!raw)return;try{const p=JSON.parse(raw) as unknown;if(!isObj(p))return;if(typeof p.default==="string"&&p.default.trim())return p.default.trim();for(const v of Object.values(p))if(typeof v==="string"&&v.trim())return v.trim()}catch{}return}
function env(){return{url:Deno.env.get("SUPABASE_URL")?.trim()||"",secret:readKey("SUPABASE_SECRET_KEYS")??Deno.env.get("SUPABASE_SECRET_KEY")?.trim()??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()??""}}
function n(v:unknown,fallback=0){const x=Number(v);return Number.isFinite(x)?x:fallback}
function hasLegacyHomepageGroup(rec:unknown){if(!isObj(rec))return false;if(rec.id===LEGACY_SOURCE_ID)return true;const groups=Array.isArray(rec.sourceGroups)?rec.sourceGroups:[];return groups.some(g=>isObj(g)&&g.key===LEGACY_GROUP_KEY)}
function marketSentence(data:unknown){if(!isObj(data))return null;const groups=Array.isArray(data.sourceGroups)?data.sourceGroups:[];const group=groups.find(g=>isObj(g)&&g.key===MARKET_GROUP_KEY);const meta=isObj(data.benchmark)?data.benchmark:{};if(!group||!isObj(group))return null;const total=n(meta.highVisibilityEntityCount),count=n(group.highEntityCount),days=n(meta.windowDays,90),share=n(group.highEntitySharePct,Number.NaN);if(total<=0||count<=0)return null;const shareText=Number.isFinite(share)?`(${share.toFixed(1)}%)`:"";const label=typeof group.label==="string"&&group.label.trim()?group.label.trim():"업체·브랜드 홈페이지·독립 사이트";return`참고로 최근 ${days}일 누적 자동차 측정의 익명 집계에서는 ${label} 계열이 고노출 업체 ${total}곳 중 ${count}곳${shareText}에서 관찰됐습니다.`}
function preliminaryText(v:unknown,repetitions:number){if(typeof v!=="string"||repetitions>=2)return v;return v.replace(/여러 답변에서 반복 연결됐지만/g,"여러 답변에서 연결됐지만").replace(/반복 연결되는/g,"여러 답변에서 연결되는").replace(/특정 업체와 반복 연결된 독립 사이트/g,"특정 업체와 여러 답변에서 연결된 독립 사이트")}
function preliminaryEvidenceLabel(v:unknown,repetitions:number){return repetitions<2&&v==="독립 사이트 반복 관찰"?PRELIMINARY_SITE_LABEL:v}
function enrichRecommendation(rec:unknown,marketText:string,repetitions:number){if(!isObj(rec)||!hasLegacyHomepageGroup(rec))return rec;const rawSummary=typeof rec.summary==="string"?rec.summary:"";const summary=String(preliminaryText(rawSummary,repetitions)??"");const sourceGroups=Array.isArray(rec.sourceGroups)?rec.sourceGroups.map(g=>{if(!isObj(g)||g.key!==LEGACY_GROUP_KEY)return g;const platforms=Array.isArray(g.platforms)?g.platforms.map(p=>isObj(p)?{...p,evidenceLabel:preliminaryEvidenceLabel(p.evidenceLabel,repetitions)}:p):g.platforms;return{...g,name:preliminaryText(g.name,repetitions),reason:preliminaryText(g.reason,repetitions),evidenceLabel:preliminaryEvidenceLabel(g.evidenceLabel,repetitions),platforms}}):rec.sourceGroups;return{...rec,summary:summary.includes(marketText)?summary:`${summary}${summary?" ":""}${marketText}`,sourceGroups}}

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
  const marketText=marketSentence(benchmark);
  if(!marketText)return json(basePayload);
  const repetitions=isObj(basePayload.scope)?n(basePayload.scope.repetitions):0;
  return json({...basePayload,recommendations:recs.map(rec=>enrichRecommendation(rec,marketText,repetitions))});
});