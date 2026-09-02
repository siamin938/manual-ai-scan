# AI Insights Hub

한국어 기반 B2B 내부 운영용 웹앱 **AI Visibility Lab 1차 MVP**를 만들어줘.

이미 이 Lovable 프로젝트에는 외부 Supabase 프로젝트가 연결되어 있다. 반드시 연결된 Supabase의 기존 테이블, 뷰, RPC, RLS 정책을 사용하고, 기존 테이블명을 바꾸거나 비슷한 새 테이블을 임의로 만들지 마.

## 이번 단계의 목표

이번에는 자동 AI 측정 시스템을 만들지 않는다. 운영자가 업체, 경쟁업체, 질문, 사람이 직접 확인한 AI 답변을 기록하고 고객용 보고서를 보여줄 수 있는 작동 화면만 만든다.

## 이번 단계에서 구현할 기능

1. Supabase Auth 기반 회원가입, 로그인, 로그아웃
2. 로그인 후 조직이 없으면 조직 생성 온보딩
3. RPC `create_organization_with_owner`를 사용한 조직 생성
4. 업체 관리
   - 대상 업체와 경쟁업체 등록·수정·비활성화
   - 공식 업체명, 별칭, 업종, 홈페이지, 네이버 플레이스, 구글 지도, 주소, 국가, 지역, 도시
5. 질문 세트와 질문 관리
   - 질문 추가·수정·비활성화
   - 질문 문구, 의도 유형, 언어, 국가, 지역, 도시, 가중치, data_class
   - data_class가 public이 아니면 빨간 경고를 표시
6. 수동 UI 점검 관리
   - 플랫폼: chatgpt_ui / gemini_app / perplexity_web
   - 질문, 답변, 업체 포함 여부, 언급 순서, 측정 시각, 로그인 여부, 개인화 여부, 메모
   - 스크린샷 업로드
7. 간단한 대시보드
   - 등록 업체 수
   - 등록 질문 수
   - 수동 점검 수
   - 플랫폼별 업체 포함 횟수
   - 최근 수동 점검
8. `/reports/manual` 경로의 인쇄 가능한 고객 보고서
   - 업체 정보
   - 확인한 플랫폼과 질문 수
   - 질문별 업체 포함 여부
   - 경쟁업체 언급
   - 주요 관찰 내용
   - 운영자가 입력한 다음 행동 우선순위
   - 면책 문구

## 디자인

- React + TypeScript
- Tailwind CSS
- shadcn/ui
- Recharts
- 한국어 UI
- 모바일·데스크톱 반응형
- 전문적인 B2B 분석 서비스 느낌
- 과도한 그라데이션이나 화려한 효과는 피함
- 날짜와 시간은 Asia/Seoul 기준 표시

## 역할과 권한

역할은 owner, admin, analyst, client_viewer를 사용한다.

- owner/admin/analyst: 업체, 질문, 수동 점검을 생성·수정할 수 있음
- client_viewer: 결과와 보고서만 조회 가능
- client_viewer에게 비용, 제공업체 설정, 내부 메모, 생성·수정 버튼을 보여주지 마
- 조직 A 사용자는 조직 B 데이터를 볼 수 없어야 하며 기존 RLS를 존중해

## 중요한 보안 규칙

- OpenAI, Gemini, Perplexity API를 아직 호출하지 마
- API 키 입력 화면을 만들지 마
- API 키를 프론트엔드 코드, localStorage, VITE_ 환경변수에 넣지 마
- service role 또는 secret key를 프론트엔드에 넣지 마
- 외부 AI에 데이터를 보내는 기능을 만들지 마
- 소비자 AI 웹사이트 로그인 자동화나 스크래핑을 만들지 마
- `raw_provider_payloads` 같은 내부 원본 테이블을 프론트엔드에서 조회하지 마

## 이번 단계에서 만들지 않을 것

- 자동 측정 실행
- `enqueue-run` 호출
- 작업 큐와 cron
- OpenAI 자동 검색
- Gemini 자동 측정
- Perplexity 자동 측정
- 결제
- 자동 추천 알고리즘
- 전체 실험 DB를 AI에게 보내 분석시키는 기능

## 표현 규칙

- “AI 노출 보장”, “순위 보장”, “확정 효과”라고 표현하지 마
- 수동 결과를 자동 API 측정과 합산하지 마
- 보고서에 다음 문구를 표시해:
  “특정 시점과 조건에서 사람이 직접 확인한 결과이며 로그인 상태, 개인화, 모델, 위치, 시점에 따라 결과가 달라질 수 있습니다.”

먼저 연결된 Supabase 스키마를 확인한 뒤 구현 계획을 짧게 제시하고, 바로 실제 데이터와 연결된 화면을 구현해. 더미 데이터만 보여주는 정적 화면으로 끝내지 마.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://manual-ai-scan.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8f2b92cc-aa3c-4f84-b7bc-c3caa394dfdd).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
