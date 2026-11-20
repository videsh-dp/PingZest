import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { getWidgetConfig, saveWidgetConfig } from "../models/widgets.server";
import { listDiscounts } from "../models/discounts.server";
import { defaultConfig, TRANSLATABLE, getPath } from "../lib/widget-config.js";
import { translateTexts, translationEnabled } from "../lib/translate.js";
import { getShopLocales } from "../models/shopify-admin.server";
import { describeDiscount } from "../lib/discounts.js";
import { previewHtml, PREVIEW_PAGES } from "../lib/preview.js";
import { formatPhone } from "../lib/phone.js";
import { useT } from "../i18n/react.jsx";
import { N_, LOCALES } from "../i18n/core.js";
import { Page, Banner } from "../components/ui";
import { Section, Row, Text, NumberField, Toggle, Choice, ColorField, PageRules, Agents } from "../components/fields";
import widgetJs from "../../extensions/wa-widgets/assets/wa-widget.js?raw";
import widgetCss from "../../extensions/wa-widgets/assets/wa-widget.css?raw";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const [{ config, syncedAt, syncError }, settings, discounts, shopLocales] = await Promise.all([
    getWidgetConfig(shop), getSettings(shop), listDiscounts(shop), getShopLocales(admin),
  ]);
  // First visit: start with the store's own WhatsApp number as the agent.
  if (!syncedAt && settings.whatsappNumber && !config.chat.agents.some((a) => a.phone)) {
    config.chat.agents = [{ name: "Support", phone: formatPhone(settings.whatsappNumber) }];
  }
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const editor = `https://${shop}/admin/themes/current/editor`;
  return {
    config, syncedAt, syncError,
    // Store languages other than the main one; if Shopify can't tell us, offer the app's languages.
    languages: shopLocales
      ? shopLocales.filter((l) => !l.primary).map((l) => ({ code: l.locale, name: l.name, published: l.published }))
      : Object.entries(LOCALES).filter(([k]) => k !== "en").map(([code, l]) => ({ code, name: l.native, published: true })),
    knownLanguages: Boolean(shopLocales),
    mainLanguage: shopLocales?.find((l) => l.primary)?.locale || "en",
    canTranslate: translationEnabled(),
    storeName: settings.storeName || "Your Store",
    discounts: discounts.filter((d) => d.active).map((d) => ({ code: d.code, label: `${d.code} · ${describeDiscount(d)}` })),
    links: {
      embed: `${editor}?context=apps&activateAppId=${apiKey}/app-embed`,
      product: `${editor}?template=product&addAppBlockId=${apiKey}/product-button&target=mainSection`,
      cart: `${editor}?template=cart&addAppBlockId=${apiKey}/cart-order&target=mainSection`,
      share: `${editor}?template=product&addAppBlockId=${apiKey}/share-button&target=mainSection`,
    },
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "translate") {
    // Draft translations for the empty fields of one language; the merchant reviews, then saves.
    let texts = {};
    try { texts = JSON.parse(String(form.get("texts") || "{}")); } catch { /* empty */ }
    const paths = Object.keys(texts).filter((p) => p in TRANSLATABLE && texts[p]);
    try {
      const out = await translateTexts(paths.map((p) => texts[p]), String(form.get("locale")), String(form.get("source") || "") || undefined);
      return { translated: Object.fromEntries(paths.map((p, i) => [p, out[i].slice(0, TRANSLATABLE[p])])), locale: String(form.get("locale")) };
    } catch (e) {
      return { translateError: e.message };
    }
  }
  let input = null;
  try { input = JSON.parse(String(form.get("config"))); } catch { return { error: "Invalid settings" }; }
  return saveWidgetConfig(session.shop, admin, input);
};

/** Immutable set by dotted path: set(obj, "chat.style.bg", "#000") */
function setPath(obj, path, value) {
  const [k, ...rest] = path.split(".");
  return { ...obj, [k]: rest.length ? setPath(obj[k] || {}, rest.join("."), value) : value };
}

const TABS = [["chat", N_("Chat button")], ["discount", N_("Discount banner")], ["buttons", N_("Page buttons")], ["languages", N_("Languages")], ["general", N_("General")]];

