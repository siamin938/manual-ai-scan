import { createClient } from "jsr:@supabase/supabase-js@2";

const PIPELINE_VERSION="0.1.4";
const VERIFIER_VERSION="0.1.5";
const RESOLVER_VERSION="0.1.1";
const BATCH=500;
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-visibility-postprocess-token","Access-Control-Allow-Methods":"POST,OPTIONS"};

type VStatus="confirmed_business"|"rejected_non_business"|"needs_review";
type VKind="specific_business"|"brand_network"|"generic_category"|"platform"|"advice"|"ambiguous";
type VConf="high"|"medium"|"low";
type Mention={id:string;measurement_id:string;matched_business_id:string|null;display_name:string;entity_kind:string|null;specificity:string|null;count_as_confirmed_business:boolean|null};
type Verdict={status:VStatus;kind:VKind;count:boolean;confidence:VConf;reasons:string[]};
type Rm={mentionId:string;measurementId:string;matchedBusinessId:string|null;displayName:string;verified:boolean};
type Res={mentionId:string;measurementId:string;canonicalKey:string;canonicalDisplayName:string;resolutionStatus:"matched_business"|"merged"|"standalone";confidence:"high"|"medium"|"low";reasonCodes:string[]};

const SENTENCE_MARKERS=["?","나요","까요","습니까","인가요","있나요","없나요","어떻게","무엇","왜 ","여부","가능한지","하는지","되는지","인지","습니다","합니다","됩니다"];
const SENTENCE_ENDING_RE=/(나요|가요|까요|습니까|습니다|입니다|합니다|됩니다|는지|은지|는가|은가|인가|이라면|라면)[\s.?!*)\]:_\"'`~-]*$/;
const HEADING_SUFFIXES=["기준","사항","유형별","유형별추천","위주","고려할곳","고려할것","추천순위","추천","순위","정리","요약","결론","비교","체크리스트"];
const NETWORK_SUFFIXES=["네트워크","서비스망","정비망","협력망","지정정비망","딜러망"];
const STRONG_DESCRIPTORS=["모터스","모터","개러지","거라지","garage","팩토리","factory","정비센터","정비소","정비공장","공업사","카센터","카센타","카케어","오토","auto","바디샵","협력점","상사"];
const BRANCH_SUFFIXES=["본점","지점","직영점","분점","협력점","대리점"];
const CATEGORY_STORE_SUFFIXES=["전문점","취급점","판매점","대행점"];
const CLAUSE_PARTICLES=["에서","에게","으로","에는","까지","부터","와","과","을","를","이나","거나"];
const OFFICIAL_MARKERS=["공식","지정","인증"];
const SERVICE_CATEGORY_WORDS=["정비사업소","사업소","정비소","정비센터","서비스센터","서비스","정비","협력업체"];
const NON_BUSINESS=new Set(["advice","platform","generic_category","brand_network"]);
const ENUM_SEP=/[·ㆍ・,、/]/, ENUM_CONJ=/(^|\s)(및|또는|등)(\s|$)/, LABEL_RE=/[:：]|→|=>/, QUANT_RE=/(\d+\s*[~\-–]\s*\d+\s*곳|\d+\s*곳|(몇|여러|두세|서너)\s*곳)/;
const GENERIC_MARKERS=["서비스센터","정비사업소","정비센터","서비스","센터","본점","직영점","지점","분점","대리점","협력점","공식"];
const REGION_SUFFIX=["시","군","구","읍","면","동"];
const TRACKING=/^(utm_|ref$|referrer$|fbclid$|gclid$|igshid$|mc_cid$|mc_eid$)/i;

