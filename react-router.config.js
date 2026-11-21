// React Router rejects form posts (actions) whose Origin header doesn't match the URL the server sees
// ("Error: Bad Request" from singleFetchAction). Behind `shopify app dev` the browser posts from the tunnel
// (e.g. https://your-name.ngrok-free.app) but the CLI proxy forwards to localhost, so allow the app's public URL.
const appHosts = [process.env.SHOPIFY_APP_URL, process.env.HOST]
  .filter(Boolean)
  .map((u) => {
    try {
      return new URL(u.includes("://") ? u : `https://${u}`).host;
    } catch {
      return null;
    }
  })
  .filter((h) => h && !h.startsWith("localhost"));

/** @type {import("@react-router/dev/config").Config} */
export default {
  ssr: true,
  // Route middleware (used for request logging, see app/root.jsx).
  future: { v8_middleware: true },
  allowedActionOrigins: [...new Set(appHosts)],
};
