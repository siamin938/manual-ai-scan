# GitHub 브랜치(codex/v2-main-integration) Preview 지원 여부 — 조사 결과 (수정 없음)

## 결론

**지원됩니다.** Lovable의 GitHub Git sync는 에디터에서 **브랜치 전환(branch switching)** 을 지원하며, 활성 브랜치를 바꾸면 Preview가 해당 브랜치 코드를 반영합니다. main에 머지하지 않아도 되고, publish/deploy와는 무관합니다(published 사이트는 main 기준 배포에 그대로 유지됨).

출처: https://docs.lovable.dev/integrations/github

## 지원되는 정확한 절차 (유일한 공식 방법)

1. Lovable 프로젝트에서 **Plus(+) 메뉴 → GitHub → Git settings** (또는 프로젝트의 GitHub 설정 페이지)를 엽니다.
2. 브랜치 전환 UI에서 활성 브랜치를 `main` → **`codex/v2-main-integration`** 으로 바꿉니다.
3. Lovable이 해당 브랜치와 양방향 동기화를 시작하면, **Preview(로컬 미리보기)가 그 브랜치의 코드를 기준으로 실행**됩니다.
4. 검토가 끝나면 같은 화면에서 활성 브랜치를 다시 `main`으로 전환합니다.

## 확인된 제약 (이 프로젝트 설정 기준)

- **브랜치 tip만 미리볼 수 있습니다.** `codex/v2-main-integration`의 최신 커밋이 `e68087c`라면 그대로 보이지만, 브랜치가 더 진행됐다면 tip이 보입니다. **특정 커밋을 고정(pin)해서 Preview하는 기능은 없습니다.**
- **브랜치 전환은 활성 작업 브랜치를 바꾸는 동작입니다.** 전환 후 Lovable에서 에디팅을 하면 그 변경은 `main`이 아니라 `codex/v2-main-integration`에 커밋됩니다. 검토만 하려면 전환 후 아무것도 수정하지 않으면 됩니다.
- 로컬 클론 기준 확인: 현재 HEAD/main은 `4fbb2c9`로 사용자가 말한 값과 일치하며, `origin/codex/v2-main-integration` ref는 이 클론에 아직 fetch되어 있지 않습니다(원격 GitHub에는 존재). 브랜치가 보이지 않으면 GitHub에서 브랜치가 push되어 있는지 먼저 확인하세요.
- 머지는 Lovable이 아니라 **GitHub에서 PR로** 처리하는 것이 정상 경로입니다.

## 이번 작업에서 하지 않은 것

- 코드 수정, 커밋, publish, deploy 없음 (조사/판정만 수행)
