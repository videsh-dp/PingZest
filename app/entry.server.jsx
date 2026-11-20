import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import { captureException } from "./posthog.server";
import { shopFromRequest, cleanPath } from "./lib/telemetry.js";

/**
 * Every error thrown in a loader, action or while rendering goes to PostHog error tracking.
 * Aborted requests (the user navigated away) are skipped.
 */
export function handleError(error, { request }) {
  if (request?.signal?.aborted) return;
  if (error instanceof Response) return; // redirects / auth bounces, not errors
  console.error(error);
  captureException(error, shopFromRequest(request), {
    source: "react-router",
    method: request.method,
    path: cleanPath(new URL(request.url).pathname),
    handled: false,
  });
}

export const streamTimeout = 5000;

export default async function handleRequest(request, responseStatusCode, responseHeaders, reactRouterContext) {
  // Public confirm pages are not embedded in Shopify admin; everything else gets Shopify's headers.
  if (!new URL(request.url).pathname.startsWith("/c/")) {
    addDocumentResponseHeaders(request, responseHeaders);
  }
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          handleError(error, { request });
        },
      },
    );
    setTimeout(abort, streamTimeout + 1000);
  });
}
