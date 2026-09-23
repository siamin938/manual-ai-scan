# Entity Engine v1 Baseline — 2026-09-12

Scope: completed standalone audit runs, non-experiment, latest production verifier `0.1.5` only.

This is a **review baseline**, not a claim that every flagged row is wrong.

## Row-level totals

| Metric | Rows |
|---|---:|
| `confirmed_business` | 504 |
| `needs_review` | 501 |
| `rejected_non_business` | 1,376 |
| confirmed rows matching obvious heading/criterion-like review patterns | 3 |
| confirmed rows where a registered business is only a subspan of a longer display surface | 10 |
| needs_review rows with branch/descriptor/repeat business-like evidence | 195 |

## What the numbers mean

### Confirmed heading/criterion review candidates

These are high-priority precision candidates. Known examples include structures such as:

- `가장 무난한 체인점`
- `성남 엔진오일 정비소 비교`
- descriptive section titles that inherited child evidence

The target for v2 is **zero canonical businesses created from the full generic heading surface**.

### Registered-business over-capture candidates

There are 10 latest-verifier rows where the confirmed display surface contains the matched registered business name but is not equal to it.

This bucket contains two different classes and must not be treated as ten errors:

1. **valid naming variation / location qualifier**
   - e.g. `남양주 커스텀개러지` -> registered `커스텀개러지`
2. **structural over-capture**
   - `금촌·조리 쪽:** 타이어프로 봉일천점`
   - `빠른 국산차 오일 교환:** 현대엑스티어 판교`
   - `성남 동남권 접근성:** 공임나라 성남 고등점`
   - `얼라인먼트까지 꼼꼼히:** 타이어프로 봉일천점`
   - `조리·봉일천 쪽:** 타이어프로 봉일천점, 더타이어샵 봉일천점`
   - `카스페이스 구로본점 패키지 구성`
   - `판교·금토동 쪽:** **삼성모터스 판교점`

v2 therefore needs separate fields for:

- observed surface text;
- extracted identity span;
- canonical identity;
- surrounding criterion/heading context.

It must not solve this by merely rejecting every non-exact registered-name surface.

### Business-like needs_review rows

195 latest-verifier rows have branch, strong business descriptor, or repeat evidence while remaining `needs_review`.

The most frequent names include a mix of likely true businesses and obvious non-business phrases. Examples from the dataset include:

- likely/possible businesses: `공임나라 분당야탑점`, `닥터카센타`, `분당 모터스 정비공장`, `카페인W 남양주점`, `타이어테크 금촌점`;
- likely non-business phrases: `PPF 부위`, `서스펜션`, `시공 범위`.

This proves v2 must be evaluated on **precision and recall together**. A design that simply pushes more rows to rejection is not acceptable.

## Acceptance metrics for shadow v2

These are initial gates; they may be tightened after corpus expansion.

1. Golden Corpus: all forbidden full surfaces must never become canonical businesses.
2. Golden Corpus: all positive-control businesses must remain recoverable.
3. Structural registered-name over-capture: criterion/heading prefix must not become the canonical display name.
4. Generic heading evidence leakage: zero cases where child/sibling evidence alone confirms the heading.
5. Platform and brand-network descriptions: zero local-business canonicalization.
6. Historical replay: every v1 -> v2 changed decision must be inspectable with reason + evidence provenance.
7. No customer impact until historical replay is reviewed and a controlled feature flag is approved.

## Baseline limitation

These counts are verification **rows**, not unique real-world businesses. A single mention may have historical rows from older verifier versions, which is why this baseline explicitly filters to `0.1.5`. Future v2 replay reports should also report unique measurement/entity pairs and unique canonical identities in addition to row counts.