/** Field labels for the Languages tab (same names as in the other tabs). */
const TEXT_LABELS = {
  "chat.style.label": N_("Button text"),
  "chat.tooltip.text": N_("Tooltip text"),
  "chat.popup.title": N_("Popup title"),
  "chat.popup.text": N_("Popup text"),
  "chat.offlineText": N_("Message when closed"),
  "chat.greeting": N_("Pre-filled message"),
  "chat.productGreeting": N_("Pre-filled message on product pages"),
  "discount.headline": N_("Headline"),
  "discount.subtext": N_("Small text"),
  "discount.applyLabel": N_("Apply button"),
  "discount.copyLabel": N_("Copy button"),
};

function LanguagesTab({ config, setConfig, languages, knownLanguages, canTranslate, mainLang, onPreviewLang }) {
  const tr = useT();
  const fetcher = useFetcher({ key: "widget-translate" });
  const [lang, setLang] = useState(languages[0]?.code || "");
  useEffect(() => { onPreviewLang(lang || mainLang); return () => onPreviewLang(mainLang); }, [lang, mainLang, onPreviewLang]);
  const texts = config.translations?.[lang] || {};
  const setText = (path, value) => setConfig((c) => {
    const all = { ...(c.translations || {}) };
    const t = { ...(all[lang] || {}), [path]: value };
    if (!value) delete t[path];
    if (Object.keys(t).length) all[lang] = t; else delete all[lang];
    return { ...c, translations: all };
  });

  // Merge drafted translations into empty fields only, so nothing the merchant typed is lost.
  useEffect(() => {
    const r = fetcher.data;
    if (fetcher.state !== "idle" || !r?.translated || !r.locale) return;
    setConfig((c) => {
      const all = { ...(c.translations || {}) };
      const t = { ...(all[r.locale] || {}) };
      for (const [p, v] of Object.entries(r.translated)) if (!t[p] && v) t[p] = v;
      all[r.locale] = t;
      return { ...c, translations: all };
    });
  }, [fetcher.state, fetcher.data, setConfig]);

  const autoTranslate = () => {
    const todo = Object.fromEntries(Object.keys(TRANSLATABLE).filter((p) => !texts[p] && getPath(config, p)).map((p) => [p, getPath(config, p)]));
    fetcher.submit({ intent: "translate", locale: lang, texts: JSON.stringify(todo) }, { method: "post" });
  };

  if (!languages.length) {
    return (
      <Section title={tr("Languages")}>
        <p className="wa-muted">{tr("Your store has one language. Add more in Shopify Settings → Languages, then translate your widget texts here.")}</p>
        <p className="wa-muted">{tr("Built-in labels like “Online” and “Copied!”, and any texts you haven't changed, already follow the shopper's language.")}</p>
      </Section>
    );
  }
  return (
    <>
      <p className="wa-muted">{tr("Shoppers see these texts when they browse your store in this language. Leave a field empty to use your main text.")}</p>
      {!knownLanguages && <Banner tone="warning">{tr("Couldn't read your store languages. Showing all app languages instead.")}</Banner>}
      <Section title={tr("Language")}>
        <select className="wa-input" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={tr("Language")}>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>{l.name}{l.published ? "" : ` (${tr("not published")})`}{config.translations?.[l.code] ? " ✓" : ""}</option>
          ))}
        </select>
        {canTranslate ? (
          <div className="wa-row-gap">
            <button type="button" className="wa-button wa-button--secondary" disabled={fetcher.state !== "idle"} onClick={autoTranslate}>
              {fetcher.state !== "idle" ? tr("Translating…") : tr("Auto-translate empty fields")}
            </button>
            <span className="wa-muted wa-small">{tr("Google Translate drafts it; check before you save.")}</span>
          </div>
        ) : (
          <p className="wa-muted wa-small">{tr("Tip: set GOOGLE_TRANSLATE_API_KEY on your server to draft these automatically.")}</p>
        )}
        {fetcher.data?.translateError && <p className="wa-error">{fetcher.data.translateError}</p>}
      </Section>
      <Section title={tr("Texts")}>
        {Object.entries(TEXT_LABELS).map(([path, label]) => (
          <Text key={path} label={tr(label)} value={texts[path] || ""} onChange={(v) => setText(path, v)}
            placeholder={getPath(config, path) || ""} maxLength={TRANSLATABLE[path]} multiline={TRANSLATABLE[path] > 100} />
        ))}
      </Section>
    </>
  );
}

