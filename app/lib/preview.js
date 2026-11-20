/**
 * Builds the HTML for the live preview iframe in the Widgets editor.
 * It loads the real storefront script + CSS (passed in as strings), so the preview
 * is exactly what shoppers see. window.__WA_PREVIEW__ stops it opening WhatsApp,
 * saving dismissals or sending analytics.
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// JSON inside <script> must not be able to close the tag
const safeJson = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

const ICON = '<svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5C6.5 2.5 2 6.4 2 11.2c0 2.4 1.1 4.6 3 6.2L4.2 21a.6.6 0 0 0 .9.6l4-2.1c.9.2 1.9.4 2.9.4 5.5 0 10-3.9 10-8.7S17.5 2.5 12 2.5z"/></svg>';

const PAGES = {
  index: { path: "/", title: "Home", body: '<section class="pv-hero"><h1>New festive collection</h1><p>Handmade kurtas, sarees and more.</p><span class="pv-cta">Shop now</span></section><div class="pv-grid">' + '<div class="pv-card"></div>'.repeat(4) + "</div>" },
  product: {
    path: "/products/blue-cotton-kurta",
    title: "Blue Cotton Kurta",
    product: "Blue Cotton Kurta",
    body:
      '<div class="pv-product"><div class="pv-img"></div><div><h1>Blue Cotton Kurta</h1><p class="pv-price">₹1,299</p><span class="pv-atc">Add to cart</span>' +
      '<div class="wa-block" data-wa-block="product"><a href="#" class="wa-btn" data-wa-widget="product" data-phone="" data-message="Hi! I\'d like to know more about {product}: {url}" data-product="Blue Cotton Kurta">' + ICON + "<span>Ask about this product</span></a></div>" +
      '<div class="wa-block" data-wa-block="share"><a href="#" class="wa-btn" data-wa-widget="share" data-message="Look what I found: {product} {url}" data-product="Blue Cotton Kurta">' + ICON + "<span>Share on WhatsApp</span></a></div>" +
      "</div></div>",
  },
  collection: { path: "/collections/kurtas", title: "Kurtas", body: '<h1 class="pv-h">Kurtas</h1><div class="pv-grid">' + '<div class="pv-card"></div>'.repeat(8) + "</div>" },
  cart: {
    path: "/cart",
    title: "Your cart",
    body:
      '<div class="pv-cart"><h1 class="pv-h">Your cart</h1><div class="pv-line"><div class="pv-thumb"></div><div>Blue Cotton Kurta<br><small>M · Qty 2</small></div><b>₹2,598</b></div>' +
      '<div class="pv-total">Total <b>₹2,598</b></div><span class="pv-atc">Check out</span>' +
      '<div class="wa-block" data-wa-block="cart"><a href="#" class="wa-btn wa-btn--wide" data-wa-widget="cart" data-phone="" data-intro="Hi! I\'d like to order:" data-outro="Please confirm availability." data-empty="Hi!">' + ICON + "<span>Order on WhatsApp</span></a></div></div>",
  },
};
export const PREVIEW_PAGES = { index: "Home page", product: "Product page", collection: "Collection page", cart: "Cart page" }; // labels translated in the editor

export function previewHtml({ config, pageType = "product", storeName = "Your Store", css = "", js = "", locale = "en" }) {
  const p = PAGES[pageType] || PAGES.product;
  const pageCtx = { pageType, product: p.product || null, shop: "preview.myshopify.com", currency: "INR", root: "/", locale };
  const rtl = /^(ar|he|fa|ur)\b/i.test(locale);
  return `<!doctype html><html lang="${esc(locale)}"${rtl ? ' dir="rtl"' : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)}</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f7f7f5;color:#222;min-height:100vh}
.pv-head{display:flex;justify-content:space-between;align-items:center;background:#fff;padding:14px 22px;border-bottom:1px solid #eee;font-weight:700}
.pv-head span{font-weight:400;color:#888;font-size:13px}
main{max-width:980px;margin:0 auto;padding:22px}
.pv-hero{background:linear-gradient(135deg,#f3d9b1,#e7b77d);border-radius:14px;padding:44px 28px}.pv-hero h1{margin:0 0 6px}
.pv-cta,.pv-atc{display:inline-block;background:#222;color:#fff;padding:12px 20px;border-radius:8px;margin-top:12px}
.pv-atc{display:block;text-align:center}
.pv-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:18px}.pv-card{aspect-ratio:3/4;background:#e6e1d8;border-radius:10px}
.pv-product{display:grid;grid-template-columns:1fr 1fr;gap:28px}.pv-img{aspect-ratio:1;background:linear-gradient(135deg,#b8c9e8,#6d8fc9);border-radius:12px}
.pv-product h1{margin:0 0 6px;font-size:24px}.pv-price{font-size:20px;margin:0 0 6px}
.pv-h{font-size:22px;margin:0 0 14px}.pv-cart{max-width:520px}
.pv-line{display:flex;gap:12px;align-items:center;background:#fff;padding:12px;border-radius:10px}.pv-line div:nth-child(2){flex:1}
.pv-thumb{width:56px;height:56px;border-radius:8px;background:#b8c9e8}.pv-total{display:flex;justify-content:space-between;padding:14px 4px}
@media (max-width:749px){.pv-product{grid-template-columns:1fr}.pv-grid{grid-template-columns:repeat(2,1fr)}main{padding:16px}}
${css}
</style></head><body>
<header class="pv-head">${esc(storeName)}<span>Preview · ${esc(p.title)}</span></header>
<main>${p.body}</main>
<script type="application/json" data-pingzest-config>${safeJson(config)}</script>
<script type="application/json" data-pingzest-page>${safeJson(pageCtx)}</script>
<script>window.__WA_PREVIEW__=true;window.__WA_PREVIEW_PATH__=${safeJson(p.path)};</script>
<script>${js.replace(/<\/script/gi, "<\\/script")}</script>
</body></html>`;
}
