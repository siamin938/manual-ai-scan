import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Obj=Record<string,unknown>;
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
function isObj(v:unknown):v is Obj{return!!v&&typeof v==="object"&&!Array.isArray(v)}
function readDefaultKey(name:string):string|undefined{const raw=Deno.env.get(name)?.trim();if(!raw)return;try{const p=JSON.parse(raw) as unknown;if(!isObj(p))return;if(typeof p.default==="string"&&p.default.trim())return p.default.trim();for(const v of Object.values(p))if(typeof v==="string"&&v.trim())return v.trim()}catch{}return}
function env(){return{url:Deno.env.get("SUPABASE_URL")?.trim()||"",secret:readDefaultKey("SUPABASE_SECRET_KEYS")??Deno.env.get("SUPABASE_SECRET_KEY")?.trim()??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()??""}}
function n(v:unknown,fallback=0){const x=Number(v);return Number.isFinite(x)?x:fallback}
function normDomain(v:unknown){return typeof v==="string"?v.trim().toLowerCase().replace(/^www\./,""):""}
function siteLabel(domain:string):string{
  if(domain==="blog.naver.com")return "네이버 블로그";
  if(domain.endsWith(".tistory.com"))return "티스토리";
  if(domain==="cafe.naver.com")return "네이버 카페";
  if(domain==="placeview.co.kr")return "플레이스뷰";
  if(domain==="localview.co.kr")return "로컬뷰";
  if(domain==="daangn.com"||domain.endsWith(".daangn.com"))return "당근 동네업체";
  if(domain==="soonwidot.co.kr")return "순위닷";
  if(domain==="play.mycle.co.kr"||domain==="service.mycle.co.kr")return "마이클";
  if(domain==="pf.kakao.com")return "카카오톡 채널";
  if(domain==="fcmt.purpleo.co.kr")return "자동차 정비업체 지도";
  if(domain==="miso.kr"||domain.endsWith(".miso.kr"))return "미소";
  if(domain==="soomgo.com"||domain.endsWith(".soomgo.com"))return "숨고";
  if(["m.place.naver.com","place.naver.com","map.naver.com"].includes(domain))return "네이버 플레이스";
  if(domain==="oh-car.kr"||domain.endsWith(".oh-car.kr"))return "오늘의카";
  if(domain==="kumhotire.com")return "금호타이어";
  if(domain==="tstation.com")return "티스테이션";
  if(domain==="hankooktire.com")return "한국타이어";
  if(domain==="news.nate.com")return "네이트뉴스";
  if(domain==="yna.co.kr")return "연합뉴스";
  if(domain==="wowtv.co.kr")return "한국경제TV";
  if(domain==="v.daum.net")return "다음뉴스";
  if(domain==="n.news.naver.com")return "네이버뉴스";
  if(domain==="newsis.com")return "뉴시스";
  if(domain==="youtube.com"||domain==="youtu.be"||domain.endsWith(".youtube.com"))return "YouTube";
  return domain;
}
function parseSitesForGroup(rawDomains:Obj[],key:string){
  const seen=new Set<string>();
  return rawDomains
    .filter(d=>typeof d.groupKey==="string"&&d.groupKey===key)
    .map(d=>normDomain(d.domain))
    .filter(Boolean)
    .map(d=>({label:siteLabel(d),domain:d}))
    .filter(s=>{const k=s.label.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;})
    .slice(0,4);
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  const auth=req.headers.get("authorization")??"";
  if(!auth.startsWith("Bearer "))return json({ok:false,error:"UNAUTHORIZED"},401);
  const e=env();
  if(!e.url||!e.secret)return json({ok:false,error:"SERVER_NOT_CONFIGURED"},500);
  const db=createClient(e.url,e.secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const{data:au,error:ae}=await db.auth.getUser(auth.slice(7).trim());
  if(ae||!au.user)return json({ok:false,error:"UNAUTHORIZED"},401);
  let body:unknown;
  try{body=await req.json()}catch{return json({ok:false,error:"INVALID_REQUEST"},400)}
  if(!isObj(body))return json({ok:false,error:"INVALID_REQUEST"},400);
  const orgId=typeof body.orgId==="string"?body.orgId:"";
  const businessId=typeof body.businessId==="string"?body.businessId:"";
  if(!UUID_RE.test(orgId)||!UUID_RE.test(businessId))return json({ok:false,error:"INVALID_REQUEST"},400);
  const{data:mem,error:me}=await db.from("organization_members").select("org_id").eq("org_id",orgId).eq("user_id",au.user.id).maybeSingle();
  if(me)return json({ok:false,error:"INTERNAL_ERROR"},500);
  if(!mem)return json({ok:false,error:"FORBIDDEN"},403);
  const{data:business,error:be}=await db.from("businesses").select("id,category").eq("id",businessId).eq("org_id",orgId).eq("is_client_business",true).eq("active",true).maybeSingle();
  if(be)return json({ok:false,error:"INTERNAL_ERROR"},500);
  if(!business)return json({ok:false,error:"BUSINESS_NOT_AVAILABLE"},404);

  const{data,error}=await db.rpc("get_global_high_visibility_source_patterns_v02",{p_requesting_org_id:orgId,p_business_id:businessId});
  if(error||!isObj(data)){console.error(JSON.stringify({function:"visibility-benchmark",code:"GLOBAL_RPC_FAILED",message:error?.message??"invalid payload"}));return json({ok:false,error:"INTERNAL_ERROR"},500)}

  const meta=isObj(data.benchmark)?data.benchmark:{};
  const rawDomains=Array.isArray(data.domains)?data.domains.filter(isObj):[];
  const rawGroups=Array.isArray(data.sourceGroups)?data.sourceGroups:[];
  const sourceGroups=rawGroups.slice(0,6).filter(isObj).map((g,i)=>{
    const key=typeof g.key==="string"?g.key:`group-${i}`;
    const rawLabel=typeof g.label==="string"?g.label:"기타";
    return{
      key,
      label:rawLabel,
      highEntityCount:n(g.highEntityCount),
      highEntitySharePct:n(g.highEntitySharePct),
      targetConnected:g.targetHasSource===true,
      patternStrength:typeof g.patternStrength==="string"?g.patternStrength:"early",
      sites:parseSitesForGroup(rawDomains,key)
    };
  });

  const categoryRaw=isObj(data.categoryContext)?data.categoryContext:{};
  const categoryAvailable=categoryRaw.available===true;
  const categoryDomains=Array.isArray(categoryRaw.domains)?categoryRaw.domains.filter(isObj):[];
  const categoryGroupsRaw=Array.isArray(categoryRaw.sourceGroups)?categoryRaw.sourceGroups.filter(isObj):[];
  const categoryContext={
    available:categoryAvailable,
    category:typeof categoryRaw.category==="string"?categoryRaw.category:(typeof business.category==="string"?business.category:null),
    eligibleTargetBusinessCount:n(categoryRaw.eligibleTargetBusinessCount),
    highVisibilityEntityCount:n(categoryRaw.highVisibilityEntityCount),
    sourceGroups:categoryAvailable?categoryGroupsRaw.slice(0,4).map((g,i)=>{
      const key=typeof g.key==="string"?g.key:`category-${i}`;
      const rawLabel=typeof g.label==="string"?g.label:"기타";
      return{
        key,
        label:rawLabel,
        highEntityCount:n(g.highEntityCount),
        highEntitySharePct:n(g.highEntitySharePct),
        sites:parseSitesForGroup(categoryDomains,key)
      };
    }):[]
  };

  const dto={
    scope:"global_automotive",
    windowDays:n(meta.windowDays,90),
    thresholdPct:n(meta.thresholdPct,20),
    dataStatus:meta.dataStatus==="stable"||meta.dataStatus==="building"?"ready":"early",
    eligibleTargetBusinessCount:n(meta.eligibleTargetBusinessCount),
    contributingOrgCount:n(meta.contributingOrgCount),
    highVisibilityEntityCount:n(meta.highVisibilityEntityCount),
    sourceGroups,
    categoryContext,
    disclaimer:typeof data.disclaimer==="string"?data.disclaimer:"전체 자동차 업체의 최근 측정에서 반복 관찰된 집계 패턴이며 특정 출처가 AI 노출의 직접 원인임을 의미하지 않습니다."
  };
  return json({ok:true,benchmark:dto});
});