export default function Widgets() {
  const tr = useT();
  const data = useLoaderData();
  const fetcher = useFetcher();
  const [config, setConfig] = useState(data.config);
  const [saved, setSaved] = useState(JSON.stringify(data.config));
  const [tab, setTab] = useState("chat");
  const [device, setDevice] = useState("desktop");
  const [pageType, setPageType] = useState("product");
  const [srcDoc, setSrcDoc] = useState("");
  const [previewLang, setPreviewLang] = useState(data.mainLanguage);
  // Desktop preview renders at a real desktop width (1280px) and is scaled to fit the column.
  const frameBox = useRef(null);
  const [scale, setScale] = useState(0.45);
  useEffect(() => {
    const el = frameBox.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / 1280)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dirty = JSON.stringify(config) !== saved;
  const set = (path) => (value) => setConfig((c) => setPath(c, path, value));
  const c = config.chat, d = config.discount, b = config.buttons;

  // Rebuild the preview shortly after edits stop
  useEffect(() => {
    const t = setTimeout(() => setSrcDoc(previewHtml({ config, pageType, storeName: data.storeName, css: widgetCss, js: widgetJs, locale: previewLang })), 250);
    return () => clearTimeout(t);
  }, [config, pageType, data.storeName, previewLang]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.config) {
      setConfig(fetcher.data.config);
      setSaved(JSON.stringify(fetcher.data.config));
    }
  }, [fetcher.state, fetcher.data]);

  const save = () => fetcher.submit({ config: JSON.stringify(config) }, { method: "post" });
  const result = fetcher.state === "idle" ? fetcher.data : null;
  const noNumber = !c.agents.some((a) => a.phone.replace(/\D/g, "").length >= 8);
  const discountMissing = d.enabled && !d.code;

  const status = useMemo(() => {
    if (fetcher.state !== "idle") return tr("Saving…");
    if (dirty) return tr("Unsaved changes");
    if (result?.error || data.syncError) return null;
    return tr("All changes are live on your store");
  }, [fetcher.state, dirty, result, data.syncError, tr]);

  return (
    <Page
      title={tr("Widgets")}
      subtitle={tr("Design your WhatsApp widgets and choose which store pages show them. The preview is your real widget.")}
      actions={
        <div className="wa-row-gap">
          {status && <span className="wa-muted">{status}</span>}
          <button type="button" className="wa-button wa-button--secondary" disabled={!dirty} onClick={() => setConfig(JSON.parse(saved))}>{tr("Discard")}</button>
          <button type="button" className="wa-button wa-button--primary" disabled={!dirty || fetcher.state !== "idle"} onClick={save}>{tr("Save")}</button>
        </div>
      }
    >
      {(result?.error || (!dirty && data.syncError)) && (
        <Banner tone="critical">{tr("Saved in the app, but your store didn't update: {error}. Try saving again.", { error: result?.error || data.syncError })}</Banner>
      )}
      <Banner tone="info">
        {tr("Widgets appear once the app embed is on.")} <a href={data.links.embed} target="_top">{tr("Turn on WA Assist in your theme")}</a> {tr("(one time)")}
      </Banner>

      <div className="wa-editor-layout">
        <div className="wa-editor-panel">
          <nav className="wa-tabs wa-tabs--editor">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className={`wa-tab ${tab === id ? "is-active" : ""}`} onClick={() => setTab(id)}>{tr(label)}</button>
            ))}
          </nav>

          {tab === "chat" && (
            <>
              <Toggle label={tr("Show the chat button")} checked={c.enabled} onChange={set("chat.enabled")} />
              <Section title={tr("WhatsApp numbers")}>
                <Agents value={c.agents} onChange={set("chat.agents")} />
                {noNumber && <p className="wa-warn">{tr("Add at least one WhatsApp number, or the button stays hidden.")}</p>}
              </Section>
              <Section title={tr("Look")}>
                <Choice label={tr("Shape")} value={c.style.shape} onChange={set("chat.style.shape")} options={[["pill", tr("Pill with text")], ["circle", tr("Circle")], ["rounded", tr("Rounded square")]]} />
                <Choice label={tr("Size")} value={c.style.size} onChange={set("chat.style.size")} options={[["sm", tr("Small")], ["md", tr("Medium")], ["lg", tr("Large")]]} />
                <Choice label={tr("Icon")} value={c.style.icon} onChange={set("chat.style.icon")} options={[["bubble", tr("Chat")], ["phone", tr("Phone")], ["send", tr("Send")]]} />
                {c.style.shape !== "circle" && <Text label={tr("Button text")} value={c.style.label} onChange={set("chat.style.label")} maxLength={40} help={tr("Leave empty for an icon-only button.")} />}
                <Row>
                  <ColorField label={tr("Button colour")} value={c.style.bg} onChange={set("chat.style.bg")} />
                  <ColorField label={tr("Icon and text colour")} value={c.style.fg} onChange={set("chat.style.fg")} />
                </Row>
                <Toggle label={tr("Pulse animation")} checked={c.style.pulse} onChange={set("chat.style.pulse")} help={tr("A soft ring that draws the eye. Turned off for shoppers who prefer reduced motion.")} />
              </Section>
              <Section title={tr("Placement")}>
                <div className="wa-device-cols">
                  <div>
                    <Toggle label={tr("Show on desktop")} checked={c.desktop.show} onChange={set("chat.desktop.show")} />
                    <Choice value={c.desktop.position} onChange={set("chat.desktop.position")} options={[["bottom-left", tr("↙ Left")], ["bottom-right", tr("Right ↘")]]} />
                    <NumberField label={tr("From the side")} value={c.desktop.offsetX} onChange={set("chat.desktop.offsetX")} max={200} unit="px" />
                    <NumberField label={tr("From the bottom")} value={c.desktop.offsetY} onChange={set("chat.desktop.offsetY")} max={300} unit="px" />
                  </div>
                  <div>
                    <Toggle label={tr("Show on mobile")} checked={c.mobile.show} onChange={set("chat.mobile.show")} />
                    <Choice value={c.mobile.position} onChange={set("chat.mobile.position")} options={[["bottom-left", tr("↙ Left")], ["bottom-right", tr("Right ↘")]]} />
                    <NumberField label={tr("From the side")} value={c.mobile.offsetX} onChange={set("chat.mobile.offsetX")} max={100} unit="px" />
                    <NumberField label={tr("From the bottom")} value={c.mobile.offsetY} onChange={set("chat.mobile.offsetY")} max={300} unit="px" help={tr("Raise it if it covers your theme's sticky Add to cart bar.")} />
                    <Toggle label={tr("Icon only on mobile")} checked={c.mobile.iconOnly} onChange={set("chat.mobile.iconOnly")} />
                  </div>
                </div>
              </Section>
              <Section title={tr("Popup and messages")}>
                <Toggle label={tr("Show a popup with your agents first")} checked={c.popup.enabled} onChange={set("chat.popup.enabled")} help={tr("When off, the button opens WhatsApp straight away.")} />
                {c.popup.enabled && (
                  <>
                    <Row>
                      <Text label={tr("Popup title")} value={c.popup.title} onChange={set("chat.popup.title")} maxLength={60} />
                      <ColorField label={tr("Popup header colour")} value={c.style.headerBg} onChange={set("chat.style.headerBg")} />
                    </Row>
                    <Text label={tr("Popup text")} value={c.popup.text} onChange={set("chat.popup.text")} maxLength={160} />
                  </>
                )}
                <Text label={tr("Pre-filled message")} value={c.greeting} onChange={set("chat.greeting")} multiline maxLength={500} />
                <Text label={tr("Pre-filled message on product pages")} value={c.productGreeting} onChange={set("chat.productGreeting")} multiline maxLength={500} help={tr("Use {product} and {url}.")} />
                <Toggle label={tr("“Need help?” tooltip")} checked={c.tooltip.enabled} onChange={set("chat.tooltip.enabled")} help={tr("Shown once per visit.")} />
                {c.tooltip.enabled && (
                  <Row>
                    <Text label={tr("Tooltip text")} value={c.tooltip.text} onChange={set("chat.tooltip.text")} maxLength={80} />
                    <NumberField label={tr("Show after")} value={c.tooltip.delaySec} onChange={set("chat.tooltip.delaySec")} max={60} unit="sec" />
                  </Row>
                )}
              </Section>
              <Section title={tr("Business hours")}>
                <Toggle label={tr("Show agents as offline outside business hours")} checked={c.hours.enabled} onChange={set("chat.hours.enabled")} />
                {c.hours.enabled && (
                  <>
                    <Row>
                      <NumberField label={tr("Opens at (hour)")} value={c.hours.open} onChange={set("chat.hours.open")} max={23} />
                      <NumberField label={tr("Closes at (hour)")} value={c.hours.close} onChange={set("chat.hours.close")} min={1} max={24} />
                    </Row>
                    <Choice label={tr("Open on")} value={c.hours.days} onChange={set("chat.hours.days")} options={[["all", tr("Every day")], ["mon_sat", tr("Mon–Sat")], ["mon_fri", tr("Mon–Fri")]]} />
                    <Text label={tr("Message when closed")} value={c.offlineText} onChange={set("chat.offlineText")} maxLength={200} />
                    <Toggle label={tr("Still allow chats when closed")} checked={c.allowOffline} onChange={set("chat.allowOffline")} />
                  </>
                )}
              </Section>
              <Section title={tr("Show on these pages")}>
                <PageRules value={c.pages} onChange={set("chat.pages")} />
              </Section>
            </>
          )}

          {tab === "discount" && (
            <>
              <Toggle label={tr("Show the discount banner")} checked={d.enabled} onChange={set("discount.enabled")} />
              <Section title={tr("Discount code")} aside={<Link to="/app/discounts">{tr("Create a code")}</Link>}>
                {data.discounts.length > 0 && (
                  <Choice value={data.discounts.some((x) => x.code === d.code) ? d.code : ""} onChange={set("discount.code")}
                    options={data.discounts.map((x) => [x.code, x.label])} />
                )}
                <Text label={data.discounts.length ? tr("…or type any code from your Shopify discounts") : tr("Code from your Shopify discounts")}
                  value={d.code} onChange={(v) => set("discount.code")(v.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} maxLength={40} placeholder={tr("WELCOME10")} />
                {discountMissing && <p className="wa-warn">{tr("Pick or type a code, or the banner stays hidden.")}</p>}
              </Section>
              <Section title={tr("Text")}>
                <Text label={tr("Headline")} value={d.headline} onChange={set("discount.headline")} maxLength={80} />
                <Text label={tr("Small text")} value={d.subtext} onChange={set("discount.subtext")} maxLength={140} help={tr("{code} shows the code as a highlighted tag.")} />
                <Row>
                  <Text label={tr("Apply button")} value={d.applyLabel} onChange={set("discount.applyLabel")} maxLength={30} />
                  <Text label={tr("Copy button")} value={d.copyLabel} onChange={set("discount.copyLabel")} maxLength={30} />
                </Row>
                <p className="wa-muted">{tr("“Apply” adds the code to the shopper's cart automatically (Shopify's discount link), then brings them back to the same page.")}</p>
              </Section>
              <Section title={tr("Design")}>
                <Choice label={tr("Layout")} value={d.layout} onChange={set("discount.layout")} options={[["bar-top", tr("Top bar")], ["bar-bottom", tr("Bottom bar")], ["card", tr("Floating card")], ["popup", tr("Popup")]]} />
                <Row>
                  <ColorField label={tr("Background")} value={d.style.bg} onChange={set("discount.style.bg")} />
                  <ColorField label={tr("Text")} value={d.style.fg} onChange={set("discount.style.fg")} />
                </Row>
                <ColorField label={tr("Accent (code + Apply button)")} value={d.style.accent} onChange={set("discount.style.accent")} />
                <Choice label={tr("Shape")} value={d.style.shape} onChange={set("discount.style.shape")} options={[["square", tr("Square")], ["rounded", tr("Rounded")], ["pill", tr("Pill")]]} />
                <Choice label={tr("Size")} value={d.style.size} onChange={set("discount.style.size")} options={[["sm", tr("Compact")], ["md", tr("Regular")], ["lg", tr("Large")]]} />
              </Section>
              <Section title={tr("Behaviour")}>
                <NumberField label={tr("Show after")} value={d.showAfterSec} onChange={set("discount.showAfterSec")} max={60} unit="sec" help={tr("0 shows it immediately. A short delay works well for popups.")} />
                <Toggle label={tr("Shoppers can close it")} checked={d.dismissible} onChange={set("discount.dismissible")} />
                {d.dismissible && <NumberField label={tr("Keep it hidden after closing for")} value={d.dismissDays} onChange={set("discount.dismissDays")} max={90} unit="days" />}
                <Row>
                  <Toggle label={tr("Show on desktop")} checked={d.desktop.show} onChange={set("discount.desktop.show")} />
                  <Toggle label={tr("Show on mobile")} checked={d.mobile.show} onChange={set("discount.mobile.show")} />
                </Row>
              </Section>
              <Section title={tr("Show on these pages")}>
                <PageRules value={d.pages} onChange={set("discount.pages")} />
              </Section>
            </>
          )}

          {tab === "buttons" && (
            <>
              <p className="wa-muted">{tr("These buttons sit inside your pages. Add them once from the theme editor; their look and pages are set here.")}</p>
              <Section title={tr("Look (all page buttons)")}>
                <Choice label={tr("Style")} value={b.style} onChange={set("buttons.style")} options={[["solid", tr("Filled")], ["outline", tr("Outline")]]} />
                <Choice label={tr("Shape")} value={b.shape} onChange={set("buttons.shape")} options={[["square", tr("Square")], ["rounded", tr("Rounded")], ["pill", tr("Pill")]]} />
                <Choice label={tr("Size")} value={b.size} onChange={set("buttons.size")} options={[["sm", tr("Small")], ["md", tr("Medium")], ["lg", tr("Large")]]} />
                <Row>
                  <ColorField label={tr("Colour")} value={b.bg} onChange={set("buttons.bg")} />
                  <ColorField label={tr("Text on filled buttons")} value={b.fg} onChange={set("buttons.fg")} />
                </Row>
              </Section>
              {[
                ["product", "“Ask on WhatsApp” button", data.links.product],
                ["share", "“Share on WhatsApp” button", data.links.share],
                ["cart", "“Order on WhatsApp” button", data.links.cart],
              ].map(([key, title, href]) => (
                <Section key={key} title={title} aside={<a href={href} target="_top">{tr("Add to theme")}</a>}>
                  <PageRules value={b[key].pages} onChange={set(`buttons.${key}.pages`)} />
                </Section>
              ))}
            </>
          )}

          {tab === "languages" && (
            <LanguagesTab config={config} setConfig={setConfig} languages={data.languages} knownLanguages={data.knownLanguages}
              canTranslate={data.canTranslate} mainLang={data.mainLanguage} onPreviewLang={setPreviewLang} />
          )}

          {tab === "general" && (
            <Section title={tr("Analytics")}>
              <Toggle label={tr("Count widget views and clicks")} checked={config.tracking} onChange={set("tracking")}
                help={tr("Stores daily totals only: no cookies, IP addresses or shopper details. Powers the Analytics page.")} />
              <button type="button" className="wa-link" onClick={() => setConfig(defaultConfig())}>{tr("Reset all widgets to default design")}</button>
            </Section>
          )}
        </div>

        <div className="wa-preview-col">
          <div className="wa-preview-bar">
            <div className="wa-seg" role="group" aria-label={tr("Device")}>
              <button type="button" className={device === "desktop" ? "is-active" : ""} onClick={() => setDevice("desktop")}>{tr("Desktop")}</button>
              <button type="button" className={device === "mobile" ? "is-active" : ""} onClick={() => setDevice("mobile")}>{tr("Mobile")}</button>
            </div>
            <select className="wa-input wa-input--inline" value={pageType} onChange={(e) => setPageType(e.target.value)} aria-label={tr("Preview page")}>
              {Object.entries(PREVIEW_PAGES).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}
            </select>
          </div>
          <div ref={frameBox} className={`wa-device wa-device--${device}`} style={device === "desktop" ? { height: Math.round(800 * scale) } : undefined}>
            <iframe
              title={tr("Widget preview")}
              className="wa-preview-frame"
              sandbox="allow-scripts"
              srcDoc={srcDoc}
              style={device === "desktop" ? { width: 1280, height: 800, transform: `scale(${scale})`, transformOrigin: "0 0" } : undefined}
            />
          </div>
          <p className="wa-muted wa-center">{tr("Try it: click the widgets. Switch pages to check your page rules.")}</p>
        </div>
      </div>
    </Page>
  );
}
