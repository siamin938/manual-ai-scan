import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "./integrations/supabase/auth-attacher";

/**
 * 인증/입력 오류를 고정된 HTTP 응답으로 정규화하는 커스텀 레이어.
 *
 * generated 파일(src/integrations/supabase/auth-middleware.ts)은 수정하지 않는다.
 * 그 파일은 인증 실패 시 "Unauthorized: ..." 메시지를 가진 일반 Error를 던지는데,
 * 여기서 판별해 401 + 고정 body("Unauthorized")로 바꾼다.
 * 세부 실패 사유(token/JWT/claims/Supabase error/API key/secret/환경변수 값)는
 * 절대 클라이언트로 나가지 않는다. generated 파일이 재생성돼도 이 로직은 남는다.
 */
function isAuthFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    typeof error.message === "string" &&
    error.message.startsWith("Unauthorized")
  );
}

/**
 * inputValidator가 던지는 고정 코드만 400으로 정규화한다.
 * 정확히 이 두 코드만 대상이며, 다른 Error는 절대 400이 되지 않는다.
 */
const BAD_REQUEST_CODES = new Set(["INVALID_ORG", "INVALID_ACTION", "INVALID_EXPERIMENT"]);

/** 정확히 이 코드만 403. 넓은 prefix 매칭은 하지 않는다. */
const FORBIDDEN_CODE = "FORBIDDEN";

function badRequestCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  return BAD_REQUEST_CODES.has(error.message) ? error.message : null;
}

/**
 * 서버 함수 오류 정규화. 모든 서버 함수 호출을 감싸므로
 * generated auth middleware가 던지는 오류도 여기서 잡힌다.
 * 상세 사유는 서버 로그에만 남기고, 클라이언트에는 고정 문자열만 던진다.
 */
const normalizeServerFnErrors = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    try {
      return await next();
    } catch (error) {
      if (isAuthFailure(error)) {
        console.error("[auth] request rejected:", (error as Error).message);
        setResponseStatus(401);
        throw fixedError(401, "Unauthorized");
      }

      if (error instanceof Error && error.message === FORBIDDEN_CODE) {
        setResponseStatus(403);
        throw fixedError(403, "FORBIDDEN");
      }

      const code = badRequestCode(error);
      if (code) {
        setResponseStatus(400);
        throw fixedError(400, code);
      }

      if (error != null && typeof error === "object" && "statusCode" in error) {
        throw error;
      }

      // 환경변수 누락 등: 상세 내용은 서버 로그에만, 클라이언트는 일반 500.
      console.error(error);
      setResponseStatus(500);
      throw fixedError(500, "Internal Server Error");
    }
  },
);

function fixedError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }

    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware],
  functionMiddleware: [normalizeServerFnErrors, attachSupabaseAuth],
}));
