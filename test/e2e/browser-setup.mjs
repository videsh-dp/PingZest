/**
 * Browser setup shared by the browser e2e and the walkthrough: a context with a stand-in for Shopify's
 * App Bridge (session token on the app's requests, toast, save bar, theme embed status, and a drawn admin
 * title bar), WhatsApp links answered locally, App Bridge's script stubbed and everything else from
 * Shopify's CDN (Polaris web components) loaded for real.
 */
import { UA, sessionToken } from "./harness.mjs";

export async function newContext(browser, { mobile = false, viewport } = {}) {
  const context = await browser.newContext({
    userAgent: UA, // headless Chrome's own user agent counts as a bot for Shopify's library
    viewport: viewport || (mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }),
    deviceScaleFactor: 1,
  });
  await context.exposeFunction("__e2eToken", () => sessionToken({ ttl: 300 }));
  // Stand-in for App Bridge: shopify.idToken() and the session token on every same-origin request.
  await context.addInitScript(() => {
    window.shopify = {
      idToken: () => window.__e2eToken(),
      config: {}, environment: { embedded: true },
      toast: { show: (m) => { window.__toasts = [...(window.__toasts || []), m]; console.log(`[toast] ${m}`); } },
      loading: () => {},
      saveBar: { show(id) { window.__saveBar = { id, open: true }; }, hide(id) { window.__saveBar = { id, open: false }; } },
      modal: { show() {}, hide() {} },
      // The PingZest app embed is on in the live theme (what Shopify reports for a set-up store).
      app: { extensions: async () => [{ handle: "pingzest-widgets", type: "theme_app_extension", activations: [{ target: "body", handle: "app-embed", name: "PingZest", status: "active", activations: [] }] }] },
    };
    // Shopify's admin title bar: App Bridge shows the s-page heading, breadcrumb and header buttons above
    // the app (Polaris hides them inside the iframe). The stand-in draws the same bar at the top of the page;
    // its buttons click the app's own elements, like App Bridge does.
    const drawTitleBar = () => {
      // Only after React has hydrated: adding nodes earlier would make hydration fail.
      if (document.documentElement.dataset.hydrated !== "1") return;
      const pageEl = document.querySelector("s-page");
      let bar = document.getElementById("ab-titlebar");
      if (!pageEl) { bar?.remove(); return; }
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "ab-titlebar";
        bar.style.cssText = "position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:8px;padding:10px 16px;background:#ebebeb;border-bottom:1px solid #d4d4d4;font:600 14px -apple-system,Segoe UI,Roboto,sans-serif;color:#303030";
        document.body.prepend(bar);
      }
      const items = [...pageEl.querySelectorAll(':scope > [slot="breadcrumb-actions"], :scope > [slot="primary-action"], :scope > [slot="secondary-actions"]')];
      const key = pageEl.getAttribute("heading") + "|" + items.map((i) => i.slot + i.textContent + i.getAttribute("href")).join("|");
      if (bar.dataset.key === key) return;
      bar.dataset.key = key;
      bar.textContent = "";
      const proxy = (el, style) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = el.textContent.trim();
        b.dataset.proxy = el.slot;
        b.style.cssText = style;
        b.addEventListener("click", () => el.click());
        return b;
      };
      for (const el of items.filter((i) => i.slot === "breadcrumb-actions")) {
        const b = proxy(el, "border:0;background:none;color:#616161;font:inherit;cursor:pointer;padding:0");
        b.textContent = `${b.textContent} ›`;
        bar.append(b);
      }
      const h = document.createElement("span");
      h.textContent = pageEl.getAttribute("heading") || "";
      h.dataset.heading = "";
      h.style.cssText = "flex:1";
      bar.append(h);
      for (const el of items.filter((i) => i.slot === "secondary-actions")) bar.append(proxy(el, "border:1px solid #c9c9c9;background:#fff;border-radius:8px;padding:5px 10px;font:inherit;font-size:13px;cursor:pointer"));
      for (const el of items.filter((i) => i.slot === "primary-action")) bar.append(proxy(el, "border:0;background:#303030;color:#fff;border-radius:8px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer"));
    };
    new MutationObserver(() => drawTitleBar()).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["heading", "href", "data-hydrated"] });
    const original = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      if (url.origin === location.origin) {
        const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
        headers.set("Authorization", `Bearer ${await window.__e2eToken()}`);
        init = { ...init, headers };
      }
      return original(input, init);
    };
  });
  // WhatsApp links open in a new tab: answer them locally instead of going to wa.me.
  await context.route(/https:\/\/(wa\.me|api\.whatsapp\.com)\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>WhatsApp</title>" }));
  // App Bridge is replaced by the stand-in above; Polaris web components (polaris.js) load for real, so the
  // screenshots show real Polaris rendering.
  await context.route("https://cdn.shopify.com/**", (route) => {
    const u = route.request().url();
    if (/app-bridge\.js/.test(u)) return route.fulfill({ status: 200, contentType: "application/javascript", body: "/* App Bridge stubbed in e2e */" });
    return route.continue();
  });
  return context;
}
