import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

const CHABOIM_FAVICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+CjxkZWZzPgogIDxsaW5lYXJHcmFkaWVudCBpZD0iYmciIHgxPSI4IiB5MT0iNCIgeDI9IjU2IiB5Mj0iNjAiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgIDxzdG9wIHN0b3AtY29sb3I9IiMxNzY0QzkiLz4KICAgIDxzdG9wIG9mZnNldD0iLjQ4IiBzdG9wLWNvbG9yPSIjMEEzNTZGIi8+CiAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMwNDE2MkQiLz4KICA8L2xpbmVhckdyYWRpZW50PgogIDxsaW5lYXJHcmFkaWVudCBpZD0iYmFyIiB4MT0iMzIiIHkxPSIyMiIgeDI9IjUyIiB5Mj0iNDgiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgIDxzdG9wIHN0b3AtY29sb3I9IiMyN0Q3RjQiLz4KICAgIDxzdG9wIG9mZnNldD0iLjU1IiBzdG9wLWNvbG9yPSIjMUI5Q0Y2Ii8+CiAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxOTUzRjMiLz4KICA8L2xpbmVhckdyYWRpZW50Pgo8L2RlZnM+CjxyZWN0IHg9IjIiIHk9IjIiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcng9IjE0IiBmaWxsPSJ1cmwoI2JnKSIvPgo8cGF0aCBkPSJNNDMgMTZhMjAgMjAgMCAxIDAgMCAzMiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRjhGQkZGIiBzdHJva2Utd2lkdGg9IjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8cmVjdCB4PSIzMSIgeT0iMzciIHdpZHRoPSI2IiBoZWlnaHQ9IjEwIiByeD0iMS41IiBmaWxsPSJ1cmwoI2JhcikiLz4KPHJlY3QgeD0iMzkiIHk9IjMxIiB3aWR0aD0iNiIgaGVpZ2h0PSIxNiIgcng9IjEuNSIgZmlsbD0idXJsKCNiYXIpIi8+CjxyZWN0IHg9IjQ3IiB5PSIyNCIgd2lkdGg9IjYiIGhlaWdodD0iMjMiIHJ4PSIxLjUiIGZpbGw9InVybCgjYmFyKSIvPgo8L3N2Zz4=";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "차보임 CHABOIM | 자동차 업체 AI 추천시장 분석" },
      { name: "description", content: "실제 고객 질문을 반복 측정해 자동차 업체의 AI 노출, 경쟁업체, 실제 인용 출처를 분석합니다." },
      { name: "author", content: "차보임 CHABOIM" },
      { name: "theme-color", content: "#071b36" },
      { property: "og:title", content: "차보임 CHABOIM" },
      { property: "og:description", content: "자동차 업체 AI 추천시장 분석" },

      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },

    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: CHABOIM_FAVICON, type: "image/svg+xml" },
      { rel: "shortcut icon", href: CHABOIM_FAVICON, type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
