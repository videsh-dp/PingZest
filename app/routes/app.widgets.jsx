import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { getWidgetConfig, saveWidgetConfig } from "../models/widgets.server";
import { listDiscounts } from "../models/discounts.server";
import { defaultConfig } from "../lib/widget-config.js";
import { describeDiscount } from "../lib/discounts.js";
import { previewHtml, PREVIEW_PAGES } from "../lib/preview.js";
import { formatPhone } from "../lib/phone.js";
import { Page, Banner } from "../components/ui";
import { Section, Row, Text, NumberField, Toggle, Choice, ColorField, PageRules, Agents } from "../components/fields";
import widgetJs from "../../extensions/wa-widgets/assets/wa-widget.js?raw";
import widgetCss from "../../extensions/wa-widgets/assets/wa-widget.css?raw";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const [{ config, syncedAt, syncError }, settings, discounts] = await Promise.all([
    getWidgetConfig(shop), getSettings(shop), listDiscounts(shop),
  ]);
  // First visit: start with the store's own WhatsApp number as the agent.
  if (!syncedAt && settings.whatsappNumber && !config.chat.agents.some((a) => a.phone)) {
    config.chat.agents = [{ name: "Support", phone: formatPhone(settings.whatsappNumber) }];
  }
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const editor = `https://${shop}/admin/themes/current/editor`;
  return {
    config, syncedAt, syncError,
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
  let input = null;
  try { input = JSON.parse(String(form.get("config"))); } catch { return { error: "Invalid settings" }; }
  return saveWidgetConfig(session.shop, admin, input);
};

/** Immutable set by dotted path: set(obj, "chat.style.bg", "#000") */
function setPath(obj, path, value) {
  const [k, ...rest] = path.split(".");
  return { ...obj, [k]: rest.length ? setPath(obj[k] || {}, rest.join("."), value) : value };
}

const TABS = [["chat", "Chat button"], ["discount", "Discount banner"], ["buttons", "Page buttons"], ["general", "General"]];

