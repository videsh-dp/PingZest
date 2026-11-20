/**
 * Small UI kit for the embedded admin (plain React + app.css, styled to sit
 * comfortably inside Shopify admin). Swap for Polaris components later if you like.
 */
import { useState } from "react";
import { Link, useFetcher, useNavigate, useSearchParams } from "react-router";
import { composeMessage } from "../lib/compose.js";
import { formatWhatsApp } from "../lib/whatsapp-format.js";
import { useT } from "../i18n/react.jsx";
import { LOCALES, N_ } from "../i18n/core.js";

export function Page({ title, subtitle, actions, children }) {
  return (
    <div className="wa-page">
      <div className="wa-page__head">
        <div>
          <h1 className="wa-page__title">{title}</h1>
          {subtitle && <p className="wa-page__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="wa-page__actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, children, footer, className = "" }) {
  return (
    <section className={`wa-card ${className}`}>
      {title && <h2 className="wa-card__title">{title}</h2>}
      {children}
      {footer && <div className="wa-card__footer">{footer}</div>}
    </section>
  );
}

export function Stat({ label, value, hint, to }) {
  const inner = (
    <>
      <span className="wa-stat__value">{value}</span>
      <span className="wa-stat__label">{label}</span>
      {hint && <span className="wa-stat__hint">{hint}</span>}
    </>
  );
  return to ? <Link className="wa-stat wa-stat--link" to={to}>{inner}</Link> : <div className="wa-stat">{inner}</div>;
}

const TONES = {
  pending: "attention", sent: "info", confirmed: "success", cancelled: "critical", no_reply: "neutral",
  dismissed: "neutral", recovered: "success",
};
const LABELS = {
  pending: N_("To send"), sent: N_("Waiting"), confirmed: N_("Confirmed"), cancelled: N_("Cancelled"), no_reply: N_("No reply"),
  dismissed: N_("Dismissed"), recovered: N_("Recovered"),
};
export function StatusBadge({ status }) {
  const tr = useT();
  return <span className={`wa-badge wa-badge--${TONES[status] || "neutral"}`}>{LABELS[status] ? tr(LABELS[status]) : status}</span>;
}

export function Tabs({ tabs, param = "filter" }) {
  const tr = useT();
  const [params] = useSearchParams();
  const current = params.get(param) || tabs[0].id;
  return (
    <nav className="wa-tabs" aria-label={tr("Filter")}>
      {tabs.map((t) => {
        const next = new URLSearchParams(params);
        next.set(param, t.id);
        return (
          <Link key={t.id} to={`?${next.toString()}`} className={`wa-tab ${current === t.id ? "is-active" : ""}`} preventScrollReset>
            {t.label}
            {typeof t.count === "number" && <span className="wa-tab__count">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Message language for a queue (?lang=). Lists the languages that have templates. */
export function LangSwitch({ lang, langs }) {
  const tr = useT();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const codes = langs?.length ? langs : Object.keys(LOCALES);
  const onChange = (e) => {
    const p = new URLSearchParams(params);
    p.set("lang", e.target.value);
    p.delete("tpl");
    navigate(`?${p.toString()}`, { preventScrollReset: true, replace: true });
  };
  return (
    <label className="wa-picker">
      <span className="wa-muted">{tr("Message language")}</span>
      <select className="wa-input wa-input--inline" value={lang} onChange={onChange}>
        {codes.map((c) => <option key={c} value={c}>{LOCALES[c]?.native || c}</option>)}
      </select>
    </label>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="wa-empty">
      <p className="wa-empty__title">{title}</p>
      {children && <p className="wa-empty__text">{children}</p>}
    </div>
  );
}

export function Banner({ tone = "info", children }) {
  return <div className={`wa-banner wa-banner--${tone}`}>{children}</div>;
}

/**
 * "Send on WhatsApp": opens the chat with the message typed in and records that it was sent.
 * The merchant still presses send inside WhatsApp.
 */
export function SendButton({ link, intent, id, extra = {}, label, disabled }) {
  const tr = useT();
  const fetcher = useFetcher();
  if (!link) return <span className="wa-muted">{tr("No WhatsApp number")}</span>;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className={`wa-button wa-button--primary ${disabled ? "is-disabled" : ""}`}
      onClick={() => fetcher.submit({ intent, id: String(id), ...extra }, { method: "post" })}
    >
      {fetcher.state !== "idle" ? tr("Opening…") : label || tr("Send on WhatsApp")}
    </a>
  );
}

export function ActionButton({ intent, id, extra = {}, children, tone = "secondary", confirmText }) {
  const fetcher = useFetcher();
  return (
    <fetcher.Form
      method="post"
      onSubmit={(e) => { if (confirmText && !window.confirm(confirmText)) e.preventDefault(); }}
    >
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={id} />
      {Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" className={`wa-button wa-button--${tone}`} disabled={fetcher.state !== "idle"}>
        {children}
      </button>
    </fetcher.Form>
  );
}

export function MessagePreview({ message, missing = [], warning }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="wa-preview">
      <button type="button" className="wa-link" onClick={() => setOpen(!open)}>{open ? tr("Hide message") : tr("Preview message")}</button>
      {open && <WaBubble text={message} />}
      {missing.length > 0 && <p className="wa-warn">{tr("Missing: {list}", { list: missing.map((m) => `{${m}}`).join(", ") })}</p>}
      {warning && <p className="wa-warn">{warning}</p>}
    </div>
  );
}

/** A message rendered the way WhatsApp shows it (bold, italic, lists…). */
export function WaBubble({ text, time = "now" }) {
  return (
    <div className="wa-bubble wa-bubble--fmt" dir="auto">
      <div dangerouslySetInnerHTML={{ __html: formatWhatsApp(text) }} />
      <span className="wa-bubble__time">{time} ✓✓</span>
    </div>
  );
}

/**
 * Template choice for a queue page, kept in the URL (?tpl=ID).
 * Returns the chosen template and a compose(row) helper.
 */
export function useQueueTemplate(templates, lang) {
  const [params] = useSearchParams();
  const forLang = templates.filter((t) => t.lang === lang);
  const wanted = params.get("tpl");
  const chosen = forLang.find((t) => String(t.id) === wanted) || forLang.find((t) => t.isDefault) || forLang[0] || null;
  const compose = (row) => composeMessage(chosen?.body || "", row.vars, row.phone, lang);
  return { chosen, forLang, compose };
}

export function TemplatePicker({ templates, chosen }) {
  const tr = useT();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  if (!templates.length) return null;
  const onChange = (e) => {
    const p = new URLSearchParams(params);
    p.set("tpl", e.target.value);
    navigate(`?${p.toString()}`, { preventScrollReset: true, replace: true });
  };
  return (
    <label className="wa-picker">
      <span className="wa-muted">{tr("Template")}</span>
      <select className="wa-input wa-input--inline" value={chosen?.id ?? ""} onChange={onChange}>
        {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ` (${tr("default")})` : ""}</option>)}
      </select>
      <Link to="/app/templates" className="wa-muted">{tr("Edit")}</Link>
    </label>
  );
}
