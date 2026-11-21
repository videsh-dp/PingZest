/**
 * Small UI kit for the embedded admin (plain React + app.css, styled to sit
 * comfortably inside Shopify admin). Swap for Polaris components later if you like.
 */
import { useId, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useLocation, useNavigate, useSearchParams } from "react-router";
import { sectionFor } from "../lib/nav.js";
import { composeMessage } from "../lib/compose.js";
import { formatWhatsApp } from "../lib/whatsapp-format.js";
import { useT } from "../i18n/react.jsx";
import { LOCALES, N_ } from "../i18n/core.js";

/**
 * Every page has the same anatomy: category label → title → one-line explanation → main action,
 * then optional tabs, then the content. The category comes from the sidebar (app/lib/nav.js).
 */
export function Page({ title, subtitle, actions, tabs, children }) {
  const tr = useT();
  const { pathname } = useLocation();
  const where = sectionFor(pathname);
  return (
    <div className="wa-page">
      <div className="wa-page__head">
        <div>
          {where?.section && <p className="wa-page__eyebrow">{tr(where.section.title)}</p>}
          <h1 className="wa-page__title">{title}</h1>
          {subtitle && <p className="wa-page__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="wa-page__actions">{actions}</div>}
      </div>
      {tabs}
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

/**
 * Tabs that filter what the server loads (each tab is a link: ?filter=…). Use TabBar for tabs that
 * only switch panels on the page.
 */
export function Tabs({ tabs, param = "filter", label, variant }) {
  const tr = useT();
  const [params] = useSearchParams();
  const current = params.get(param) || tabs[0].id;
  return (
    <nav className={variant === "segmented" ? "wa-seg wa-seg--links" : "wa-tabs"} aria-label={label || tr("Filter")}>
      {tabs.map((t) => {
        const next = new URLSearchParams(params);
        next.set(param, t.id);
        return (
          <Link key={t.id} to={`?${next.toString()}`} className={`${variant === "segmented" ? "wa-seg__item" : "wa-tab"} ${current === t.id ? "is-active" : ""}`} aria-current={current === t.id ? "page" : undefined} preventScrollReset>
            {t.label}
            {typeof t.count === "number" && <span className="wa-tab__count">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Panel tabs kept in the URL (?tab=…) without reloading data, so a tab can be linked to and the
 * back button isn't flooded. Returns [current, select].
 */
export function useTabState(ids, { param = "tab", fallback } = {}) {
  const [params] = useSearchParams();
  const first = fallback || ids[0];
  const [tab, setTab] = useState(() => (ids.includes(params.get(param)) ? params.get(param) : first));
  const select = (id) => {
    setTab(id);
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      if (id === first) u.searchParams.delete(param); else u.searchParams.set(param, id);
      window.history.replaceState(window.history.state, "", u);
    }
  };
  return [ids.includes(tab) ? tab : first, select];
}

/** Tab buttons for panels on the same page (keyboard: arrow keys move between tabs). */
export function TabBar({ tabs, current, onSelect, label }) {
  const tr = useT();
  const id = useId();
  const refs = useRef([]);
  const onKey = (e, i) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const dir = typeof document !== "undefined" && document.dir === "rtl" ? -step : step;
    const next = (i + dir + tabs.length) % tabs.length;
    refs.current[next]?.focus();
    onSelect(tabs[next].id);
  };
  return (
    <div className="wa-tabs" role="tablist" aria-label={label || tr("Sections")}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="tab"
          id={`${id}-${t.id}`}
          aria-selected={current === t.id}
          tabIndex={current === t.id ? 0 : -1}
          className={`wa-tab ${current === t.id ? "is-active" : ""}`}
          onClick={() => onSelect(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
          {typeof t.count === "number" && <span className="wa-tab__count">{t.count}</span>}
          {t.badge && <span className="wa-tab__badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * The list on every page: search, "Showing X of Y", controls that act on the list (e.g. which
 * template to send with), a table on desktop that turns into cards on a phone, and clear empty and
 * no-match states.
 *
 * columns: [{ key, label, render(row), align: "right", primary: true }]
 * searchText(row) → the text the search box matches (order, customer, phone…)
 */
export function ListView({ rows, columns, rowKey = "id", searchText, searchPlaceholder, toolbar, empty, caption }) {
  const tr = useT();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => (needle && searchText ? rows.filter((r) => String(searchText(r) || "").toLowerCase().includes(needle)) : rows),
    [rows, needle, searchText],
  );
  const hasRows = rows.length > 0;
  return (
    <div className="wa-list">
      {(hasRows && searchText) || toolbar ? (
        <div className="wa-list__toolbar">
          {hasRows && searchText ? (
            <label className="wa-search">
              <span className="wa-search__icon" aria-hidden="true">⌕</span>
              <input
                type="search"
                className="wa-input wa-search__input"
                placeholder={searchPlaceholder || tr("Search")}
                aria-label={searchPlaceholder || tr("Search")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
          ) : null}
          {hasRows && <span className="wa-muted wa-small wa-list__count" aria-live="polite">{tr("Showing {shown} of {total}", { shown: shown.length, total: rows.length })}</span>}
          {toolbar && <div className="wa-list__tools">{toolbar}</div>}
        </div>
      ) : null}
      {!hasRows ? (
        empty
      ) : shown.length === 0 ? (
        <EmptyState icon="⌕" title={tr("No matches")} action={<button type="button" className="wa-button wa-button--secondary" onClick={() => setQ("")}>{tr("Clear search")}</button>}>
          {tr("Try another search, or clear it.")}
        </EmptyState>
      ) : (
        <table className="wa-table wa-list__table">
          {caption && <caption className="wa-visually-hidden">{caption}</caption>}
          <thead>
            <tr>{columns.map((c) => <th key={c.key} scope="col" className={c.align === "right" ? "wa-right" : undefined}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r[rowKey]}>
                {columns.map((c) => (
                  <td key={c.key} data-label={c.label} className={[c.align === "right" ? "wa-right" : "", c.primary ? "wa-list__primary" : "", c.key === "actions" ? "wa-list__actions" : ""].filter(Boolean).join(" ") || undefined}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
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

export function EmptyState({ title, children, icon, action }) {
  return (
    <div className="wa-empty">
      {icon && <span className="wa-empty__icon" aria-hidden="true">{icon}</span>}
      <p className="wa-empty__title">{title}</p>
      {children && <p className="wa-empty__text">{children}</p>}
      {action && <div className="wa-empty__action">{action}</div>}
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

/** "Send with: [template] [language]", next to the list it affects. */
export function SendWith({ templates, chosen, lang, langs, showTemplate = true }) {
  const tr = useT();
  return (
    <div className="wa-sendwith" role="group" aria-label={tr("Send with")}>
      <span className="wa-sendwith__label">{tr("Send with")}</span>
      {showTemplate && <TemplatePicker templates={templates} chosen={chosen} />}
      <LangSwitch lang={lang} langs={langs} />
    </div>
  );
}
