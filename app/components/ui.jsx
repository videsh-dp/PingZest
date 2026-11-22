/**
 * Small UI kit for the embedded admin (plain React + app.css, styled to sit
 * comfortably inside Shopify admin). Swap for Polaris components later if you like.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useBlocker, useFetcher, useNavigate, useSearchParams } from "react-router";
import { composeMessage } from "../lib/compose.js";
import { formatWhatsApp } from "../lib/whatsapp-format.js";
import { useT } from "../i18n/react.jsx";
import { LOCALES, N_ } from "../i18n/core.js";

/*
 * Built on Polaris web components (s-page, s-section, s-banner, s-badge, s-table, s-button…), which
 * Shopify's AppProvider already loads (polaris.js from cdn.shopify.com). React 18 passes props to custom
 * elements as attributes, so: strings only, `class` (not className), and `undefined` to leave out a
 * boolean attribute (false would be the string "false", which counts as present).
 */

/** An attribute that is either present ("") or absent. */
export const flag = (on) => (on ? "" : undefined);

/**
 * A button in the page header (s-page slots). `to` navigates inside the app, `href` + `target` opens a
 * link, `onClick` runs an action. Other data-* props are passed through.
 */
function PageButton({ slot, variant, label, to, href, target, onClick, icon, tone, disabled, className, ...rest }) {
  const navigate = useNavigate();
  return (
    <s-button
      slot={slot}
      variant={variant}
      tone={tone}
      icon={icon}
      href={to || href}
      target={target}
      disabled={flag(disabled)}
      class={className}
      onClick={(e) => {
        if (to) { e.preventDefault(); navigate(to); }
        onClick?.(e);
      }}
      {...rest}
    >
      {label}
    </s-button>
  );
}

/**
 * Every page: s-page with the heading, an optional breadcrumb back to the menu item it belongs to, one
 * primary action and up to three secondary actions in the header; then the explanation, tabs and content.
 *   backTo: { to, label }   primaryAction / secondaryActions: { label, to | href | onClick, … }
 *   size: "large" for lists and dashboards, "small" for forms such as Settings.
 *   actions: extra content shown under the heading (e.g. a save status).
 */
export function Page({ title, subtitle, actions, primaryAction, secondaryActions = [], tabs, children, backTo, size }) {
  const navigate = useNavigate();
  const inline = size === "large" ? "large" : size === "small" ? "small" : "base";
  return (
    <s-page heading={title} inlineSize={inline} class={`wa-page${size ? ` wa-page--${size}` : ""}`}>
      {backTo && (
        <s-link slot="breadcrumb-actions" href={backTo.to} onClick={(e) => { e.preventDefault(); navigate(backTo.to); }} data-breadcrumb>
          {backTo.label}
        </s-link>
      )}
      {primaryAction && <PageButton slot="primary-action" variant="primary" {...primaryAction} />}
      {secondaryActions.filter(Boolean).slice(0, 3).map((a, i) => <PageButton key={a.key || i} slot="secondary-actions" variant="secondary" {...a} />)}
      {(subtitle || actions) && (
        <div className="wa-page__head">
          {subtitle && <p className="wa-page__subtitle">{subtitle}</p>}
          {actions && <div className="wa-page__actions">{actions}</div>}
        </div>
      )}
      {tabs}
      {children}
    </s-page>
  );
}

