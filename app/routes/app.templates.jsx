import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import {
  listTemplates, createTemplate, updateTemplate, duplicateTemplate, setDefaultTemplate, deleteTemplate,
} from "../models/templates.server";
import prisma from "../db.server";
import { TEMPLATE_TYPES, LANGUAGES, VARIABLES, DEFAULT_TEMPLATES, STARTER_TEMPLATES, renderTemplate, validateTemplate } from "../lib/templates.js";
import { wrapSelection, prefixLines, insertAt, FORMAT_HELP } from "../lib/whatsapp-format.js";
import { MAX_PREFILL_LENGTH } from "../lib/whatsapp.js";
import { Page, Card, Banner, WaBubble } from "../components/ui";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [settings, templates, usage] = await Promise.all([
    getSettings(session.shop),
    listTemplates(session.shop),
    prisma.messageLog.groupBy({ by: ["templateId"], where: { shop: session.shop }, _count: { _all: true } }),
  ]);
  const sends = Object.fromEntries(usage.map((u) => [u.templateId, u._count._all]));
  return {
    storeName: settings.storeName || "Your Store",
    templates: templates.map((t) => ({ id: t.id, type: t.type, lang: t.lang, name: t.name, body: t.body, isDefault: t.isDefault, sends: sends[t.id] || 0 })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = Object.fromEntries(await request.formData());
  const id = Number(form.id);
  switch (form.intent) {
    case "create": return createTemplate(shop, form);
    case "update": return updateTemplate(shop, id, form);
    case "duplicate": return duplicateTemplate(shop, id);
    case "default": return setDefaultTemplate(shop, id);
    case "delete": return { ...(await deleteTemplate(shop, id)), deleted: id };
    default: return { error: "Unknown action" };
  }
};

const SAMPLE = {
  name: "Priya", order_no: "#1042", amount: "₹1,299", items: "1 × Blue Cotton Kurta",
  confirm_link: "https://your-app.com/c/Ab3dE5fG7hJ9", checkout_link: "https://your-store.com/checkouts/recover",
  tracking_link: "https://track.example/AWB123", order_status_link: "https://your-store.com/orders/status",
};
const EMOJI = ["👋", "🙏", "😊", "🛍️", "🛒", "📦", "🚚", "✅", "❌", "🎉", "⭐", "🔥", "💬", "⏰"];
const TOOLBAR = [
  ["bold", "B", "Bold (*text*)", (t, a, b) => wrapSelection(t, a, b, "*")],
  ["italic", "I", "Italic (_text_)", (t, a, b) => wrapSelection(t, a, b, "_")],
  ["strike", "S", "Strikethrough (~text~)", (t, a, b) => wrapSelection(t, a, b, "~")],
  ["mono", "{ }", "Monospace (```text```)", (t, a, b) => wrapSelection(t, a, b, "```")],
  ["code", "</>", "Inline code (`text`)", (t, a, b) => wrapSelection(t, a, b, "`")],
  ["quote", "❝", "Quote (> )", (t, a, b) => prefixLines(t, a, b, "quote")],
  ["bullet", "•", "Bulleted list (- )", (t, a, b) => prefixLines(t, a, b, "bullet")],
  ["number", "1.", "Numbered list (1. )", (t, a, b) => prefixLines(t, a, b, "number")],
];

function Editor({ template, type, lang, storeName, onDone }) {
  const fetcher = useFetcher();
  const isNew = !template.id;
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState(template.body);
  const [tLang, setTLang] = useState(template.lang || lang);
  const [makeDefault, setMakeDefault] = useState(false);
  const ref = useRef(null);
  const result = fetcher.state === "idle" ? fetcher.data : null;

  useEffect(() => { setName(template.name); setBody(template.body); setTLang(template.lang || lang); setMakeDefault(false); }, [template.id, template.body, template.name, template.lang, lang]);
  useEffect(() => {
    if (result?.deleted && result.ok) onDone(null);
    else if (result?.ok && result.id) onDone(result.id);
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (fn) => {
    const el = ref.current;
    const a = el?.selectionStart ?? body.length;
    const b = el?.selectionEnd ?? body.length;
    const r = fn(body, a, b);
    setBody(r.text);
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(r.start, r.end); } });
  };
  const onKeyDown = (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === "b") { e.preventDefault(); apply(TOOLBAR[0][3]); }
    if (k === "i") { e.preventDefault(); apply(TOOLBAR[1][3]); }
  };

  const clientError = validateTemplate({ type, lang: tLang, name, body });
  const preview = renderTemplate(body, { ...SAMPLE, store_name: storeName }, { lang: tLang });
  const dirty = isNew || name !== template.name || body !== template.body || tLang !== template.lang;

  return (
    <div className="wa-tpl-editor">
      <div className="wa-tpl-editor__form">
        <div className="wa-row2">
          <label className="wa-field">
            <span className="wa-field__label">Template name</span>
            <input className="wa-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Short & friendly" />
          </label>
          <label className="wa-field">
            <span className="wa-field__label">Language</span>
            <select className="wa-input" value={tLang} onChange={(e) => setTLang(e.target.value)}>
              {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>

        <div className="wa-field">
          <span className="wa-field__label">Message</span>
          <div className="wa-toolbar" role="toolbar" aria-label="Formatting">
            {TOOLBAR.map(([id, label, title, fn]) => (
              <button key={id} type="button" className={`wa-tool wa-tool--${id}`} title={title} aria-label={title} onClick={() => apply(fn)}>{label}</button>
            ))}
            <span className="wa-toolbar__sep" />
            <details className="wa-emoji">
              <summary title="Emoji" aria-label="Insert emoji">😊</summary>
              <div className="wa-emoji__grid">
                {EMOJI.map((em) => <button key={em} type="button" onClick={() => apply((t, a, b) => insertAt(t, a, b, em))}>{em}</button>)}
              </div>
            </details>
          </div>
          <textarea ref={ref} className="wa-textarea wa-textarea--editor" dir="auto" rows={10} value={body}
            onChange={(e) => setBody(e.target.value)} onKeyDown={onKeyDown} aria-label="Message text" />
          <div className="wa-chips" aria-label="Insert variable">
            {TEMPLATE_TYPES[type].vars.map((v) => (
              <button key={v} type="button" className="wa-chip" title={VARIABLES[v]} onClick={() => apply((t, a, b) => insertAt(t, a, b, `{${v}}`))}>{`{${v}}`}</button>
            ))}
          </div>
          <span className={`wa-muted ${body.length > MAX_PREFILL_LENGTH ? "wa-warn" : ""}`}>{body.length} / {MAX_PREFILL_LENGTH} characters · Ctrl/⌘+B bold, Ctrl/⌘+I italic</span>
        </div>

        {isNew && (
          <label className="wa-check"><input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} /> Use as the default for {TEMPLATE_TYPES[type].label} ({LANGUAGES[tLang]})</label>
        )}

        {clientError && dirty && <p className="wa-warn">{clientError}</p>}
        {result?.error && <p className="wa-error">{result.error}</p>}
        {result?.warning && <p className="wa-warn">{result.warning}</p>}

        <div className="wa-row-gap">
          <button type="button" className="wa-button wa-button--primary" disabled={!!clientError || !dirty || fetcher.state !== "idle"}
            onClick={() => fetcher.submit(
              { intent: isNew ? "create" : "update", id: String(template.id || ""), type, lang: tLang, name, body, isDefault: String(makeDefault) },
              { method: "post" },
            )}>
            {fetcher.state !== "idle" ? "Saving…" : isNew ? "Create template" : "Save changes"}
          </button>
          {!isNew && !template.isDefault && (
            <button type="button" className="wa-button wa-button--secondary" onClick={() => fetcher.submit({ intent: "default", id: String(template.id) }, { method: "post" })}>Make default</button>
          )}
          {!isNew && <button type="button" className="wa-button wa-button--secondary" onClick={() => fetcher.submit({ intent: "duplicate", id: String(template.id) }, { method: "post" })}>Duplicate</button>}
          {!isNew && (
            <button type="button" className="wa-button wa-button--critical"
              onClick={() => window.confirm(`Delete “${template.name}”?`) && fetcher.submit({ intent: "delete", id: String(template.id) }, { method: "post" })}>Delete</button>
          )}
        </div>

        <details className="wa-help">
          <summary>What formatting does WhatsApp support?</summary>
          <ul>{FORMAT_HELP.map(([code, label]) => <li key={code}><code>{code}</code> {label}</li>)}</ul>
          <p className="wa-muted">Typed messages can't change colours, fonts or sizes, or add buttons and images. Those need the WhatsApp Business API.</p>
        </details>
      </div>

      <div className="wa-phone" aria-label="Preview">
        <div className="wa-phone__head">
          <span className="wa-phone__avatar" aria-hidden="true">{(SAMPLE.name[0] || "C")}</span>
          <div><strong>{SAMPLE.name}</strong><span>+91 98765 43210</span></div>
        </div>
        <div className="wa-phone__chat">
          <WaBubble text={preview.text || " "} time="10:42" />
        </div>
        <p className="wa-phone__note">Preview with a sample order. In WhatsApp you can still edit the text before pressing send.</p>
      </div>
    </div>
  );
}

