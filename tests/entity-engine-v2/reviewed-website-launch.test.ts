import { describe, expect, it } from "vitest";
import { readWebsiteLaunchReview } from "../../src/lib/reviewed-website-launch";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  return {
    orgId: uuid(1), businessId: uuid(2), host: "example.com",
    publishedOn: "2026-02-01", readoutChanged: true,
    runs: ["2026-01-01","2026-02-02","2026-02-04"].map((day, i) => ({ id: uuid(i+3), day })),
    questions: Array.from({length:24}, (_, i) => ({
      id: uuid(30+i), text: `질문 ${i + 1}`,
      appearances: [i === 0 ? "seen" : "absent", i < 3 ? "linked" : "absent", i < 2 ? "seen" : "absent"],
    })),
    nextTest: { label:"가격 질문", instruction:"가격을 확인해 보세요.", reason:"저장된 가격 비교 답변", questionIds:[uuid(50)], evidenceQuestionId:uuid(49) },
  };
}
const read = (v: unknown) => readWebsiteLaunchReview(v, uuid(1), uuid(2));

describe("reviewed website launch observations", () => {
  it("counts direct citations separately and pairs new appearances to their first follow-up", () => {
    const r=read(fixture());
    expect(r?.runs.map(p=>[p.mentioned,p.linked])).toEqual([[1,0],[3,3],[2,0]]);
    expect(r?.added.map(q=>q.id)).toEqual([uuid(31),uuid(32)]);
    expect(r?.nextTest?.questionIds).toEqual([uuid(50)]);
  });
  it("hides a review with bad ownership, dates, duplicate questions, or incomplete pairs", () => {
    const f=fixture();
    expect(read({...f, businessId:uuid(99)})).toBeNull();
    expect(read({...f, orgId:uuid(99)})).toBeNull();
    expect(read({...f,publishedOn:"2026-02-03"})).toBeNull();
    expect(read({...f,questions:f.questions.slice(1)})).toBeNull();
    expect(read({...f,questions:[f.questions[1],...f.questions.slice(1)]})).toBeNull();
    f.questions[0]!.appearances.pop();
    expect(read(f)).toBeNull();
  });
  it("keeps an archived comparison but drops a recommendation with contradictory evidence", () => {
    const f=fixture();
    f.nextTest.questionIds=[f.questions[0]!.id];
    expect(read(f)?.nextTest).toBeNull();
    expect(read(f)?.runs).toHaveLength(3);
  });
});