/** A card: s-section (with a heading). `flush` removes the padding, for lists. */
export function Card({ title, children, footer, className = "", id, flush = false }) {
  const plain = typeof title === "string";
  return (
    <div className={`wa-sec ${className}`} id={id}>
      <s-section heading={plain ? title : undefined} padding={flush || className.includes("wa-card--list") ? "none" : undefined}>
        {title && !plain && <s-heading>{title}</s-heading>}
        {children}
        {footer && <div className="wa-card__footer">{footer}</div>}
      </s-section>
    </div>
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
  pending: "warning", sent: "info", confirmed: "success", cancelled: "critical", no_reply: "neutral",
  dismissed: "neutral", recovered: "success",
};
const LABELS = {
  pending: N_("To send"), sent: N_("Waiting"), confirmed: N_("Confirmed"), cancelled: N_("Cancelled"), no_reply: N_("No reply"),
  dismissed: N_("Dismissed"), recovered: N_("Recovered"),
};
/** Polaris badge. tone: info | success | warning | critical | neutral. */
export function Badge({ tone = "neutral", children }) {
  return <s-badge tone={tone === "neutral" ? undefined : tone === "attention" ? "warning" : tone}>{children}</s-badge>;
}
export function StatusBadge({ status }) {
  const tr = useT();
  return <Badge tone={TONES[status] || "neutral"}>{LABELS[status] ? tr(LABELS[status]) : status}</Badge>;
}

/**
 * Tabs that filter what the server loads (each tab is a link: ?filter=…). Use TabBar for tabs that
 * only switch panels on the page. `main` lists the tab ids shown side by side; the others go under a
 * "More" menu so the row never wraps (at most 4 slots on a phone).
 */
export function Tabs({ tabs, param = "filter", label, variant, main }) {
  const tr = useT();
  const [params] = useSearchParams();
  const current = params.get(param) || tabs[0].id;
  const href = (id) => {
    const next = new URLSearchParams(params);
    next.set(param, id);
    return `?${next.toString()}`;
  };
  const shown = main ? tabs.filter((t) => main.includes(t.id)) : tabs;
  const more = main ? tabs.filter((t) => !main.includes(t.id)) : [];
  const moreActive = more.find((t) => t.id === current);
  const item = (t) => (
    <Link key={t.id} to={href(t.id)} className={`${variant === "segmented" ? "wa-seg__item" : "wa-tab"} ${current === t.id ? "is-active" : ""}`} aria-current={current === t.id ? "page" : undefined} preventScrollReset>
      {t.label}
      {typeof t.count === "number" && <span className="wa-tab__count">{t.count}</span>}
    </Link>
  );
  return (
    <nav className={variant === "segmented" ? "wa-seg wa-seg--links" : "wa-tabs"} aria-label={label || tr("Filter")}>
      {shown.map(item)}
      {more.length > 0 && (
        <details className={`wa-tabmore${moreActive ? " is-active" : ""}`}>
          <summary className={`wa-tab${moreActive ? " is-active" : ""}`}>
            {moreActive ? moreActive.label : tr("More")}
            {moreActive && typeof moreActive.count === "number" && <span className="wa-tab__count">{moreActive.count}</span>}
            <span aria-hidden="true" className="wa-tabmore__caret">▾</span>
          </summary>
          <div className="wa-menu" role="menu">
            {more.map((t) => (
              <Link key={t.id} role="menuitem" to={href(t.id)} className={`wa-menu__item${current === t.id ? " is-active" : ""}`} aria-current={current === t.id ? "page" : undefined} preventScrollReset
                onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}>
                <span>{t.label}</span>
                {typeof t.count === "number" && <span className="wa-tab__count">{t.count}</span>}
              </Link>
            ))}
          </div>
        </details>
      )}
    </nav>
  );
}

/**
 * Row actions menu ("More actions"): the less common actions of a list row, so each row shows one
 * button plus this menu. The menu opens at the end of <body> (fixed position), so a table never clips it.
 */