export default function Templates() {
  const { templates, storeName } = useLoaderData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const type = TEMPLATE_TYPES[params.get("type")] ? params.get("type") : "cod_confirm";
  const lang = LANGUAGES[params.get("lang")] ? params.get("lang") : "en";
  const list = templates.filter((t) => t.type === type && t.lang === lang);
  const idParam = params.get("id");
  const starters = STARTER_TEMPLATES[type]?.[lang] || [];

  const go = (patch) => {
    const p = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === null ? p.delete(k) : p.set(k, v)));
    navigate(`?${p.toString()}`, { preventScrollReset: true });
  };

  let selected = null;
  if (idParam?.startsWith("new")) {
    const which = idParam.split(":")[1];
    const starter = which === "blank" ? ["", ""] : which === "standard" ? ["Standard copy", DEFAULT_TEMPLATES[type][lang]] : starters[Number(which)] || ["", ""];
    selected = { id: null, name: starter[0], body: starter[1], lang, isDefault: false };
  } else {
    selected = list.find((t) => String(t.id) === idParam) || list.find((t) => t.isDefault) || list[0] || null;
  }

  return (
    <Page title="Message templates" subtitle="Create as many messages as you like for each stage. Pick one in the queue when you send.">
      <nav className="wa-tabs">
        {Object.entries(TEMPLATE_TYPES).map(([k, meta]) => (
          <button key={k} type="button" className={`wa-tab ${type === k ? "is-active" : ""}`} onClick={() => go({ type: k, id: null })}>
            {meta.label}<span className="wa-tab__count">{templates.filter((t) => t.type === k && t.lang === lang).length}</span>
          </button>
        ))}
      </nav>

      <div className="wa-tpl-layout">
        <Card className="wa-tpl-list">
          <div className="wa-seg wa-seg--full" role="group" aria-label="Language">
            {Object.entries(LANGUAGES).map(([k, v]) => (
              <button key={k} type="button" className={lang === k ? "is-active" : ""} onClick={() => go({ lang: k, id: null })}>{v}</button>
            ))}
          </div>
          <p className="wa-muted">{TEMPLATE_TYPES[type].help}</p>
          <ul className="wa-tpl-items">
            {list.map((t) => (
              <li key={t.id}>
                <button type="button" className={`wa-tpl-item ${selected?.id === t.id ? "is-active" : ""}`} onClick={() => go({ id: String(t.id) })}>
                  <span className="wa-tpl-item__name">{t.name}{t.isDefault && <span className="wa-badge wa-badge--success">Default</span>}</span>
                  <span className="wa-tpl-item__body">{t.body.replace(/\s+/g, " ").slice(0, 90)}</span>
                  <span className="wa-muted wa-small">{t.sends ? `Sent ${t.sends} times` : "Not used yet"}</span>
                </button>
              </li>
            ))}
          </ul>
          <details className="wa-new">
            <summary className="wa-button wa-button--secondary">+ New template</summary>
            <div className="wa-new__menu">
              <button type="button" onClick={() => go({ id: "new:blank" })}>Blank</button>
              <button type="button" onClick={() => go({ id: "new:standard" })}>Copy of the standard message</button>
              {starters.map(([n], i) => <button key={n} type="button" onClick={() => go({ id: `new:${i}` })}>Starter: {n}</button>)}
            </div>
          </details>
        </Card>

        <Card title={selected?.id ? `Edit “${selected.name}”` : "New template"}>
          {selected ? (
            <Editor key={selected.id ?? idParam} template={selected} type={type} lang={lang} storeName={storeName}
              onDone={(newId) => go({ id: newId ? String(newId) : null })} />
          ) : (
            <Banner tone="info">Pick a template on the left, or create a new one.</Banner>
          )}
        </Card>
      </div>
    </Page>
  );
}