function json(b:unknown,s=200){return new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
function rec(v:unknown):v is Record<string,unknown>{return!!v&&typeof v==="object"&&!Array.isArray(v)}
function readKey(n:string){const r=Deno.env.get(n)?.trim();if(!r)return;try{const p=JSON.parse(r) as unknown;if(!rec(p))return;if(typeof p.default==="string"&&p.default.trim())return p.default.trim();for(const v of Object.values(p))if(typeof v==="string"&&v.trim())return v.trim()}catch{}return}
function env(){return{url:Deno.env.get("SUPABASE_URL")?.trim()||"",secret:readKey("SUPABASE_SECRET_KEYS")??Deno.env.get("SUPABASE_SECRET_KEY")?.trim()??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()??""}}
function norm(s:string){return(s??"").normalize("NFKC").replace(/\s+/g," ").trim()}
function compact(s:string){return norm(s).replace(/[^0-9a-z가-힣]/gi,"").toLowerCase()}
function tokens(s:string){return norm(s).split(" ").filter(Boolean)}
function sentence(s:string){const t=norm(s);if(t.includes("?")||SENTENCE_ENDING_RE.test(t))return true;return t.length>=12&&SENTENCE_MARKERS.some(x=>t.includes(x))}
function descriptor(s:string){const c=compact(s);return STRONG_DESCRIPTORS.some(x=>c.includes(compact(x)))}
function branch(s:string){const c=compact(s);if(CATEGORY_STORE_SUFFIXES.some(x=>c.endsWith(compact(x))))return false;if(BRANCH_SUFFIXES.some(x=>c.endsWith(compact(x))))return true;if(c.includes("서비스센터")&&tokens(s).length>=3)return true;return /[가-힣a-z0-9]{2,}점$/.test(c)&&!c.endsWith("지점없음")}
function heading(s:string){const c=compact(s);return !c||(!descriptor(s)&&HEADING_SUFFIXES.some(x=>c===compact(x)||c.endsWith(compact(x))))}
function network(s:string){const c=compact(s);return !!c&&NETWORK_SUFFIXES.some(x=>c.endsWith(compact(x)))&&!branch(s)}
function criteria(s:string){const t=norm(s),c=compact(t);if(!c)return false;if(LABEL_RE.test(t)||QUANT_RE.test(t)||c.endsWith("경우")||c.endsWith("할때")||c.endsWith("일때")||c.includes("할때")||c.includes("인경우")||c.includes("는경우")||c.includes("계열")||c.includes("위주")||c.includes("종류별")||c.includes("유형별"))return true;const ts=t.split(" ");return ts.length>=3&&ts.some((x,i)=>i<ts.length-1&&x.length>=3&&CLAUSE_PARTICLES.some(p=>x.endsWith(p)))}
function enumeration(s:string){const t=norm(s);return !!t&&(ENUM_SEP.test(t)||ENUM_CONJ.test(t))}
function officialGeneric(s:string){const c=compact(s);return !!c&&OFFICIAL_MARKERS.some(x=>c.includes(compact(x)))&&SERVICE_CATEGORY_WORDS.some(x=>c.includes(compact(x)))&&!branch(s)}
function shortName(s:string){const n=tokens(s).length;return n>=1&&n<=8&&!sentence(s)&&norm(s).length<=40}
function verdict(status:VStatus,kind:VKind,count:boolean,confidence:VConf,reasons:string[]):Verdict{return{status,kind,count,confidence,reasons}}
function verify(m:Mention,repeated:boolean,probableRepeated:boolean,hasParserConfirmedExactName:boolean):Verdict{
 const name=norm(m.display_name),kind=m.entity_kind,spec=m.specificity,orig=kind==="specific_business"&&spec==="confirmed"&&m.count_as_confirmed_business===true;
 if(m.matched_business_id&&orig)return verdict("confirmed_business","specific_business",true,"high",["REGISTERED_BUSINESS_MATCH"]);
 if(kind&&NON_BUSINESS.has(kind))return verdict("rejected_non_business",kind as VKind,false,"high",["ORIGINAL_NON_BUSINESS_KIND"]);
 if(!name||sentence(name))return verdict("rejected_non_business","advice",false,"high",["SENTENCE_LIKE"]);
 if(network(name))return verdict("rejected_non_business","brand_network",false,"high",["GENERIC_NETWORK"]);
 if(enumeration(name))return verdict("rejected_non_business","generic_category",false,"high",["SERVICE_ENUMERATION"]);
 if(criteria(name))return verdict("rejected_non_business","generic_category",false,"high",["DESCRIPTIVE_CRITERIA"]);
 if(officialGeneric(name))return verdict("rejected_non_business","generic_category",false,"high",["GENERIC_OFFICIAL_CATEGORY"]);
 if(heading(name))return verdict("rejected_non_business","generic_category",false,"high",["HEADING_CRITERIA_PHRASE"]);
 const d=descriptor(name),b=branch(name),specific=kind==="specific_business",short=shortName(name),reasons:string[]=[];
 if(m.matched_business_id)reasons.push("REGISTERED_BUSINESS_MATCH");if(d)reasons.push("STRONG_BUSINESS_DESCRIPTOR");if(b)reasons.push("BRANCH_MARKER");if(repeated)reasons.push("REPEATED_ACROSS_RESPONSES");
 if(orig)return verdict("confirmed_business","specific_business",true,"high",reasons.length?reasons:["PARSER_CONFIRMED_BUSINESS"]);
 if(specific&&short&&(d||b||repeated||!!m.matched_business_id))return verdict("confirmed_business","specific_business",true,"medium",[...reasons,"PROBABLE_ONLY"]);
 if(kind==="ambiguous"&&short&&b&&repeated)return verdict("confirmed_business","specific_business",true,"medium",[...reasons,"AMBIGUOUS_BRANCH_REPEATED"]);
 if(kind==="ambiguous"&&spec==="probable"&&short&&probableRepeated)return verdict("confirmed_business","specific_business",true,"medium",[...reasons,"REPEATED_PROBABLE_ACROSS_RESPONSES","AMBIGUOUS_PROBABLE_REPEATED"]);
 if(kind==="ambiguous"&&short&&hasParserConfirmedExactName)return verdict("confirmed_business","specific_business",true,"medium",[...reasons,"PARSER_CONFIRMED_EXACT_NAME_IN_SCOPE"]);
 if(specific)return verdict("needs_review","specific_business",false,"medium",[...reasons,"PROBABLE_ONLY"]);
 if(short)return verdict("needs_review","ambiguous",false,"low",[...reasons,"INTRINSIC_PROPER_NAME","PROBABLE_ONLY"]);
 return verdict("rejected_non_business","ambiguous",false,"medium",["SENTENCE_LIKE"]);
}
function tokenizeName(v:string){return(v??"").normalize("NFKC").split(/[\s\u00a0·/,]+/).map(t=>t.replace(/[^0-9a-zA-Z가-힣]/g,"")).filter(Boolean)}
function strip(c:string){let o=c;for(const x of GENERIC_MARKERS){const m=compact(x);if(o.length>m.length)o=o.split(m).join("")}return o}
function regionToken(t:string){return t.length>=2&&t.length<=3&&/^[가-힣]+$/.test(t)}
function coreVariants(n:string){const v=new Set<string>(),ts=tokenizeName(n),push=(x:string)=>{const c=compact(x);if(c.length>=3)v.add(c);const s=strip(c);if(s.length>=3)v.add(s)};push(n);if(ts.length>1){const f=ts[0]!;if(regionToken(f)||REGION_SUFFIX.some(x=>f.endsWith(x))||ts.length>2)push(ts.slice(1).join(""));const l=ts.at(-1)!;if(strip(compact(l)).length>=4)push(l)}return[...v]}
function crossScriptBase(n:string){const m=norm(n).match(/^(.{2,60}?)\s*[\(（]([^()（）]{1,40})[\)）]\s*$/u);if(!m)return null;const base=norm(m[1]!),alias=norm(m[2]!),bh=/[가-힣]/u.test(base),bl=/[A-Za-z]/.test(base),ah=/[가-힣]/u.test(alias),al=/[A-Za-z]/.test(alias);const strict=(bh&&!bl&&al&&!ah)||(bl&&!bh&&ah&&!al);if(!strict)return null;const c=compact(base);return c.length>=2?c:null}
function relation(a:string,b:string){const ca=compact(a),cb=compact(b),aa=crossScriptBase(a),ab=crossScriptBase(b);if(aa&&aa===cb)return true;if(ab&&ab===ca)return true;const A=coreVariants(a),B=coreVariants(b),sb=new Set(B);for(const x of A)if(sb.has(x))return true;for(const x of A)for(const y of B)if(x.length>=4&&y.length>=4&&(x.includes(y)||y.includes(x)))return true;return false}
function concrete(raw:string){try{const u=new URL(raw.trim());if(u.protocol!=="http:"&&u.protocol!=="https:")return null;const host=u.hostname.toLowerCase().replace(/^www\./,""),path=u.pathname.replace(/\/+$/,"");const q=[...u.searchParams.entries()].filter(([k])=>!TRACKING.test(k)).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("&");if(!path&&!q)return null;return`${host}${path}${q?`?${q}`:""}`}catch{return null}}
type Node={key:string;name:string;mentions:Rm[];urls:Set<string>};
function resolve(businessId:string,names:Record<string,string>,mentions:Rm[],sourceUrls:Record<string,string[]>):Res[]{const out:Res[]=[],nodes=new Map<string,Node>();for(const m of mentions){if(!m.verified&&m.matchedBusinessId!==businessId)continue;if(m.matchedBusinessId){out.push({mentionId:m.mentionId,measurementId:m.measurementId,canonicalKey:`business:${m.matchedBusinessId}`,canonicalDisplayName:names[m.matchedBusinessId]??m.displayName,resolutionStatus:"matched_business",confidence:"high",reasonCodes:["REGISTERED_BUSINESS_LINK"]});continue}const k=compact(m.displayName);if(!k)continue;let n=nodes.get(k);if(!n){n={key:k,name:m.displayName,mentions:[],urls:new Set};nodes.set(k,n)}n.mentions.push(m);for(const raw of sourceUrls[m.measurementId]??[]){const u=concrete(raw);if(u)n.urls.add(u)}}const ks=[...nodes.keys()].sort(),p=new Map(ks.map(k=>[k,k]));const find=(k:string):string=>{let r=k;while(p.get(r)!==r)r=p.get(r)!;return r},union=(a:string,b:string)=>{const A=find(a),B=find(b);if(A!==B)p.set(A<B?B:A,A<B?A:B)};for(let i=0;i<ks.length;i++)for(let j=i+1;j<ks.length;j++){const a=nodes.get(ks[i]!)!,b=nodes.get(ks[j]!)!;if(!relation(a.name,b.name))continue;let shared=false;for(const u of a.urls)if(b.urls.has(u)){shared=true;break}if(shared)union(a.key,b.key)}const groups=new Map<string,Node[]>();for(const k of ks){const r=find(k),g=groups.get(r)??[];g.push(nodes.get(k)!);groups.set(r,g)}for(const g of groups.values()){const merged=g.length>1,name=[...g.map(x=>x.name)].sort((a,b)=>tokenizeName(b).length-tokenizeName(a).length||compact(b).length-compact(a).length||a.localeCompare(b))[0]!,key=`auto:${compact(name)}`;for(const n of g)for(const m of n.mentions)out.push({mentionId:m.mentionId,measurementId:m.measurementId,canonicalKey:key,canonicalDisplayName:name,resolutionStatus:merged?"merged":"standalone",confidence:"high",reasonCodes:merged?["NAME_CORE_MATCH","SHARED_SOURCE_URL","CROSS_SCRIPT_ALIAS_SAFE"]:["VERIFIED_STANDALONE"]})}return out}
async function chunks(db:any,table:string,select:string,column:string,ids:string[],scope:(q:any)=>any){const rows:any[]=[];for(let i=0;i<ids.length;i+=BATCH){let q=db.from(table).select(select).in(column,ids.slice(i,i+BATCH));q=scope(q);const{data,error}=await q;if(error)throw new Error(`${table}_READ_FAILED`);rows.push(...(data??[]))}return rows}

Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405);
 const e=env();if(!e.url||!e.secret)return json({ok:false,error:"SERVER_NOT_CONFIGURED"},500);const db=createClient(e.url,e.secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const supplied=req.headers.get("x-visibility-postprocess-token")?.trim()??"";if(!supplied)return json({ok:false,error:"FORBIDDEN"},403);const{data:tr,error:te}=await db.from("visibility_postprocess_tokens").select("name").eq("token",supplied).eq("active",true).maybeSingle();if(te||!tr)return json({ok:false,error:"FORBIDDEN"},403);
 let body:unknown;try{body=await req.json()}catch{return json({ok:false,error:"INVALID_REQUEST"},400)}if(!rec(body)||typeof body.runId!=="string")return json({ok:false,error:"INVALID_REQUEST"},400);const runId=body.runId,force=body.force===true;
 const{data:run,error:re}=await db.from("measurement_runs").select("id,org_id,business_id,run_type,phase,status,experiment_id").eq("id",runId).maybeSingle();if(re||!run)return json({ok:false,error:"RUN_NOT_FOUND"},404);if(run.run_type!=="audit"||run.phase!=="standalone"||run.experiment_id!==null||!["completed","partial"].includes(String(run.status)))return json({ok:false,error:"RUN_NOT_ELIGIBLE"},409);
 const orgId=String(run.org_id),businessId=String(run.business_id);const{data:done}=await db.from("system_events").select("id,metadata").eq("org_id",orgId).eq("run_id",runId).eq("event_type","visibility_postprocess_completed").eq("metadata->>pipeline_version",PIPELINE_VERSION).eq("metadata->>resolver_version",RESOLVER_VERSION).limit(1).maybeSingle();if(done&&!force)return json({ok:true,idempotent:true,pipelineVersion:PIPELINE_VERSION});
 await db.from("system_events").insert({org_id:orgId,run_id:runId,event_type:"visibility_postprocess_started",severity:"info",message:"Visibility diagnostic postprocess started.",metadata:{pipeline_version:PIPELINE_VERSION,verifier_version:VERIFIER_VERSION,resolver_version:RESOLVER_VERSION,forced:force}});
 try{
  const{data:ms,error:me}=await db.from("measurements").select("id").eq("org_id",orgId).eq("run_id",runId);if(me)throw new Error("MEASUREMENT_READ_FAILED");const mids=(ms??[]).map(x=>String(x.id));
  const mentions:Mention[]=mids.length?(await chunks(db,"measurement_mentions","id,measurement_id,matched_business_id,display_name,entity_kind,specificity,count_as_confirmed_business","measurement_id",mids,(q:any)=>q.eq("org_id",orgId))).map((m:any)=>({id:String(m.id),measurement_id:String(m.measurement_id),matched_business_id:m.matched_business_id?String(m.matched_business_id):null,display_name:String(m.display_name??""),entity_kind:m.entity_kind??null,specificity:m.specificity??null,count_as_confirmed_business:m.count_as_confirmed_business??null})):[];
  const repeats=new Map<string,Set<string>>(),probableRepeats=new Map<string,Set<string>>(),parserConfirmedKeys=new Set<string>();for(const m of mentions){const k=compact(m.display_name);if(!k)continue;const s=repeats.get(k)??new Set<string>();s.add(m.measurement_id);repeats.set(k,s);if(m.entity_kind==="ambiguous"&&m.specificity==="probable"){const ps=probableRepeats.get(k)??new Set<string>();ps.add(m.measurement_id);probableRepeats.set(k,ps)}if(m.entity_kind==="specific_business"&&m.specificity==="confirmed"&&m.count_as_confirmed_business===true)parserConfirmedKeys.add(k)}
  const ids=mentions.map(m=>m.id),existing=ids.length?await chunks(db,"measurement_entity_verifications","measurement_mention_id","measurement_mention_id",ids,(q:any)=>q.eq("org_id",orgId).eq("business_id",businessId).eq("verifier_version",VERIFIER_VERSION)):[],es=new Set(existing.map((r:any)=>String(r.measurement_mention_id))),rows:any[]=[];
  for(const m of mentions){if(es.has(m.id))continue;const k=compact(m.display_name);const v=verify(m,(repeats.get(k)?.size??0)>=2,(probableRepeats.get(k)?.size??0)>=2,parserConfirmedKeys.has(k));rows.push({org_id:orgId,business_id:businessId,measurement_id:m.measurement_id,measurement_mention_id:m.id,verifier_version:VERIFIER_VERSION,verification_status:v.status,verified_entity_kind:v.kind,verified_count_as_business:v.count,confidence:v.confidence,reason_codes:v.reasons})}
  for(let i=0;i<rows.length;i+=200){const{error}=await db.from("measurement_entity_verifications").insert(rows.slice(i,i+200));if(error&&error.code!=="23505")throw new Error("VERIFICATION_INSERT_FAILED")}
  const va=ids.length?await chunks(db,"measurement_entity_verifications","measurement_mention_id,verification_status,verified_count_as_business","measurement_mention_id",ids,(q:any)=>q.eq("org_id",orgId).eq("business_id",businessId).eq("verifier_version",VERIFIER_VERSION)):[],verified=new Set(va.filter((r:any)=>r.verification_status==="confirmed_business"&&r.verified_count_as_business===true).map((r:any)=>String(r.measurement_mention_id)));
  const src=mids.length?await chunks(db,"measurement_sources","measurement_id,url","measurement_id",mids,(q:any)=>q.eq("org_id",orgId)):[],su:Record<string,string[]>={};for(const s of src)(su[String(s.measurement_id)]??=[]).push(String(s.url));
  const rids=[...new Set(mentions.map(m=>m.matched_business_id).filter((x):x is string=>!!x).concat(businessId))],names:Record<string,string>={};if(rids.length){const{data,error}=await db.from("businesses").select("id,name").eq("org_id",orgId).in("id",rids);if(error)throw new Error("BUSINESS_READ_FAILED");for(const r of data??[])names[String(r.id)]=String(r.name)}
  const rms:Rm[]=mentions.map(m=>({mentionId:m.id,measurementId:m.measurement_id,matchedBusinessId:m.matched_business_id,displayName:m.display_name,verified:verified.has(m.id)})),resolved=resolve(businessId,names,rms,su);
  const ec=ids.length?await chunks(db,"measurement_entity_canonicalizations","measurement_mention_id","measurement_mention_id",ids,(q:any)=>q.eq("org_id",orgId).eq("business_id",businessId).eq("resolver_version",RESOLVER_VERSION)):[],ecs=new Set(ec.map((r:any)=>String(r.measurement_mention_id))),cr=resolved.filter(r=>!ecs.has(r.mentionId)).map(r=>({org_id:orgId,business_id:businessId,source_run_id:runId,measurement_id:r.measurementId,measurement_mention_id:r.mentionId,resolver_version:RESOLVER_VERSION,canonical_key:r.canonicalKey,canonical_display_name:r.canonicalDisplayName,resolution_status:r.resolutionStatus,confidence:r.confidence,reason_codes:r.reasonCodes}));
  for(let i=0;i<cr.length;i+=200){const{error}=await db.from("measurement_entity_canonicalizations").insert(cr.slice(i,i+200));if(error&&error.code!=="23505")throw new Error("CANONICALIZATION_INSERT_FAILED")}
  await db.from("system_events").insert({org_id:orgId,run_id:runId,event_type:"visibility_postprocess_completed",severity:"info",message:"Visibility diagnostic postprocess completed.",metadata:{pipeline_version:PIPELINE_VERSION,verifier_version:VERIFIER_VERSION,resolver_version:RESOLVER_VERSION,measurement_count:mids.length,mention_count:mentions.length,verification_inserted:rows.length,canonical_inserted:cr.length,confirmed_count:verified.size,forced:force}});
  return json({ok:true,idempotent:false,pipelineVersion:PIPELINE_VERSION,resolverVersion:RESOLVER_VERSION,measurementCount:mids.length,mentionCount:mentions.length,verificationInserted:rows.length,canonicalInserted:cr.length,confirmedCount:verified.size});
 }catch(err){await db.from("system_events").insert({org_id:orgId,run_id:runId,event_type:"visibility_postprocess_failed",severity:"error",message:"Visibility diagnostic postprocess failed.",metadata:{pipeline_version:PIPELINE_VERSION,resolver_version:RESOLVER_VERSION,error_code:err instanceof Error?err.message.slice(0,120):"POSTPROCESS_FAILED"}});return json({ok:false,error:"POSTPROCESS_FAILED"},500)}
});