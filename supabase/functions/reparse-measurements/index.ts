import { createClient } from "jsr:@supabase/supabase-js@2";
import { PARSER_VERSION, parseMeasurement } from "./_shared/parser.ts";
import { normalizeDomain } from "./_shared/provider-utils.ts";
import { getSupabaseRuntimeEnv } from "./_shared/supabase-env.ts";
import type { BusinessForParsing, ProviderSource } from "./_shared/types.ts";

const MAX_MEASUREMENTS = 50;
const RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: RESPONSE_HEADERS });
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

interface SnapshotQuestion {
  id: string;
  prompt_text: string;
  prompt_hash: string | null;
  intent_type: string;
  language: string;
  country_code: string;
  region: string | null;
  city: string | null;
  weight: number;
  data_class: string;
  active: boolean;
}
interface SnapshotBusinessRef {
  id: string;
  name: string;
  aliases: string[];
  official_domains: string[];
  website_url: string | null;
}
interface ExperimentConditionSnapshotV1 {
  snapshot_version: "1";
  captured_at: string;
  experiment_id: string;
  org_id: string;
  business_id: string;
  source_insight_action_id: string;
  reference_source_run_id: string;
  question_set_id: string;
  questions: SnapshotQuestion[];
  planned: {
    selected_providers: string[];
    provider_models: Record<string, string>;
    repetitions: number;
    search_context_size: string;
    store: boolean;
    planned_jobs: number;
    estimated_cost_usd: number;
    max_cost_usd: number;
  };
  parsing_context: { target: SnapshotBusinessRef; competitors: SnapshotBusinessRef[] };
  condition_hash: string;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    const out = JSON.stringify(value);
    return out === undefined ? "null" : out;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}
