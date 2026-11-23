import { z } from "zod";
import { CUSTOMER_STANDARD_QUESTION_COUNT } from "./customer-measurement.helpers";

const id = z.string().uuid();
const day = z.string().date();
const text = z.string().trim().min(1).max(350);
const appearance = z.enum(["absent", "seen", "linked"]);

const review = z.object({
  businessId: id, orgId: id, publishedOn: day,
  host: z.string().max(253).regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i),
  readoutChanged: z.boolean(),
  runs: z.array(z.object({ id, day })).min(2).max(3),
  questions: z.array(z.object({
    id, text, appearances: z.array(appearance).min(2).max(3),
  })).length(CUSTOMER_STANDARD_QUESTION_COUNT),
  nextTest: z.object({
    instruction: text, reason: text, label: text,
    questionIds: z.array(id).min(1).max(CUSTOMER_STANDARD_QUESTION_COUNT), evidenceQuestionId: id,
  }).optional(),
});

/** Read an explicitly reviewed, dated observation. The standard run comparison has a separate contract. */
export function readWebsiteLaunchReview(value: unknown, orgId: string, businessId: string) {
  const result = review.safeParse(value);
  if (!result.success) return null;
  const item = result.data;
  const { runs, questions, publishedOn } = item;
  if (item.orgId !== orgId || item.businessId !== businessId) return null;
  if (runs[0]!.day >= publishedOn || runs[1]!.day < publishedOn ||
      (runs[2] && runs[2].day < runs[1]!.day) || new Set(runs.map(r => r.id)).size !== runs.length) return null;
  if (questions.some(q => q.appearances.length !== runs.length) ||
      new Set(questions.map(q => q.id)).size !== questions.length) return null;

  const added = questions.filter(q => q.appearances[0] === "absent" && q.appearances[1] !== "absent")
    .map(q => ({ id: q.id, text: q.text, linked: q.appearances[1] === "linked" }));
  const test = item.nextTest;
  const testedQuestions = test ? questions.filter(q => test.questionIds.includes(q.id)) : [];
  const nextTest = test && testedQuestions.length === test.questionIds.length &&
    testedQuestions.every(q => q.appearances.slice(1).every(s => s === "absent")) &&
    questions.some(q => q.id === test.evidenceQuestionId) ? test : null;

  return {
    publishedOn, host: item.host, readoutChanged: item.readoutChanged,
    questionCount: questions.length, added, nextTest,
    runs: runs.map((run, index) => ({
      ...run,
      mentioned: questions.filter(q => q.appearances[index] !== "absent").length,
      linked: questions.filter(q => q.appearances[index] === "linked").length,
    })),
  };
}

export type ReviewedWebsiteLaunch = NonNullable<ReturnType<typeof readWebsiteLaunchReview>>;
