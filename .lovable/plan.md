# CHABOIM Grand Tourer 1차 리디자인

## 목표
밝은 그래파이트·코발트 팔레트와 읽기 편한 Humanist Sans를 바탕으로, 랜딩과 로그인 후 화면을 고급 자동차 계기판의 정밀함과 전문 리서치 리포트의 신뢰감이 공존하는 디자인으로 통일합니다.

## 구현 범위
- `src/styles.css`: 전역 색상·글꼴·표면·테두리·기본 가독성을 조정하고 기존 인쇄 스타일은 유지합니다.
- `src/routes/_authenticated/route.tsx`: sticky 상단 영역을 브랜드, 주요 메뉴, 조직·계정 도구의 명확한 위계로 재구성합니다.
- `src/routes/_authenticated/dashboard.tsx`: 리포트 헤더, 최근 측정 요약, 핵심 숫자, 후속 섹션의 간격·구분선·표 가독성을 개선합니다.
- `src/routes/index.tsx`: 현재 카피와 CTA를 유지하면서 수평 모듈과 리포트형 섹션 중심으로 정돈합니다.
- `src/components/business-selector.tsx`: 대시보드 헤더에 맞는 업체 선택 표현으로 다듬습니다.

## 보존 사항
- Supabase, DB, RPC, Edge Function, DTO, 서버 함수, query key, 인증·권한, 조직·업체 선택, 계산 로직은 변경하지 않습니다.
- 고객용 수치와 문구의 의미, 모든 기존 기능과 링크를 유지합니다.
- 새 패키지를 설치하지 않고 기존 Tailwind·shadcn·lucide만 사용합니다.
- 배포하지 않고 Preview까지만 반영합니다.

## 기술 검증
- 데스크톱과 모바일 Preview를 확인합니다.
- `bunx tsc --noEmit`, `bunx vitest run`, `bun run build`를 실행합니다.
- 변경 파일이 허용된 표현 계층 5개뿐인지 확인합니다.