function canonicalBusiness(value: SnapshotBusinessRef) {
  return { id: value.id, name: value.name, aliases: [...value.aliases].sort(), official_domains: [...value.official_domains].sort(), website_url: value.website_url ?? null };
}
function buildConditionCanonical(snapshot: ExperimentConditionSnapshotV1) {
  return {
    question_set_id: snapshot.question_set_id,
    questions: [...snapshot.questions].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map((question)=>({
      id: question.id, prompt_text: question.prompt_text, prompt_hash: question.prompt_hash ?? null,
      intent_type: question.intent_type, language: question.language, country_code: question.country_code,
      region: question.region ?? null, city: question.city ?? null, weight: question.weight,
      data_class: question.data_class, active: question.active,
    })),
    selected_providers: [...snapshot.planned.selected_providers].sort(),
    provider_models: Object.keys(snapshot.planned.provider_models).sort().reduce<Record<string,string>>((acc,key)=>{acc[key]=snapshot.planned.provider_models[key]!;return acc;},{}),
    repetitions: snapshot.planned.repetitions,
    search_context_size: snapshot.planned.search_context_size,
    store: snapshot.planned.store,
    parsing_context: { target: canonicalBusiness(snapshot.parsing_context.target), competitors: [...snapshot.parsing_context.competitors].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(canonicalBusiness) },
  };
}
async function sha256Hex(text:string):Promise<string>{const bytes=new TextEncoder().encode(text);const digest=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(digest)).map((byte)=>byte.toString(16).padStart(2,"0")).join("");}
async function computeConditionHash(snapshot:ExperimentConditionSnapshotV1):Promise<string>{return sha256Hex(stableStringify(buildConditionCanonical(snapshot)));}
function isRecord(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);}
function stringArray(value:unknown):string[]|null{if(!Array.isArray(value)||!value.every((item)=>typeof item==="string"))return null;return value;}
function parseSnapshotQuestion(value:unknown):SnapshotQuestion|null{if(!isRecord(value))return null;const weight=Number(value.weight);if(typeof value.id!=="string"||typeof value.prompt_text!=="string"||!(typeof value.prompt_hash==="string"||value.prompt_hash===null)||typeof value.intent_type!=="string"||typeof value.language!=="string"||typeof value.country_code!=="string"||!(typeof value.region==="string"||value.region===null)||!(typeof value.city==="string"||value.city===null)||!Number.isFinite(weight)||typeof value.data_class!=="string"||typeof value.active!=="boolean")return null;return{id:value.id,prompt_text:value.prompt_text,prompt_hash:value.prompt_hash as string|null,intent_type:value.intent_type,language:value.language,country_code:value.country_code,region:value.region as string|null,city:value.city as string|null,weight,data_class:value.data_class,active:value.active};}
function parseSnapshotBusiness(value:unknown):SnapshotBusinessRef|null{if(!isRecord(value))return null;const aliases=stringArray(value.aliases),officialDomains=stringArray(value.official_domains);if(typeof value.id!=="string"||typeof value.name!=="string"||!aliases||!officialDomains||!(typeof value.website_url==="string"||value.website_url===null))return null;return{id:value.id,name:value.name,aliases,official_domains:officialDomains,website_url:value.website_url as string|null};}
function parseExperimentSnapshot(value:unknown):ExperimentConditionSnapshotV1|null{if(!isRecord(value)||value.snapshot_version!=="1"||!isRecord(value.planned)||!isRecord(value.parsing_context))return null;const questionValues=Array.isArray(value.questions)?value.questions:[];const questions=questionValues.map(parseSnapshotQuestion);if(questions.some((q)=>!q))return null;const target=parseSnapshotBusiness(value.parsing_context.target);const competitorValues=Array.isArray(value.parsing_context.competitors)?value.parsing_context.competitors:[];const competitors=competitorValues.map(parseSnapshotBusiness);if(!target||competitors.some((b)=>!b))return null;const selectedProviders=stringArray(value.planned.selected_providers);const providerModelsRaw=value.planned.provider_models;if(!selectedProviders||!isRecord(providerModelsRaw))return null;const providerModels:Record<string,string>={};for(const[key,model]of Object.entries(providerModelsRaw)){if(typeof model!=="string")return null;providerModels[key]=model;}const repetitions=Number(value.planned.repetitions),plannedJobs=Number(value.planned.planned_jobs),estimatedCostUsd=Number(value.planned.estimated_cost_usd),maxCostUsd=Number(value.planned.max_cost_usd);if(typeof value.captured_at!=="string"||typeof value.experiment_id!=="string"||typeof value.org_id!=="string"||typeof value.business_id!=="string"||typeof value.source_insight_action_id!=="string"||typeof value.reference_source_run_id!=="string"||typeof value.question_set_id!=="string"||typeof value.condition_hash!=="string"||!Number.isInteger(repetitions)||!Number.isInteger(plannedJobs)||!Number.isFinite(estimatedCostUsd)||!Number.isFinite(maxCostUsd)||typeof value.planned.search_context_size!=="string"||typeof value.planned.store!=="boolean")return null;return{snapshot_version:"1",captured_at:value.captured_at,experiment_id:value.experiment_id,org_id:value.org_id,business_id:value.business_id,source_insight_action_id:value.source_insight_action_id,reference_source_run_id:value.reference_source_run_id,question_set_id:value.question_set_id,questions:questions as SnapshotQuestion[],planned:{selected_providers:selectedProviders,provider_models:providerModels,repetitions,search_context_size:value.planned.search_context_size,store:value.planned.store,planned_jobs:plannedJobs,estimated_cost_usd:estimatedCostUsd,max_cost_usd:maxCostUsd},parsing_context:{target,competitors:competitors as SnapshotBusinessRef[]},condition_hash:value.condition_hash};}

function officialDomains(row:Record<string,unknown>):string[]{const domains=new Set<string>();for(const value of(Array.isArray(row.official_domains)?row.official_domains:[])){if(typeof value!=="string")continue;const domain=normalizeDomain(value);if(domain)domains.add(domain);}if(typeof row.website_url==="string"){const domain=normalizeDomain(row.website_url);if(domain)domains.add(domain);}return[...domains];}
function toBusiness(row:Record<string,unknown>,isClient:boolean):BusinessForParsing{return{id:String(row.id),name:String(row.name),aliases:Array.isArray(row.aliases)?row.aliases.filter((value):value is string=>typeof value==="string"):[],officialDomains:officialDomains(row),isClient};}
function toSource(row:Record<string,unknown>):ProviderSource|undefined{if(typeof row.url!=="string"||!row.url.trim())return undefined;return{url:row.url,domain:typeof row.domain==="string"&&row.domain.trim()?row.domain:undefined,title:typeof row.title==="string"&&row.title.trim()?row.title:undefined};}
function safeMessage(error:unknown):string{return(error instanceof Error?error.message:String(error)).slice(0,500);}

