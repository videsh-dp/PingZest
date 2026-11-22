/**
 * The message template editor: name, language, formatting toolbar, variables, and a WhatsApp phone preview
 * beside it (Built for Shopify 4.2.6). Saving goes through Shopify's save bar.
 */
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { TEMPLATE_TYPES, LANGUAGES, VARIABLES, renderTemplate, validateTemplate } from "../lib/templates.js";
import { wrapSelection, prefixLines, insertAt, FORMAT_HELP } from "../lib/whatsapp-format.js";
import { MAX_PREFILL_LENGTH } from "../lib/whatsapp.js";
import { WaBubble, SaveBar, ConfirmModal } from "./ui";
import { useT } from "../i18n/react.jsx";
import { N_ } from "../i18n/core.js";

export const SAMPLE = {
  name: "Priya", order_no: "#1042", amount: "₹1,299", items: "1 × Blue Cotton Kurta",
  confirm_link: "https://your-app.com/c/q7Rk2xVb9LmN4pWs8TzY1A", checkout_link: "https://your-store.com/checkouts/recover",
  tracking_link: "https://track.example/AWB123", order_status_link: "https://your-store.com/orders/status",
};
const EMOJI = ["👋", "🙏", "😊", "🛍️", "🛒", "📦", "🚚", "✅", "❌", "🎉", "⭐", "🔥", "💬", "⏰"];
const TOOLBAR = [
  ["bold", "B", N_("Bold (*text*)"), (t, a, b) => wrapSelection(t, a, b, "*")],
  ["italic", "I", N_("Italic (_text_)"), (t, a, b) => wrapSelection(t, a, b, "_")],
  ["strike", "S", N_("Strikethrough (~text~)"), (t, a, b) => wrapSelection(t, a, b, "~")],
  ["mono", "{ }", N_("Monospace (```text```)"), (t, a, b) => wrapSelection(t, a, b, "```")],
  ["code", "</>", N_("Inline code (`text`)"), (t, a, b) => wrapSelection(t, a, b, "`")],
  ["quote", "❝", N_("Quote (> )"), (t, a, b) => prefixLines(t, a, b, "quote")],
  ["bullet", "•", N_("Bulleted list (- )"), (t, a, b) => prefixLines(t, a, b, "bullet")],
  ["number", "1.", N_("Numbered list (1. )"), (t, a, b) => prefixLines(t, a, b, "number")],
];

