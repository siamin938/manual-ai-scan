import { describe,expect,it } from "vitest";
import { nextMeasurementQuestion, actionGuideCopy } from "../../src/components/diagnostic-action-guide";
import type { EntityFactsV2ReadGatewayDTO } from "../../src/lib/entity-facts-v2-read-gateway.types";
type Input = Pick<EntityFactsV2ReadGatewayDTO, "questionAreas"|"questionGroups"|"questionLocations">;
const bounds = {confirmedTop3Count:0,top3UncertainCount:0,visibilityLowerBoundPct:0,visibilityUpperBoundPct:0,top3LowerBoundPct:0,top3UpperBoundPct:0};
function input(values: { id:string; valid:number; confirmed:number; unresolved:number }[]): Input {
 const rows=values.map(v=>({...bounds,questionId:v.id,questionText:`저장 원문 ${v.id}`,intentType:"local",status:"missing" as const,validCount:v.valid,confirmedMentionCount:v.confirmed,unresolvedTargetCount:v.unresolved}));
 return {questionAreas:rows,questionGroups:[{...bounds,intentType:"local",questionCount:rows.length,validCount:rows.reduce((s,q)=>s+q.validCount,0),confirmedMentionCount:rows.reduce((s,q)=>s+q.confirmedMentionCount,0),unresolvedTargetCount:rows.reduce((s,q)=>s+q.unresolvedTargetCount,0)}],questionLocations:rows.map(q=>({questionId:q.questionId,city:q.questionId==='local'?"저장 지역":null}))};
}
describe("execution guide saved evidence boundaries",()=>{
 it("selects only valid > 0, confirmed = 0, unresolved = 0",()=>{
  const dto=input([{id:"confirmed",valid:1,confirmed:1,unresolved:0},{id:"mixed",valid:2,confirmed:1,unresolved:1},{id:"check",valid:1,confirmed:0,unresolved:1},{id:"empty",valid:0,confirmed:0,unresolved:0},{id:"local",valid:1,confirmed:0,unresolved:0}]);
  expect(nextMeasurementQuestion(dto)?.questionId).toBe("local");
 });
 it("prefers an actually mapped detailed location without parsing question text",()=>{
  const dto=input([{id:"broad",valid:1,confirmed:0,unresolved:0},{id:"local",valid:1,confirmed:0,unresolved:0}]);
  expect(nextMeasurementQuestion(dto)).toBe(dto.questionAreas[1]);
  expect(dto.questionAreas.map(q=>q.questionId)).toEqual(["broad","local"]);
 });
 it("does not use inconsistent group snapshots",()=>{
  const dto=input([{id:"local",valid:1,confirmed:0,unresolved:0}]);
  const group=dto.questionGroups[0];if(!group)throw Error('fixture');group.validCount=2;
  expect(nextMeasurementQuestion(dto)).toBeNull();
 });
 it("does not invent an absent question for fully confirmed results",()=>expect(nextMeasurementQuestion(input([{id:"yes",valid:1,confirmed:1,unresolved:0}]))).toBeNull());
 it("does not use unanswered questions",()=>expect(nextMeasurementQuestion(input([{id:"none",valid:0,confirmed:0,unresolved:0}]))).toBeNull());
 it("does not need location metadata to retain valid saved evidence",()=>{
  const dto=input([{id:"broad",valid:1,confirmed:0,unresolved:0}]); delete dto.questionLocations;
  expect(nextMeasurementQuestion(dto)).toBe(dto.questionAreas[0]);
 });
 it("covers all seven engine kinds without title parsing",()=>expect(Object.keys(actionGuideCopy)).toEqual(["profile_directory","owned_web_presence","auto_platform","blog_presence","news_presence","video_presence","community_presence"]));
});
