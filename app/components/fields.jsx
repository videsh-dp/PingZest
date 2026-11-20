/** Form controls for the Widgets editor. All controlled: value + onChange(newValue). */
import { PAGE_TYPES } from "../lib/widget-config.js";
import { useT } from "../i18n/react.jsx";

const SWATCHES = ["#1f8f4e", "#128c7e", "#0f766e", "#2563eb", "#6b21a8", "#db2777", "#dc2626", "#ea580c", "#1c1c1c", "#ffffff"];

export function Section({ title, children, aside }) {
  return (
    <fieldset className="wa-fs">
      <legend className="wa-fs__legend">{title}{aside && <span className="wa-fs__aside">{aside}</span>}</legend>
      {children}
    </fieldset>
  );
}

export function Row({ children }) {
  return <div className="wa-row2">{children}</div>;
}

export function Text({ label, value, onChange, help, multiline, maxLength = 200, placeholder }) {
  const Tag = multiline ? "textarea" : "input";
  return (
    <label className="wa-field">
      <span className="wa-field__label">{label}</span>
      <Tag className={multiline ? "wa-textarea wa-textarea--sm" : "wa-input"} value={value ?? ""} maxLength={maxLength}
        placeholder={placeholder} rows={multiline ? 3 : undefined} onChange={(e) => onChange(e.target.value)} />
      {help && <span className="wa-muted">{help}</span>}
    </label>
  );
}

export function NumberField({ label, value, onChange, min = 0, max = 300, unit, help }) {
  return (
    <label className="wa-field">
      <span className="wa-field__label">{label}</span>
      <span className="wa-num">
        <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <input type="number" className="wa-input wa-input--num" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        {unit && <span className="wa-muted">{unit}</span>}
      </span>
      {help && <span className="wa-muted">{help}</span>}
    </label>
  );
}

export function Toggle({ label, checked, onChange, help }) {
  return (
    <label className="wa-toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="wa-toggle__track" aria-hidden="true" />
      <span>
        <span className="wa-field__label">{label}</span>
        {help && <span className="wa-muted wa-d-block">{help}</span>}
      </span>
    </label>
  );
}

/** Segmented choice: options = [[value, label], ...] */
export function Choice({ label, value, onChange, options }) {
  return (
    <div className="wa-field">
      {label && <span className="wa-field__label">{label}</span>}
      <div className="wa-seg wa-seg--wrap" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? "is-active" : ""} onClick={() => onChange(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

export function ColorField({ label, value, onChange }) {
  return (
    <div className="wa-field">
      <span className="wa-field__label">{label}</span>
      <div className="wa-color">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        <input className="wa-input wa-input--hex" value={value} maxLength={7}
          onChange={(e) => /^#[0-9a-f]{0,6}$/i.test(e.target.value) && onChange(e.target.value)} />
      </div>
      <div className="wa-swatches">
        {SWATCHES.map((c) => (
          <button key={c} type="button" className={`wa-swatch ${value === c ? "is-active" : ""}`} style={{ background: c }} aria-label={c} onClick={() => onChange(c)} />
        ))}
      </div>
    </div>
  );
}

/** Which store pages a widget shows on. */
export function PageRules({ value, onChange }) {
  const tr = useT();
  const v = value || { mode: "all", pageTypes: [], paths: [] };
  const set = (patch) => onChange({ ...v, ...patch });
  const togglePage = (t) => set({ pageTypes: v.pageTypes.includes(t) ? v.pageTypes.filter((x) => x !== t) : [...v.pageTypes, t] });
  return (
    <div className="wa-rules">
      <Choice value={v.mode} onChange={(mode) => set({ mode })} options={[["all", tr("All pages")], ["include", tr("Only on…")], ["exclude", tr("All except…")]]} />
      {v.mode !== "all" && (
        <>
          <div className="wa-checks">
            {Object.entries(PAGE_TYPES).map(([t, label]) => (
              <label key={t} className="wa-check">
                <input type="checkbox" checked={v.pageTypes.includes(t)} onChange={() => togglePage(t)} /> {tr(label)}
              </label>
            ))}
          </div>
          <label className="wa-field">
            <span className="wa-field__label">{tr("Specific URLs (one per line)")}</span>
            <textarea className="wa-textarea wa-textarea--sm" rows={3} placeholder={"/pages/contact\n/products/*\n/collections/sale*"}
              value={v.paths.join("\n")} onChange={(e) => set({ paths: e.target.value.split("\n") })} />
            <span className="wa-muted">{tr("Use * as a wildcard. Paths start with /.")}</span>
          </label>
        </>
      )}
      <p className="wa-rules__summary">{ruleSummary(tr, v)}</p>
    </div>
  );
}

/** Up to 5 chat agents. */
export function Agents({ value, onChange }) {
  const tr = useT();
  const list = value?.length ? value : [{ name: "", phone: "" }];
  const update = (i, patch) => onChange(list.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div className="wa-agents">
      {list.map((a, i) => (
        <div key={i} className="wa-agent-row">
          <input className="wa-input" placeholder={tr("Name, e.g. Support")} value={a.name} maxLength={40} onChange={(e) => update(i, { name: e.target.value })} aria-label={tr("Agent {n} name", { n: i + 1 })} />
          <input className="wa-input" placeholder="+91 98765 43210" inputMode="tel" value={a.phone} maxLength={24} onChange={(e) => update(i, { phone: e.target.value })} aria-label={tr("Agent {n} WhatsApp number", { n: i + 1 })} />
          {list.length > 1 && <button type="button" className="wa-button wa-button--plain" aria-label={tr("Remove agent")} onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      {list.length < 5 && <button type="button" className="wa-link" onClick={() => onChange([...list, { name: "", phone: "" }])}>{tr("+ Add agent")}</button>}
      <span className="wa-muted wa-d-block">{tr("Chats rotate between agents when the popup is off.")}</span>
    </div>
  );
}

/** "Only on: Product pages, /pages/faq" in the merchant's language. */
function ruleSummary(tr, v) {
  if (!v || v.mode === "all") return tr("All pages");
  const parts = [...(v.pageTypes || []).map((t) => tr(PAGE_TYPES[t])), ...(v.paths || []).filter((p) => p.trim().startsWith("/"))];
  const list = parts.length ? parts.join(", ") : tr("nothing selected");
  return v.mode === "include" ? tr("Only on: {list}", { list }) : tr("Everywhere except: {list}", { list });
}