export default function Widgets() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const [config, setConfig] = useState(data.config);
  const [saved, setSaved] = useState(JSON.stringify(data.config));
  const [tab, setTab] = useState("chat");
  const [device, setDevice] = useState("desktop");
  const [pageType, setPageType] = useState("product");
  const [srcDoc, setSrcDoc] = useState("");
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
    const t = setTimeout(() => setSrcDoc(previewHtml({ config, pageType, storeName: data.storeName, css: widgetCss, js: widgetJs })), 250);
    return () => clearTimeout(t);
  }, [config, pageType, data.storeName]);

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
    if (fetcher.state !== "idle") return "Saving…";
    if (dirty) return "Unsaved changes";
    if (result?.error || data.syncError) return null;
    return "All changes are live on your store";
  }, [fetcher.state, dirty, result, data.syncError]);

  return (
    <Page
      title="Widgets"
      subtitle="Design your WhatsApp widgets and choose which store pages show them. The preview is your real widget."
      actions={
        <div className="wa-row-gap">
          {status && <span className="wa-muted">{status}</span>}
          <button type="button" className="wa-button wa-button--secondary" disabled={!dirty} onClick={() => setConfig(JSON.parse(saved))}>Discard</button>
          <button type="button" className="wa-button wa-button--primary" disabled={!dirty || fetcher.state !== "idle"} onClick={save}>Save</button>
        </div>
      }
    >
      {(result?.error || (!dirty && data.syncError)) && (
        <Banner tone="critical">Saved in the app, but your store didn't update: {result?.error || data.syncError}. Try saving again.</Banner>
      )}
      <Banner tone="info">
        Widgets appear once the app embed is on. <a href={data.links.embed} target="_top">Turn on WA Assist in your theme</a> (one time).
      </Banner>

      <div className="wa-editor-layout">
        <div className="wa-editor-panel">
          <nav className="wa-tabs wa-tabs--editor">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className={`wa-tab ${tab === id ? "is-active" : ""}`} onClick={() => setTab(id)}>{label}</button>
            ))}
          </nav>

          {tab === "chat" && (
            <>
              <Toggle label="Show the chat button" checked={c.enabled} onChange={set("chat.enabled")} />
              <Section title="WhatsApp numbers">
                <Agents value={c.agents} onChange={set("chat.agents")} />
                {noNumber && <p className="wa-warn">Add at least one WhatsApp number, or the button stays hidden.</p>}
              </Section>
              <Section title="Look">
                <Choice label="Shape" value={c.style.shape} onChange={set("chat.style.shape")} options={[["pill", "Pill with text"], ["circle", "Circle"], ["rounded", "Rounded square"]]} />
                <Choice label="Size" value={c.style.size} onChange={set("chat.style.size")} options={[["sm", "Small"], ["md", "Medium"], ["lg", "Large"]]} />
                <Choice label="Icon" value={c.style.icon} onChange={set("chat.style.icon")} options={[["bubble", "Chat"], ["phone", "Phone"], ["send", "Send"]]} />
                {c.style.shape !== "circle" && <Text label="Button text" value={c.style.label} onChange={set("chat.style.label")} maxLength={40} help="Leave empty for an icon-only button." />}
                <Row>
                  <ColorField label="Button colour" value={c.style.bg} onChange={set("chat.style.bg")} />
                  <ColorField label="Icon and text colour" value={c.style.fg} onChange={set("chat.style.fg")} />
                </Row>
                <Toggle label="Pulse animation" checked={c.style.pulse} onChange={set("chat.style.pulse")} help="A soft ring that draws the eye. Turned off for shoppers who prefer reduced motion." />
              </Section>
              <Section title="Placement">
                <div className="wa-device-cols">
                  <div>
                    <Toggle label="Show on desktop" checked={c.desktop.show} onChange={set("chat.desktop.show")} />
                    <Choice value={c.desktop.position} onChange={set("chat.desktop.position")} options={[["bottom-left", "↙ Left"], ["bottom-right", "Right ↘"]]} />
                    <NumberField label="From the side" value={c.desktop.offsetX} onChange={set("chat.desktop.offsetX")} max={200} unit="px" />
                    <NumberField label="From the bottom" value={c.desktop.offsetY} onChange={set("chat.desktop.offsetY")} max={300} unit="px" />
                  </div>
                  <div>
                    <Toggle label="Show on mobile" checked={c.mobile.show} onChange={set("chat.mobile.show")} />
                    <Choice value={c.mobile.position} onChange={set("chat.mobile.position")} options={[["bottom-left", "↙ Left"], ["bottom-right", "Right ↘"]]} />
                    <NumberField label="From the side" value={c.mobile.offsetX} onChange={set("chat.mobile.offsetX")} max={100} unit="px" />
                    <NumberField label="From the bottom" value={c.mobile.offsetY} onChange={set("chat.mobile.offsetY")} max={300} unit="px" help="Raise it if it covers your theme's sticky Add to cart bar." />
                    <Toggle label="Icon only on mobile" checked={c.mobile.iconOnly} onChange={set("chat.mobile.iconOnly")} />
                  </div>
                </div>
              </Section>
              <Section title="Popup and messages">
                <Toggle label="Show a popup with your agents first" checked={c.popup.enabled} onChange={set("chat.popup.enabled")} help="When off, the button opens WhatsApp straight away." />
                {c.popup.enabled && (
                  <>
                    <Row>
                      <Text label="Popup title" value={c.popup.title} onChange={set("chat.popup.title")} maxLength={60} />
                      <ColorField label="Popup header colour" value={c.style.headerBg} onChange={set("chat.style.headerBg")} />
                    </Row>
                    <Text label="Popup text" value={c.popup.text} onChange={set("chat.popup.text")} maxLength={160} />
                  </>
                )}
                <Text label="Pre-filled message" value={c.greeting} onChange={set("chat.greeting")} multiline maxLength={500} />
                <Text label="Pre-filled message on product pages" value={c.productGreeting} onChange={set("chat.productGreeting")} multiline maxLength={500} help="Use {product} and {url}." />
                <Toggle label="“Need help?” tooltip" checked={c.tooltip.enabled} onChange={set("chat.tooltip.enabled")} help="Shown once per visit." />
                {c.tooltip.enabled && (
                  <Row>
                    <Text label="Tooltip text" value={c.tooltip.text} onChange={set("chat.tooltip.text")} maxLength={80} />
                    <NumberField label="Show after" value={c.tooltip.delaySec} onChange={set("chat.tooltip.delaySec")} max={60} unit="sec" />
                  </Row>
                )}
              </Section>
              <Section title="Business hours">
                <Toggle label="Show agents as offline outside business hours" checked={c.hours.enabled} onChange={set("chat.hours.enabled")} />
                {c.hours.enabled && (
                  <>
                    <Row>
                      <NumberField label="Opens at (hour)" value={c.hours.open} onChange={set("chat.hours.open")} max={23} />
                      <NumberField label="Closes at (hour)" value={c.hours.close} onChange={set("chat.hours.close")} min={1} max={24} />
                    </Row>
                    <Choice label="Open on" value={c.hours.days} onChange={set("chat.hours.days")} options={[["all", "Every day"], ["mon_sat", "Mon–Sat"], ["mon_fri", "Mon–Fri"]]} />
                    <Text label="Message when closed" value={c.offlineText} onChange={set("chat.offlineText")} maxLength={200} />
                    <Toggle label="Still allow chats when closed" checked={c.allowOffline} onChange={set("chat.allowOffline")} />
                  </>
                )}
              </Section>
              <Section title="Show on these pages">
                <PageRules value={c.pages} onChange={set("chat.pages")} />
              </Section>
            </>
          )}

          {tab === "discount" && (
            <>
              <Toggle label="Show the discount banner" checked={d.enabled} onChange={set("discount.enabled")} />
              <Section title="Discount code" aside={<Link to="/app/discounts">Create a code</Link>}>
                {data.discounts.length > 0 && (
                  <Choice value={data.discounts.some((x) => x.code === d.code) ? d.code : ""} onChange={set("discount.code")}
                    options={data.discounts.map((x) => [x.code, x.label])} />
                )}
                <Text label={data.discounts.length ? "…or type any code from your Shopify discounts" : "Code from your Shopify discounts"}
                  value={d.code} onChange={(v) => set("discount.code")(v.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} maxLength={40} placeholder="WELCOME10" />
                {discountMissing && <p className="wa-warn">Pick or type a code, or the banner stays hidden.</p>}
              </Section>
              <Section title="Text">
                <Text label="Headline" value={d.headline} onChange={set("discount.headline")} maxLength={80} />
                <Text label="Small text" value={d.subtext} onChange={set("discount.subtext")} maxLength={140} help="{code} shows the code as a highlighted tag." />
                <Row>
                  <Text label="Apply button" value={d.applyLabel} onChange={set("discount.applyLabel")} maxLength={30} />
                  <Text label="Copy button" value={d.copyLabel} onChange={set("discount.copyLabel")} maxLength={30} />
                </Row>
                <p className="wa-muted">“Apply” adds the code to the shopper's cart automatically (Shopify's discount link), then brings them back to the same page.</p>
              </Section>
              <Section title="Design">
                <Choice label="Layout" value={d.layout} onChange={set("discount.layout")} options={[["bar-top", "Top bar"], ["bar-bottom", "Bottom bar"], ["card", "Floating card"], ["popup", "Popup"]]} />
                <Row>
                  <ColorField label="Background" value={d.style.bg} onChange={set("discount.style.bg")} />
                  <ColorField label="Text" value={d.style.fg} onChange={set("discount.style.fg")} />
                </Row>
                <ColorField label="Accent (code + Apply button)" value={d.style.accent} onChange={set("discount.style.accent")} />
                <Choice label="Shape" value={d.style.shape} onChange={set("discount.style.shape")} options={[["square", "Square"], ["rounded", "Rounded"], ["pill", "Pill"]]} />
                <Choice label="Size" value={d.style.size} onChange={set("discount.style.size")} options={[["sm", "Compact"], ["md", "Regular"], ["lg", "Large"]]} />
              </Section>
              <Section title="Behaviour">
                <NumberField label="Show after" value={d.showAfterSec} onChange={set("discount.showAfterSec")} max={60} unit="sec" help="0 shows it immediately. A short delay works well for popups." />
                <Toggle label="Shoppers can close it" checked={d.dismissible} onChange={set("discount.dismissible")} />
                {d.dismissible && <NumberField label="Keep it hidden after closing for" value={d.dismissDays} onChange={set("discount.dismissDays")} max={90} unit="days" />}
                <Row>
                  <Toggle label="Show on desktop" checked={d.desktop.show} onChange={set("discount.desktop.show")} />
                  <Toggle label="Show on mobile" checked={d.mobile.show} onChange={set("discount.mobile.show")} />
                </Row>
              </Section>
              <Section title="Show on these pages">
                <PageRules value={d.pages} onChange={set("discount.pages")} />
              </Section>
            </>
          )}

          {tab === "buttons" && (
            <>
              <p className="wa-muted">These buttons sit inside your pages. Add them once from the theme editor; their look and pages are set here.</p>
              <Section title="Look (all page buttons)">
                <Choice label="Style" value={b.style} onChange={set("buttons.style")} options={[["solid", "Filled"], ["outline", "Outline"]]} />
                <Choice label="Shape" value={b.shape} onChange={set("buttons.shape")} options={[["square", "Square"], ["rounded", "Rounded"], ["pill", "Pill"]]} />
                <Choice label="Size" value={b.size} onChange={set("buttons.size")} options={[["sm", "Small"], ["md", "Medium"], ["lg", "Large"]]} />
                <Row>
                  <ColorField label="Colour" value={b.bg} onChange={set("buttons.bg")} />
                  <ColorField label="Text on filled buttons" value={b.fg} onChange={set("buttons.fg")} />
                </Row>
              </Section>
              {[
                ["product", "“Ask on WhatsApp” button", data.links.product],
                ["share", "“Share on WhatsApp” button", data.links.share],
                ["cart", "“Order on WhatsApp” button", data.links.cart],
              ].map(([key, title, href]) => (
                <Section key={key} title={title} aside={<a href={href} target="_top">Add to theme</a>}>
                  <PageRules value={b[key].pages} onChange={set(`buttons.${key}.pages`)} />
                </Section>
              ))}
            </>
          )}

          {tab === "general" && (
            <Section title="Analytics">
              <Toggle label="Count widget views and clicks" checked={config.tracking} onChange={set("tracking")}
                help="Stores daily totals only: no cookies, IP addresses or shopper details. Powers the Analytics page." />
              <button type="button" className="wa-link" onClick={() => setConfig(defaultConfig())}>Reset all widgets to default design</button>
            </Section>
          )}
        </div>

        <div className="wa-preview-col">
          <div className="wa-preview-bar">
            <div className="wa-seg" role="group" aria-label="Device">
              <button type="button" className={device === "desktop" ? "is-active" : ""} onClick={() => setDevice("desktop")}>Desktop</button>
              <button type="button" className={device === "mobile" ? "is-active" : ""} onClick={() => setDevice("mobile")}>Mobile</button>
            </div>
            <select className="wa-input wa-input--inline" value={pageType} onChange={(e) => setPageType(e.target.value)} aria-label="Preview page">
              {Object.entries(PREVIEW_PAGES).map(([k, v]) => <option key={k} value={k}>{v} page</option>)}
            </select>
          </div>
          <div ref={frameBox} className={`wa-device wa-device--${device}`} style={device === "desktop" ? { height: Math.round(800 * scale) } : undefined}>
            <iframe
              title="Widget preview"
              className="wa-preview-frame"
              sandbox="allow-scripts"
              srcDoc={srcDoc}
              style={device === "desktop" ? { width: 1280, height: 800, transform: `scale(${scale})`, transformOrigin: "0 0" } : undefined}
            />
          </div>
          <p className="wa-muted wa-center">Try it: click the widgets. Switch pages to check your page rules.</p>
        </div>
      </div>
    </Page>
  );
}