export function ActionMenu({ children, label }) {
  const tr = useT();
  const [at, setAt] = useState(null); // { top, right } when open
  const btn = useRef(null);
  const menu = useRef(null);
  const items = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  useEffect(() => {
    if (!at) return undefined;
    const close = (e) => {
      if (e.type === "keydown" && e.key !== "Escape") return;
      if (e.type === "mousedown" && (menu.current?.contains(e.target) || btn.current?.contains(e.target) || e.target.closest?.("dialog"))) return;
      setAt(null);
    };
    const onScroll = () => setAt(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("resize", onScroll);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); window.removeEventListener("resize", onScroll); };
  }, [at]);
  if (!items.length) return null;
  const open = () => {
    const r = btn.current.getBoundingClientRect();
    setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };
  return (
    <span className="wa-rowmenu">
      <button ref={btn} type="button" className="wa-button wa-button--secondary wa-rowmenu__toggle" aria-label={label || tr("More actions")} aria-haspopup="menu" aria-expanded={Boolean(at)}
        onClick={() => (at ? setAt(null) : open())} data-rowmenu>
        <span aria-hidden="true">•••</span>
      </button>
      {at && createPortal(
        <div ref={menu} className="wa-menu wa-menu--floating" role="menu" style={{ top: at.top, right: at.right }}
          onClick={() => setTimeout(() => { if (!document.querySelector("dialog[open]")) setAt(null); }, 0)}>{items}</div>,
        document.body,
      )}
    </span>
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
    const panels = tabs.filter((t) => !t.to);
    const at = panels.findIndex((t) => t.id === tabs[i].id);
    const next = panels[(at + dir + panels.length) % panels.length];
    refs.current[tabs.indexOf(next)]?.focus();
    onSelect(next.id);
  };
  return (
    <div className="wa-tabs" role="tablist" aria-label={label || tr("Sections")}>
      {tabs.map((t, i) => t.to ? (
        <Link key={t.id} to={t.to} className="wa-tab wa-tab--link">{t.label} <span aria-hidden="true">→</span></Link>
      ) : (
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
export const PAGE_SIZE = 50;

/**
 * The list on every page, on Polaris s-table: search, "Showing X of Y", controls that act on the list
 * (e.g. which template to send with), a table on desktop that Polaris turns into a list on a phone,
 * pagination past PAGE_SIZE rows, optional bulk selection, and clear empty and no-match states.
 *
 * columns: [{ key, label, render(row), align: "right", primary: true }]
 * searchText(row) → the text the search box matches (order, customer, phone…)
 * bulkActions: [{ label, onRun(ids), tone }] → a checkbox per row and the actions for the selected rows.
 */
export function ListView({ rows, columns, rowKey = "id", searchText, searchPlaceholder, toolbar, empty, caption, selectedKey, onRowClick, bulkActions, canSelect }) {
  const tr = useT();
  const [q, setQ] = useState("");
  const [pageNo, setPageNo] = useState(0);
  const [picked, setPicked] = useState(() => new Set());
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => (needle && searchText ? rows.filter((r) => String(searchText(r) || "").toLowerCase().includes(needle)) : rows),
    [rows, needle, searchText],
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(pageNo, pages - 1);
  const visible = shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  useEffect(() => { setPageNo(0); }, [needle]);
  // Rows that left the list (sent, filtered) leave the selection too.
  useEffect(() => {
    setPicked((p) => {
      const ids = new Set(rows.map((r) => r[rowKey]));
      const next = new Set([...p].filter((id) => ids.has(id)));
      return next.size === p.size ? p : next;
    });
  }, [rows, rowKey]);
  const tableRef = useRef(null);
  useEffect(() => {
    const t = tableRef.current;
    if (!t) return undefined;
    const next = () => setPageNo((n) => n + 1);
    const prev = () => setPageNo((n) => Math.max(0, n - 1));
    t.addEventListener("nextpage", next);
    t.addEventListener("previouspage", prev);
    return () => { t.removeEventListener("nextpage", next); t.removeEventListener("previouspage", prev); };
  });
  const bulk = bulkActions?.length ? bulkActions : null;
  const selectable = (r) => !canSelect || canSelect(r);
  const pageIds = visible.filter(selectable).map((r) => r[rowKey]);
  const allPicked = pageIds.length > 0 && pageIds.every((id) => picked.has(id));
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const hasRows = rows.length > 0;
  return (
    <div className="wa-list">
      {(hasRows && searchText) || toolbar ? (
        <div className="wa-list__toolbar">
          {hasRows && searchText ? (
            <label className="wa-search">
              <span className="wa-search__icon" aria-hidden="true"><s-icon type="search" /></span>
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
      {bulk && picked.size > 0 && (
        <div className="wa-bulkbar" role="region" aria-label={tr("Selected orders")} data-bulkbar>
          <strong>{tr("{count} selected", { count: picked.size })}</strong>
          {bulk.map((a) => (
            <button key={a.label} type="button" className={`wa-button wa-button--${a.tone || "secondary"}`} onClick={() => { a.onRun([...picked]); setPicked(new Set()); }}>{a.label}</button>
          ))}
          <button type="button" className="wa-link" onClick={() => setPicked(new Set())}>{tr("Clear selection")}</button>
        </div>
      )}
      {!hasRows ? (
        empty
      ) : shown.length === 0 ? (
        <EmptyState title={tr("No matches")} action={<button type="button" className="wa-button wa-button--secondary" onClick={() => setQ("")}>{tr("Clear search")}</button>}>
          {tr("Try another search, or clear it.")}
        </EmptyState>
      ) : (
        <s-table ref={tableRef} class="wa-list__table" paginate={flag(pages > 1)} hasNextPage={flag(page < pages - 1)} hasPreviousPage={flag(page > 0)} accessibilityLabel={caption}>
          <s-table-header-row>
            {bulk && (
              <s-table-header listSlot="inline">
                <input type="checkbox" className="wa-check__box" aria-label={tr("Select all on this page")} checked={allPicked}
                  onChange={() => setPicked((p) => { const n = new Set(p); pageIds.forEach((id) => (allPicked ? n.delete(id) : n.add(id))); return n; })} />
              </s-table-header>
            )}
            {columns.map((c) => (
              <s-table-header key={c.key} listSlot={c.primary ? "primary" : c.key === "actions" ? "inline" : "labeled"} format={c.align === "right" ? "numeric" : undefined}>{c.label}</s-table-header>
            ))}
          </s-table-header-row>
          <s-table-body>
            {visible.map((r) => (
              <s-table-row
                key={r[rowKey]}
                data-row={r[rowKey]}
                class={selectedKey != null && selectedKey === r[rowKey] ? "is-selected" : undefined}
                onClick={onRowClick ? (e) => { if (!e.target.closest?.("a, button, summary, input, select, textarea, dialog, s-button, s-link")) onRowClick(r); } : undefined}
              >
                {bulk && (
                  <s-table-cell>
                    {selectable(r) && <input type="checkbox" className="wa-check__box" aria-label={tr("Select")} checked={picked.has(r[rowKey])} onChange={() => toggle(r[rowKey])} data-pick={r[rowKey]} />}
                  </s-table-cell>
                )}
                {columns.map((c) => (
                  <s-table-cell key={c.key} class={c.key === "actions" ? "wa-list__actions" : undefined}>
                    {c.render ? c.render(r) : r[c.key]}
                  </s-table-cell>
                ))}
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
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

/** Polaris banner. One per page at most (Built for Shopify 4.3.4). tone: info | success | warning | critical. */
export function Banner({ tone = "info", heading, children }) {
  const t = tone === "attention" ? "warning" : tone;
  return <s-banner tone={t} heading={heading}>{children}</s-banner>;
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
      className={`wa-button wa-button--whatsapp ${disabled ? "is-disabled" : ""}`}
      onClick={() => fetcher.submit({ intent, id: String(id), ...extra }, { method: "post" })}
    >
      <WhatsAppIcon />
      {fetcher.state !== "idle" ? tr("Opening…") : label || tr("Send on WhatsApp")}
    </a>
  );
}

/** The WhatsApp mark (a speech bubble with a handset), for actions that open WhatsApp. */
export function WhatsAppIcon() {
  return (
    <svg className="wa-wa-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3 1 2.6 1.1 2.8.1.2 1.9 2.9 4.6 4 1.7.7 2.4.8 3.2.6.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z" />
    </svg>
  );
}

/**
 * A one-click action posted to the page's action (or `action`). With confirmText it asks first in a
 * styled modal (never the browser's window.confirm, which looks foreign inside Shopify admin).
 */
export function ActionButton({ intent, id, extra = {}, children, tone = "secondary", confirmText, confirmTitle, confirmLabel, action }) {
  const tr = useT();
  const fetcher = useFetcher();
  const formRef = useRef(null);
  const [asking, setAsking] = useState(false);
  return (
    <>
      <fetcher.Form
        method="post"
        action={action}
        ref={formRef}
        onSubmit={(e) => { if (confirmText && !asking) { e.preventDefault(); setAsking(true); } }}
      >
        <input type="hidden" name="intent" value={intent} />
        <input type="hidden" name="id" value={id} />
        {Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <button type="submit" className={`wa-button wa-button--${tone}`} disabled={fetcher.state !== "idle"}>
          {children}
        </button>
      </fetcher.Form>
      {confirmText && (
        <ConfirmModal
          open={asking}
          title={confirmTitle || (typeof children === "string" ? children : tr("Are you sure?"))}
          confirmLabel={confirmLabel || (typeof children === "string" ? children : tr("Confirm"))}
          destructive={tone === "critical"}
          onCancel={() => setAsking(false)}
          onConfirm={() => { setAsking(false); fetcher.submit(formRef.current); }}
        >
          {confirmText}
        </ConfirmModal>
      )}
    </>
  );
}

/**
 * Shopify-style modal (heading, message, one primary and one secondary action), on the native <dialog>
 * element: focus is trapped, Esc closes it, and it works in the Shopify mobile app's webview.
 */
export function ConfirmModal({ open, title, children, confirmLabel, cancelLabel, destructive = false, onConfirm, onCancel, busy = false }) {
  const tr = useT();
  const ref = useRef(null);
  // Rendered at the end of <body>, so the modal never inherits styles from where it was opened (a table
  // cell, a menu). Only after the page is interactive, so server and browser HTML match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", ""); }
    if (!open && d.open) d.close();
  }, [open, mounted]);
  if (!mounted) return null;
  return createPortal(
    <dialog
      ref={ref}
      className="wa-modal"
      aria-labelledby={title ? undefined : undefined}
      onCancel={(e) => { e.preventDefault(); onCancel?.(); }}
      onClick={(e) => { if (e.target === ref.current) onCancel?.(); }}
      data-modal
    >
      {open && (
        <div className="wa-modal__box" role="document">
          <div className="wa-modal__head">
            <h2 className="wa-modal__title">{title}</h2>
            <button type="button" className="wa-icon-button" onClick={onCancel} aria-label={tr("Close")}><s-icon type="x" /></button>
          </div>
          <div className="wa-modal__body">{children}</div>
          <div className="wa-modal__foot">
            <button type="button" className="wa-button wa-button--secondary" onClick={onCancel} autoFocus>{cancelLabel || tr("Cancel")}</button>
            <button type="button" className={`wa-button ${destructive ? "wa-button--danger" : "wa-button--primary"}`} onClick={onConfirm} disabled={busy}>{confirmLabel || tr("Confirm")}</button>
          </div>
        </div>
      )}
    </dialog>,
    document.body,
  );
}

/**
 * Shopify's contextual save bar (App Bridge <ui-save-bar>) for a form with unsaved changes, plus a guard
 * so the merchant can't leave the page without choosing Save or Discard (Built for Shopify 4.1.5):
 *   - inside Shopify admin the save bar sits in the admin's top bar, and Shopify blocks its own menu;
 *   - links inside the app ask in a modal first (React Router's blocker);
 *   - closing or reloading the tab asks the browser's "leave site?" question.
 * Without App Bridge (tests, local preview) the same bar shows at the bottom of the page.
 */
export function SaveBar({ id, dirty, saving = false, onSave, onDiscard, saveDisabled = false, guard = dirty }) {
  const tr = useT();
  useEffect(() => {
    const bar = typeof window !== "undefined" ? window.shopify?.saveBar : null;
    if (!bar) return undefined;
    try { (dirty && guard ? bar.show(id) : bar.hide(id)); } catch { /* App Bridge not ready */ }
    return () => { try { bar.hide(id); } catch { /* gone */ } };
  }, [dirty, guard, id]);
  useEffect(() => {
    if (!guard) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [guard]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => guard && !saving && currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search);
  return (
    <>
      <ui-save-bar id={id} data-open={dirty && guard ? "true" : "false"}>
        <button type="button" variant="primary" onClick={onSave} disabled={saveDisabled || saving || undefined} loading={saving ? "" : undefined}>{saving ? tr("Saving…") : tr("Save")}</button>
        <button type="button" onClick={onDiscard} disabled={saving || undefined}>{tr("Discard")}</button>
        <span className="wa-savebar__label">{tr("Unsaved changes")}</span>
      </ui-save-bar>
      <ConfirmModal
        open={blocker.state === "blocked"}
        title={tr("Leave page with unsaved changes?")}
        confirmLabel={tr("Leave page")}
        cancelLabel={tr("Stay")}
        destructive
        onCancel={() => blocker.reset?.()}
        onConfirm={() => { onDiscard?.(); blocker.proceed?.(); }}
      >
        {tr("Leaving this page will discard your changes.")}
      </ConfirmModal>
    </>
  );
}

/**
 * Unsaved-changes tracking for an uncontrolled <form>: compares the form's current values with the values
 * it had when it was last loaded or saved (`savedKey` changes after a save). Returns [dirty, discard].
 */
export function useFormDirty(formRef, savedKey) {
  const [dirty, setDirty] = useState(false);
  const snap = useRef("");
  const read = () => {
    const f = formRef.current;
    if (!f) return "";
    const pairs = [];
    for (const el of f.elements) {
      if (!el.name || el.type === "hidden" || el.disabled) continue;
      pairs.push(`${el.name}=${el.type === "checkbox" || el.type === "radio" ? el.checked : el.value}`);
    }
    return pairs.join("&");
  };
  useEffect(() => {
    snap.current = read();
    setDirty(false);
    const f = formRef.current;
    if (!f) return undefined;
    const check = () => setDirty(read() !== snap.current);
    f.addEventListener("input", check);
    f.addEventListener("change", check);
    return () => { f.removeEventListener("input", check); f.removeEventListener("change", check); };
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const discard = () => {
    formRef.current?.reset();
    setDirty(false);
  };
  return [dirty, discard];
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

/**
 * Shopify's setup-guide pattern: "X of Y steps completed", a collapse chevron and a dismiss button.
 * Steps tick themselves from real data; the first open step is expanded, the others show their title.
 * steps: [{ id, done, title, text, action }]
 */
export function SetupGuide({ title, intro, steps, onDismiss }) {
  const tr = useT();
  const done = steps.filter((s) => s.done).length;
  const firstOpen = steps.find((s) => !s.done)?.id;
  const [open, setOpen] = useState(firstOpen);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem("pz-setup-collapsed") === "1"); } catch { /* private mode */ }
  }, []);
  useEffect(() => { setOpen(firstOpen); }, [firstOpen]);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem("pz-setup-collapsed", next ? "1" : "0"); } catch { /* private mode */ }
  };
  return (
    <section className="wa-card wa-guide" aria-labelledby="wa-guide-title" data-setup-guide>
      <div className="wa-guide__head">
        <div>
          <h2 className="wa-card__title" id="wa-guide-title">{title}</h2>
          {!collapsed && intro && <p className="wa-muted wa-guide__intro">{intro}</p>}
          <p className="wa-guide__progress">
            <span className="wa-progress wa-guide__bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label={tr("Setup progress")}>
              <span className="wa-progress__bar" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
            </span>
            <span className="wa-muted wa-small">{tr("{done} of {total} steps completed", { done, total: steps.length })}</span>
          </p>
        </div>
        <div className="wa-guide__tools">
          <button type="button" className="wa-icon-button" onClick={toggle} aria-expanded={!collapsed} aria-controls="wa-guide-steps" aria-label={collapsed ? tr("Show steps") : tr("Hide steps")}>
            <s-icon type={collapsed ? "chevron-down" : "chevron-up"} />
          </button>
          <button type="button" className="wa-icon-button" onClick={onDismiss} aria-label={tr("Dismiss the setup guide")} data-dismiss-setup>
            <s-icon type="x" />
          </button>
        </div>
      </div>
      <ol className="wa-guide__steps" id="wa-guide-steps" hidden={collapsed}>
        {steps.map((s) => {
          const expanded = open === s.id && !s.done;
          return (
            <li key={s.id} className={`wa-guide__step${s.done ? " is-done" : ""}${expanded ? " is-open" : ""}`} data-step={s.id} data-done={s.done ? "1" : "0"}>
              <span className="wa-guide__check" aria-hidden="true">{s.done ? "✓" : ""}</span>
              <div className="wa-guide__body">
                <button type="button" className="wa-guide__title" aria-expanded={expanded} onClick={() => setOpen(s.id)}>
                  {s.title}
                  <span className="wa-visually-hidden">{s.done ? ` (${tr("done")})` : ""}</span>
                </button>
                {expanded && (
                  <div className="wa-guide__detail">
                    <p className="wa-muted">{s.text}</p>
                    <div>{s.action}</div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