export function TemplateEditor({ template, type, lang, storeName, canTranslate, canCreate, onDone }) {
  const tr = useT();
  const translator = useFetcher(); // per editor, so a draft never lands in another template
  const fetcher = useFetcher();
  const isNew = !template.id;
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState(template.body);
  const [tLang, setTLang] = useState(template.lang || lang);
  const [makeDefault, setMakeDefault] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  useEffect(() => { if (discarding) onDone(null, true); }, [discarding]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef(null);
  const result = fetcher.state === "idle" ? fetcher.data : null;

  useEffect(() => { setName(template.name); setBody(template.body); setTLang(template.lang || lang); setMakeDefault(false); }, [template.id, template.body, template.name, template.lang, lang]);
  useEffect(() => {
    if (translator.state === "idle" && translator.data?.translatedBody) setBody(translator.data.translatedBody);
  }, [translator.state, translator.data]);
  useEffect(() => {
    if (result?.deleted && result.ok) onDone(null);
    else if (result?.ok && result.id) onDone(result.id);
    if (result?.ok) window.shopify?.toast?.show?.(result.deleted ? tr("Template deleted") : tr("Template saved"));
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
            <span className="wa-field__label">{tr("Template name")}</span>
            <input className="wa-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={tr("e.g. Short & friendly")} />
          </label>
          <label className="wa-field">
            <span className="wa-field__label">{tr("Language")}</span>
            <select className="wa-input" value={tLang} onChange={(e) => setTLang(e.target.value)}>
              {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {canTranslate && body.trim() && (
              <button type="button" className="wa-link" disabled={translator.state !== "idle"}
                onClick={() => translator.submit({ intent: "translate", body, lang: tLang, from: template.lang && template.lang !== tLang ? template.lang : "" }, { method: "post" })}>
                {translator.state !== "idle" ? tr("Translating…") : tr("Translate the text into {language}", { language: LANGUAGES[tLang] })}
              </button>
            )}
          </label>
        </div>

        <div className="wa-field">
          <span className="wa-field__label">{tr("Message")}</span>
          <div className="wa-toolbar" role="toolbar" aria-label={tr("Formatting")}>
            {TOOLBAR.map(([id, label, title, fn]) => (
              <button key={id} type="button" className={`wa-tool wa-tool--${id}`} title={tr(title)} aria-label={tr(title)} onClick={() => apply(fn)}>{label}</button>
            ))}
            <span className="wa-toolbar__sep" />
            <details className="wa-emoji">
              <summary title={tr("Emoji")} aria-label={tr("Insert emoji")}>😊</summary>
              <div className="wa-emoji__grid">
                {EMOJI.map((em) => <button key={em} type="button" onClick={() => apply((t, a, b) => insertAt(t, a, b, em))}>{em}</button>)}
              </div>
            </details>
          </div>
          <textarea ref={ref} className="wa-textarea wa-textarea--editor" dir="auto" rows={10} value={body}
            onChange={(e) => setBody(e.target.value)} onKeyDown={onKeyDown} aria-label={tr("Message text")} />
          <div className="wa-chips" aria-label={tr("Insert variable")}>
            {TEMPLATE_TYPES[type].vars.map((v) => (
              <button key={v} type="button" className="wa-chip" title={VARIABLES[v]} onClick={() => apply((t, a, b) => insertAt(t, a, b, `{${v}}`))}>{`{${v}}`}</button>
            ))}
          </div>
          <span className={`wa-muted ${body.length > MAX_PREFILL_LENGTH ? "wa-warn" : ""}`}>{tr("{count} / {max} characters · Ctrl/⌘+B bold, Ctrl/⌘+I italic", { count: body.length, max: MAX_PREFILL_LENGTH })}</span>
        </div>

        {isNew && (
          <label className="wa-check"><input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} /> {tr("Use as the default for {stage} ({language})", { stage: tr(TEMPLATE_TYPES[type].label), language: LANGUAGES[tLang] })}</label>
        )}

        {clientError && dirty && <p className="wa-warn">{tr(clientError)}</p>}
        {result?.error && <p className="wa-error">{tr(result.error, result.errorVars)}</p>}
        {translator.state === "idle" && translator.data?.error && <p className="wa-error">{translator.data.error}</p>}
        {translator.state === "idle" && translator.data?.translatedBody && <p className="wa-muted">{tr("Translated by Google. Check it, then save.")}</p>}
        {result?.warning && <p className="wa-warn">{tr(result.warning)}</p>}

        {!isNew && (
          <div className="wa-row-gap">
            {!template.isDefault && (
              <button type="button" className="wa-button wa-button--secondary" onClick={() => fetcher.submit({ intent: "default", id: String(template.id) }, { method: "post" })}>{tr("Make default")}</button>
            )}
            {canCreate && <button type="button" className="wa-button wa-button--secondary" onClick={() => fetcher.submit({ intent: "duplicate", id: String(template.id) }, { method: "post" })}>{tr("Duplicate")}</button>}
            <button type="button" className="wa-button wa-button--critical" onClick={() => setDeleting(true)}>{tr("Delete")}</button>
          </div>
        )}
        <ConfirmModal
          open={deleting}
          title={tr("Delete “{name}”?", { name: template.name })}
          confirmLabel={tr("Delete")}
          destructive
          onCancel={() => setDeleting(false)}
          onConfirm={() => { setDeleting(false); fetcher.submit({ intent: "delete", id: String(template.id) }, { method: "post" }); }}
        >
          {tr("Queues that use it switch to the default template for this stage and language.")}
        </ConfirmModal>
        <SaveBar
          id="template-save-bar"
          dirty={dirty}
          guard={dirty && !discarding && !(result?.ok && (result.deleted || (isNew && result.id)))}
          saving={fetcher.state !== "idle" && ["create", "update"].includes(fetcher.formData?.get("intent"))}
          saveDisabled={!!clientError}
          onSave={() => fetcher.submit(
            { intent: isNew ? "create" : "update", id: String(template.id || ""), type, lang: tLang, name, body, isDefault: String(makeDefault) },
            { method: "post" },
          )}
          onDiscard={() => { if (isNew) setDiscarding(true); else { setName(template.name); setBody(template.body); setTLang(template.lang || lang); } }}
        />

        <details className="wa-help">
          <summary>{tr("What formatting does WhatsApp support?")}</summary>
          <ul>{FORMAT_HELP.map(([code, label]) => <li key={code}><code>{code}</code> {tr(label)}</li>)}</ul>
          <p className="wa-muted">{tr("Typed messages can't change colours, fonts or sizes, or add buttons and images. Those need the WhatsApp Business API.")}</p>
        </details>
      </div>

      <div className="wa-phone" aria-label={tr("Preview")}>
        <div className="wa-phone__head">
          <span className="wa-phone__avatar" aria-hidden="true">{(SAMPLE.name[0] || "C")}</span>
          <div><strong>{SAMPLE.name}</strong><span dir="ltr">+91 98765 43210</span></div>
        </div>
        <div className="wa-phone__chat">
          <WaBubble text={preview.text || " "} time="10:42" />
        </div>
        <p className="wa-phone__note">{tr("Preview with a sample order. In WhatsApp you can still edit the text before pressing send.")}</p>
      </div>
    </div>
  );
}