Deno.serve(async(request)=>{
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:RESPONSE_HEADERS});
  if(request.method!=="POST")return jsonResponse({ok:false,error:"METHOD_NOT_ALLOWED"},405);
  try{
    const{url:supabaseUrl,secretKey:serviceRoleKey}=getSupabaseRuntimeEnv();
    if(!supabaseUrl||!serviceRoleKey)throw new AppError(500,"SERVER_NOT_CONFIGURED");
    const token=bearerToken(request);if(!token)throw new AppError(401,"AUTH_REQUIRED");
    const serviceClient=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const{data:authData,error:authError}=await serviceClient.auth.getUser(token);if(authError||!authData.user)throw new AppError(401,"INVALID_USER_TOKEN");
    const user=authData.user;
    let payload:Record<string,unknown>;
    try{const parsed=await request.json();payload=parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed as Record<string,unknown>:{};}catch{throw new AppError(400,"INVALID_JSON");}
    const runId=typeof payload.run_id==="string"?payload.run_id.trim():"";if(!isUuid(runId))throw new AppError(400,"INVALID_RUN_ID");
    // Production safety: the DB is never changed unless dry_run is explicitly false.
    const dryRun=payload.dry_run!==false;

    const{data:membershipRows,error:membershipError}=await serviceClient.from("organization_members").select("org_id,role").eq("user_id",user.id).in("role",["owner","admin","analyst"]);
    if(membershipError)throw new AppError(500,"MEMBERSHIP_LOAD_FAILED");
    const allowedOrgIds=(membershipRows??[]).map((row)=>String(row.org_id)).filter(Boolean);if(allowedOrgIds.length===0)throw new AppError(403,"REPARSE_ROLE_REQUIRED");
    const{data:run,error:runError}=await serviceClient.from("measurement_runs").select("id,org_id,business_id,status,run_type,phase,experiment_id,question_set_id").eq("id",runId).in("org_id",allowedOrgIds).maybeSingle();
    if(runError)throw new AppError(500,"RUN_LOAD_FAILED");if(!run)throw new AppError(404,"RUN_NOT_FOUND_OR_FORBIDDEN");
    const orgId=String(run.org_id),businessId=String(run.business_id),runType=typeof run.run_type==="string"?run.run_type:"",runPhase=typeof run.phase==="string"?run.phase:"",experimentId=typeof run.experiment_id==="string"?run.experiment_id:"",experimentMode=runType==="experiment";
    let experimentSnapshot:ExperimentConditionSnapshotV1|null=null;
    if(experimentMode){
      if(!experimentId||!(runPhase==="baseline"||runPhase==="followup"))throw new AppError(409,"EXPERIMENT_RUN_UNSUPPORTED");
      const{data:experiment,error:experimentError}=await serviceClient.from("experiments").select(["id","org_id","business_id","baseline_run_id","followup_run_id","baseline_condition_snapshot","followup_condition_snapshot"].join(",")).eq("id",experimentId).eq("org_id",orgId).eq("business_id",businessId).maybeSingle();
      if(experimentError)throw new AppError(500,"EXPERIMENT_LOAD_FAILED");if(!experiment)throw new AppError(404,"EXPERIMENT_NOT_FOUND");
      const canonicalRunId=runPhase==="baseline"?experiment.baseline_run_id:experiment.followup_run_id;if(canonicalRunId!==runId)throw new AppError(409,"EXPERIMENT_CANONICAL_RUN_MISMATCH");
      const rawSnapshot=runPhase==="baseline"?experiment.baseline_condition_snapshot:experiment.followup_condition_snapshot;experimentSnapshot=parseExperimentSnapshot(rawSnapshot);if(!experimentSnapshot)throw new AppError(409,"EXPERIMENT_SNAPSHOT_INVALID");
      if(experimentSnapshot.experiment_id!==experimentId||experimentSnapshot.org_id!==orgId||experimentSnapshot.business_id!==businessId||experimentSnapshot.question_set_id!==String(run.question_set_id)||experimentSnapshot.parsing_context.target.id!==businessId)throw new AppError(409,"EXPERIMENT_SNAPSHOT_SCOPE_MISMATCH");
      if(experimentSnapshot.questions.length!==3||experimentSnapshot.planned.selected_providers.length!==1||experimentSnapshot.planned.selected_providers[0]!=="openai"||experimentSnapshot.planned.repetitions!==5||experimentSnapshot.planned.planned_jobs!==15||experimentSnapshot.planned.store!==false)throw new AppError(409,"EXPERIMENT_SNAPSHOT_PLAN_MISMATCH");
      if(!dryRun&&run.status!=="completed")throw new AppError(409,"EXPERIMENT_REPARSE_REQUIRES_COMPLETED_RUN");
      const recomputedHash=await computeConditionHash(experimentSnapshot);if(recomputedHash!==experimentSnapshot.condition_hash)throw new AppError(409,"EXPERIMENT_CONDITION_HASH_MISMATCH");
    }

    let businesses:BusinessForParsing[];
    if(experimentSnapshot){businesses=[toBusiness(experimentSnapshot.parsing_context.target as unknown as Record<string,unknown>,true),...experimentSnapshot.parsing_context.competitors.map((row)=>toBusiness(row as unknown as Record<string,unknown>,false))];}
    else{
      const{data:target,error:targetError}=await serviceClient.from("businesses").select("id,name,aliases,official_domains,website_url").eq("id",businessId).eq("org_id",orgId).eq("active",true).maybeSingle();if(targetError)throw new AppError(500,"TARGET_LOAD_FAILED");if(!target)throw new AppError(404,"TARGET_BUSINESS_NOT_FOUND");
      const{data:links,error:linksError}=await serviceClient.from("business_competitors").select("competitor_business_id").eq("org_id",orgId).eq("target_business_id",businessId).eq("active",true);if(linksError)throw new AppError(500,"COMPETITOR_LINKS_FAILED");
      const competitorIds=(links??[]).map((row)=>String(row.competitor_business_id)).filter(Boolean);let competitorRows:Record<string,unknown>[]=[];
      if(competitorIds.length>0){const{data,error}=await serviceClient.from("businesses").select("id,name,aliases,official_domains,website_url").eq("org_id",orgId).eq("active",true).in("id",competitorIds);if(error)throw new AppError(500,"COMPETITOR_LOAD_FAILED");competitorRows=(data??[]) as Record<string,unknown>[];}
      businesses=[toBusiness(target as Record<string,unknown>,true),...competitorRows.map((row)=>toBusiness(row,false))];
    }

    const{data:measurementRows,error:measurementError}=await serviceClient.from("measurements").select(["id","org_id","run_id","question_id","response_text","parser_version","was_client_mentioned","client_position","client_domain_cited","valid","invalid_reason","parse_confidence","manual_review_required","created_at"].join(",")).eq("org_id",orgId).eq("run_id",runId).order("created_at",{ascending:true}).range(0,MAX_MEASUREMENTS);
    if(measurementError)throw new AppError(500,"MEASUREMENTS_LOAD_FAILED");const measurements=(measurementRows??[]) as Record<string,unknown>[];if(measurements.length>MAX_MEASUREMENTS)throw new AppError(413,"TOO_MANY_MEASUREMENTS");
    if(measurements.length===0)return jsonResponse({ok:true,dry_run:true,parser_version:PARSER_VERSION,run_id:runId,measurement_count:0,api_provider_called:false,preview:[]});
    const measurementIds=measurements.map((row)=>String(row.id));
    const questionIds=[...new Set(measurements.map((row)=>typeof row.question_id==="string"?row.question_id:"").filter(Boolean))];
    const questionContextById=new Map<string,{region?:string;city?:string}>();
    if(experimentSnapshot){const snapshotQuestionsById=new Map(experimentSnapshot.questions.map((q)=>[q.id,q] as const));for(const questionId of questionIds){const question=snapshotQuestionsById.get(questionId);if(!question||!question.active||question.data_class!=="public")throw new AppError(409,"EXPERIMENT_QUESTION_CONTEXT_MISMATCH");questionContextById.set(questionId,{region:question.region??undefined,city:question.city??undefined});}}
    else if(questionIds.length>0){const{data:questionRows,error:questionError}=await serviceClient.from("questions").select("id,region,city").eq("org_id",orgId).in("id",questionIds);if(questionError)throw new AppError(500,"QUESTION_CONTEXT_LOAD_FAILED");for(const row of(questionRows??[]) as Record<string,unknown>[]){const id=String(row.id);questionContextById.set(id,{region:typeof row.region==="string"?row.region:undefined,city:typeof row.city==="string"?row.city:undefined});}}

    const{data:sourceRows,error:sourceError}=await serviceClient.from("measurement_sources").select("measurement_id,url,domain,title").eq("org_id",orgId).in("measurement_id",measurementIds);if(sourceError)throw new AppError(500,"SOURCES_LOAD_FAILED");
    const sourcesByMeasurement=new Map<string,ProviderSource[]>();for(const raw of(sourceRows??[]) as Record<string,unknown>[]){const measurementId=String(raw.measurement_id),source=toSource(raw);if(!source)continue;const current=sourcesByMeasurement.get(measurementId)??[];current.push(source);sourcesByMeasurement.set(measurementId,current);}
    const reparsed=measurements.map((measurement)=>{const measurementId=String(measurement.id),responseText=typeof measurement.response_text==="string"?measurement.response_text:"",sources=sourcesByMeasurement.get(measurementId)??[],questionId=typeof measurement.question_id==="string"?measurement.question_id:"";return{measurement,parsed:parseMeasurement(responseText,sources,businesses,questionContextById.get(questionId))};});
    const preview=reparsed.map(({measurement,parsed})=>({measurement_id:String(measurement.id),old_parser_version:typeof measurement.parser_version==="string"?measurement.parser_version:null,parser_version:PARSER_VERSION,was_client_mentioned:parsed.wasClientMentioned,client_position:parsed.clientPosition??null,client_domain_cited:parsed.clientDomainCited,valid:parsed.valid,invalid_reason:parsed.invalidReason??null,parse_confidence:parsed.parseConfidence,manual_review_required:parsed.manualReviewRequired,mentions:parsed.mentions.map((mention)=>({display_name:mention.displayName,matched_business_id:mention.businessId??null,matched_alias:mention.matchedAlias??null,position:mention.position,explicit_rank:mention.explicitRank,confidence:mention.confidence})),entity_resolutions:parsed.entityResolutions.map((resolution)=>({display_name:resolution.displayName,position:resolution.position,explicit_rank:resolution.explicitRank,entity_kind:resolution.entityKind,specificity:resolution.specificity,resolution_confidence:resolution.specificityConfidence,count_as_confirmed_business:resolution.countAsConfirmedBusiness,matched_business_id:resolution.matchedBusinessId??null,matched_alias:resolution.matchedAlias??null,evidence:resolution.evidence,context_excerpt:resolution.contextExcerpt})),resolution_summary:parsed.resolutionSummary}));

    if(dryRun){console.info(JSON.stringify({function:"reparse-measurements",mode:"v1.2.5-dry-run",run_id:runId,org_id:orgId,parser_version:PARSER_VERSION,measurement_count:reparsed.length,api_provider_called:false,database_modified:false}));return jsonResponse({ok:true,mode:"v1.2.5-dry-run",dry_run:true,parser_version:PARSER_VERSION,run_id:runId,org_id:orgId,measurement_count:reparsed.length,updated:0,api_provider_called:false,database_modified:false,preview});}

    const{data:oldMentionRows,error:oldMentionError}=await serviceClient.from("measurement_mentions").select(["measurement_id","matched_business_id","display_name","matched_alias","position","explicit_rank","confidence","entity_kind","specificity","resolution_confidence","count_as_confirmed_business","resolution_evidence"].join(",")).eq("org_id",orgId).in("measurement_id",measurementIds);if(oldMentionError)throw new AppError(500,"OLD_MENTIONS_LOAD_FAILED");
    const oldMentionsByMeasurement=new Map<string,Record<string,unknown>[]>();for(const row of(oldMentionRows??[]) as Record<string,unknown>[]){const measurementId=String(row.measurement_id),current=oldMentionsByMeasurement.get(measurementId)??[];current.push(row);oldMentionsByMeasurement.set(measurementId,current);}

    const restoreMentions=async(measurementId:string,rows:Record<string,unknown>[]):Promise<void>=>{const{error:deleteError}=await serviceClient.from("measurement_mentions").delete().eq("org_id",orgId).eq("measurement_id",measurementId);if(deleteError){console.error(JSON.stringify({function:"reparse-measurements",code:"ROLLBACK_MENTIONS_DELETE_FAILED",measurement_id:measurementId,message:deleteError.message}));return;}if(rows.length===0)return;const{error:insertError}=await serviceClient.from("measurement_mentions").insert(rows.map((row)=>({org_id:orgId,measurement_id:measurementId,matched_business_id:row.matched_business_id??null,display_name:String(row.display_name),matched_alias:row.matched_alias??null,position:Number(row.position),explicit_rank:Boolean(row.explicit_rank),confidence:typeof row.confidence==="string"?row.confidence:"low",entity_kind:row.entity_kind??null,specificity:row.specificity??null,resolution_confidence:row.resolution_confidence??null,count_as_confirmed_business:Boolean(row.count_as_confirmed_business),resolution_evidence:row.resolution_evidence&&typeof row.resolution_evidence==="object"?row.resolution_evidence:{}})));if(insertError)console.error(JSON.stringify({function:"reparse-measurements",code:"ROLLBACK_MENTIONS_INSERT_FAILED",measurement_id:measurementId,message:insertError.message}));};
    const restoreMeasurement=async(measurement:Record<string,unknown>):Promise<void>=>{const measurementId=String(measurement.id);const{error}=await serviceClient.from("measurements").update({was_client_mentioned:Boolean(measurement.was_client_mentioned),client_position:typeof measurement.client_position==="number"?measurement.client_position:null,client_domain_cited:Boolean(measurement.client_domain_cited),valid:Boolean(measurement.valid),invalid_reason:measurement.invalid_reason??null,parser_version:typeof measurement.parser_version==="string"?measurement.parser_version:"unknown",parse_confidence:typeof measurement.parse_confidence==="string"?measurement.parse_confidence:"low",manual_review_required:Boolean(measurement.manual_review_required)}).eq("id",measurementId).eq("org_id",orgId).eq("run_id",runId);if(error)console.error(JSON.stringify({function:"reparse-measurements",code:"ROLLBACK_MEASUREMENT_FAILED",measurement_id:measurementId,message:error.message}));};

    let updated=0;const touchedMeasurementIds=new Set<string>();
    try{
      for(const{measurement,parsed}of reparsed){const measurementId=String(measurement.id);touchedMeasurementIds.add(measurementId);const{error:deleteError}=await serviceClient.from("measurement_mentions").delete().eq("org_id",orgId).eq("measurement_id",measurementId);if(deleteError)throw new AppError(500,"MENTIONS_DELETE_FAILED");
        const resolutionRowsByKey=new Map<string,Record<string,unknown>>();for(const resolution of parsed.entityResolutions){const matchedBusinessId=resolution.matchedBusinessId??null,displayName=String(resolution.displayName).trim();if(!displayName)continue;const normalizedName=displayName.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,"");const key=matchedBusinessId?`business:${matchedBusinessId}`:`name:${normalizedName}`;const nextRow={org_id:orgId,measurement_id:measurementId,matched_business_id:matchedBusinessId,display_name:displayName,matched_alias:resolution.matchedAlias??null,position:resolution.position,explicit_rank:Boolean(resolution.explicitRank),confidence:resolution.specificityConfidence??"low",entity_kind:resolution.entityKind,specificity:resolution.specificity,resolution_confidence:resolution.specificityConfidence,count_as_confirmed_business:Boolean(resolution.countAsConfirmedBusiness),resolution_evidence:resolution.evidence??{}};const existing=resolutionRowsByKey.get(key);if(!existing||Number(nextRow.position)<Number(existing.position))resolutionRowsByKey.set(key,nextRow);}
        const resolutionRows=[...resolutionRowsByKey.values()];if(resolutionRows.length>0){const{error:insertError}=await serviceClient.from("measurement_mentions").insert(resolutionRows);if(insertError)throw new AppError(500,"MENTIONS_INSERT_FAILED");}
        const{error:updateError}=await serviceClient.from("measurements").update({was_client_mentioned:parsed.wasClientMentioned,client_position:parsed.clientPosition??null,client_domain_cited:parsed.clientDomainCited,valid:parsed.valid,invalid_reason:parsed.invalidReason??null,parser_version:PARSER_VERSION,parse_confidence:parsed.parseConfidence,manual_review_required:parsed.manualReviewRequired}).eq("id",measurementId).eq("org_id",orgId).eq("run_id",runId);if(updateError)throw new AppError(500,"MEASUREMENT_UPDATE_FAILED");updated+=1;}
    }catch(writeError){console.error(JSON.stringify({function:"reparse-measurements",code:"V123_WRITE_FAILED_ROLLBACK_START",message:safeMessage(writeError)}));for(const{measurement}of reparsed){const measurementId=String(measurement.id);if(!touchedMeasurementIds.has(measurementId))continue;await restoreMentions(measurementId,oldMentionsByMeasurement.get(measurementId)??[]);await restoreMeasurement(measurement as Record<string,unknown>);}throw writeError;}

    console.info(JSON.stringify({function:"reparse-measurements",mode:"v1.2.5-production-reparse",run_id:runId,org_id:orgId,parser_version:PARSER_VERSION,measurement_count:reparsed.length,updated,api_provider_called:false,database_modified:true}));
    const{data:postprocessTokenRow,error:postprocessTokenError}=await serviceClient.from("visibility_postprocess_tokens").select("token").eq("active",true).order("created_at",{ascending:true}).limit(1).maybeSingle();if(postprocessTokenError||!postprocessTokenRow||typeof postprocessTokenRow.token!=="string"||!postprocessTokenRow.token.trim())throw new AppError(500,"POSTPROCESS_TOKEN_UNAVAILABLE");
    const postprocessToken=postprocessTokenRow.token.trim();
    const invokeInternal=async(functionName:string,body:Record<string,unknown>):Promise<Record<string,unknown>>=>{const response=await fetch(`${supabaseUrl}/functions/v1/${functionName}`,{method:"POST",headers:{"Content-Type":"application/json","x-visibility-postprocess-token":postprocessToken},body:JSON.stringify(body)});let result:Record<string,unknown>={};try{const parsed=await response.json();if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))result=parsed as Record<string,unknown>;}catch{result={};}if(!response.ok||result.ok!==true)throw new AppError(500,`DOWNSTREAM_${functionName.toUpperCase().replaceAll("-","_")}_FAILED`);return result;};
    const postprocessResult=await invokeInternal("visibility-postprocess",{runId,force:true});
    const attributionResult=await invokeInternal("visibility-citation-attribution",{runId});
    const entityFactsResult=await invokeInternal("entity-facts-v2-materialize-run",{runId,refresh:true});
    return jsonResponse({ok:true,mode:"v1.2.5-production-reparse",dry_run:false,parser_version:PARSER_VERSION,run_id:runId,org_id:orgId,measurement_count:reparsed.length,updated,api_provider_called:false,database_modified:true,downstream_rebuilt:true,postprocess:postprocessResult,citation_attribution:attributionResult,entity_facts_v2:entityFactsResult,preview});
  }catch(error){const status=error instanceof AppError?error.status:500,code=error instanceof AppError?error.code:"REPARSE_FAILED";console.error(JSON.stringify({function:"reparse-measurements",parser_version:PARSER_VERSION,code,message:safeMessage(error)}));return jsonResponse({ok:false,parser_version:PARSER_VERSION,error:code},status);}
});
