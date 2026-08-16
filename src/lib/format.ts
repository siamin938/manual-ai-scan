export const SEOUL_TZ = "Asia/Seoul";

export function formatSeoul(value?: string | null, withTime = true): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: SEOUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(d);
}

/** datetime-local 값(Asia/Seoul 기준)을 ISO 문자열로 변환 */
export function seoulLocalToIso(local: string): string {
  if (!local) return new Date().toISOString();
  // 입력값을 KST(+09:00)로 해석
  return new Date(`${local}:00+09:00`).toISOString();
}

/** 현재 시각을 datetime-local 입력용 KST 문자열로 */
export function nowSeoulLocalInput(): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: SEOUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return parts.replace(" ", "T");
}

export const PLATFORM_LABELS: Record<string, string> = {
  chatgpt_ui: "ChatGPT (웹 UI)",
  gemini_app: "Gemini (앱)",
  perplexity_web: "Perplexity (웹)",
};

export const ROLE_LABELS: Record<string, string> = {
  owner: "소유자",
  admin: "관리자",
  analyst: "분석가",
  client_viewer: "고객 뷰어",
};

export const DATA_CLASS_LABELS: Record<string, string> = {
  public: "공개(public)",
  restricted: "제한(restricted)",
  confidential: "기밀(confidential)",
};

export const MANUAL_DISCLAIMER =
  "특정 시점과 조건에서 사람이 직접 확인한 결과이며 로그인 상태, 개인화, 모델, 위치, 시점에 따라 결과가 달라질 수 있습니다.";
