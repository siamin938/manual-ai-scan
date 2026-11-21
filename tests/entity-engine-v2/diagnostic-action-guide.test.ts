import { describe,expect,it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiagnosticActionGuide, nextMeasurementQuestion, actionGuideCopy, actionWritingHintKind } from "../../src/components/diagnostic-action-guide";
import type { PriorityEvidence } from "../../src/components/diagnostic-priority-evidence";
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
 const priority: PriorityEvidence = {kind:"profile_directory", title:"legacy",sourceGroupLabel:"saved",highEntityCount:1,highVisibilityEntityCount:2,highEntitySharePct:50,targetConnected:null,sites:[]};
 const savedQuestion = nextMeasurementQuestion(input([{id:"local",valid:1,confirmed:0,unresolved:0}]));
 it.each(["comparison","price_value"])("connects saved %s intent to an actionable cost hint",intentType=>{
  if(!savedQuestion) throw Error("fixture");
  expect(actionWritingHintKind(priority,{...savedQuestion,intentType})).toBe("cost");
 });
 it.each([["review_quality","review"],["local","location"],["trust","expertise"],["service","service"],["recommendation","recommendation"],["discovery","discovery"]])("uses the saved %s intent without parsing original text",(intentType,expected)=>{
  if(!savedQuestion || !intentType) throw Error("fixture");
  expect(actionWritingHintKind(priority,{...savedQuestion,intentType})).toBe(expected);
 });
 it("does not invent a hint without a saved question",()=>expect(actionWritingHintKind(priority,null)).toBeNull());
 it("does not direct a channel without a source signal",()=>{
  expect(actionWritingHintKind({...priority,highEntityCount:0},savedQuestion)).toBeNull();
  expect(actionWritingHintKind(null,savedQuestion)).toBeNull();
 });
 it("leaves unknown intents neutral rather than parsing price words",()=>{
  if(!savedQuestion) throw Error("fixture");
  expect(actionWritingHintKind(priority,{...savedQuestion,intentType:"unknown",questionText:"가격 비교"})).toBeNull();
 });
 it.each(Object.keys(actionGuideCopy) as (keyof typeof actionGuideCopy)[])("preserves %s source proposal with a saved hint",kind=>expect(actionWritingHintKind({...priority,kind},savedQuestion)).toBe("location"));
});

describe("customer source actions", () => {
  const dto = {
    ...input([]),
    overview: { validCount: 2, confirmedMentionCount: 1 },
    business: { name: "측정 지점", region: null, city: null },
  } as EntityFactsV2ReadGatewayDTO;
  const priority = {
    kind: "profile_directory" as const, title: "", sourceGroupLabel: "", highEntityCount: 1,
    highVisibilityEntityCount: 2, highEntitySharePct: 50, targetConnected: false, sites: [],
    ownPage: { sourceType: "naver_place", url: "https://registered.example.com/place" },
  };
  function guide(pages: NonNullable<PriorityEvidence["peerExamples"]>) {
    return renderToStaticMarkup(createElement(DiagnosticActionGuide, {
      dto, priority: { ...priority, peerExamples: pages },
    }));
  }
  it("shows the cited page and official profile actions, with registration folded", () => {
    const url = "https://daangn.com/kr/local-profile/example";
    const html = guide([{ name: "비교 정비소", domain: "daangn.com", count: 2, url }]);
    expect(html.split(`href="${url}"`)).toHaveLength(2);
    expect(html).toContain("https://business.daangn.com/profile/login");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>아직 등록 전이라면<\/summary>.*?당근 비즈프로필 등록하기/u);
    for (const value of [url, "비교 정비소", "당근", "함께 나온 답변 2개"]) expect(html.replace(/<[^>]+>/g, "") + html).toContain(value);
    expect(html).not.toContain(priority.ownPage.url);
  });
  it("omits the link group and redundant disclosures without an eligible citation", () => {
    const html = guide([]);
    for (const value of ['href="', "함께 인용된 페이지", "이 일을 추천한 이유", "저장된 관찰 원문", "판정 기준과 원자료"]) {
      expect(html).not.toContain(value);
    }
  });
});
