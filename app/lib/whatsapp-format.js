/**
 * WhatsApp text formatting: what you can type in a normal (manual) WhatsApp message.
 *   *bold*   _italic_   ~strikethrough~   ```monospace```   `inline code`
 *   > quote            * item / - item (bulleted list)     1. item (numbered list)
 * No colours, fonts, sizes, buttons or images: those need the WhatsApp Business API.
 *
 * formatWhatsApp() turns text into safe HTML for previews. Editor helpers wrap a
 * selection or prefix lines, like WhatsApp's own formatting menu.
 */

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Inline styles within one line (text already HTML-escaped). */
function inline(line) {
  // protect inline code first so markers inside it stay literal
  const codes = [];
  let out = line.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // WhatsApp needs the marker next to a non-space character on the inside
  const wrap = (marker, tag) => {
    const m = marker.replace(/[*~]/g, "\\$&");
    const re = new RegExp(`(^|[\\s(>\\u0000"'.,!?;:])${m}(?=\\S)([^${marker}\\n]*?\\S)${m}(?=$|[\\s)<.,!?;:\\u0000"'])`, "g");
    out = out.replace(re, `$1<${tag}>$2</${tag}>`);
  };
  wrap("*", "strong");
  wrap("_", "em");
  wrap("~", "s");
  // links: make them look like links (no navigation in previews)
  out = out.replace(/(https?:\/\/[^\s<]+[^\s<.,!?;:)])/g, '<span class="wa-fmt-link">$1</span>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

export function formatWhatsApp(text) {
  const src = escapeHtml(String(text || "").replace(/\r\n?/g, "\n"));
  const parts = src.split(/```/);
  // odd parts are inside ``` ``` (only if the block is closed)
  const closed = parts.length % 2 === 1;
  let html = "";
  parts.forEach((part, i) => {
    if (i % 2 === 1 && (closed || i < parts.length - 1)) {
      html += `<pre class="wa-fmt-mono">${part.replace(/^\n|\n$/g, "")}</pre>`;
      return;
    }
    const chunk = i % 2 === 1 ? "```" + part : part;
    const lines = chunk.split("\n");
    let list = null; // "ul" | "ol"
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    lines.forEach((line, idx) => {
      const bullet = line.match(/^[*-] (.+)$/);
      const num = line.match(/^(\d{1,3})\. (.+)$/);
      const quote = line.match(/^&gt; ?(.*)$/);
      if (bullet) {
        if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; }
        html += `<li>${inline(bullet[1])}</li>`;
      } else if (num) {
        if (list !== "ol") { closeList(); html += `<ol start="${num[1]}">`; list = "ol"; }
        html += `<li>${inline(num[2])}</li>`;
      } else {
        closeList();
        if (quote) html += `<blockquote>${inline(quote[1])}</blockquote>`;
        else html += inline(line) + (idx < lines.length - 1 ? "<br>" : "");
      }
    });
    closeList();
  });
  return html;
}

/* ---------- editor helpers (return the new text and selection) ---------- */

/** Wrap the selection in a marker; with nothing selected, insert a placeholder. */
export function wrapSelection(text, start, end, marker, placeholder = "text") {
  const before = text.slice(0, start);
  const selected = text.slice(start, end) || placeholder;
  // keep leading/trailing spaces outside the markers (WhatsApp ignores "* bold *")
  const lead = selected.match(/^\s*/)[0];
  const trail = selected.match(/\s*$/)[0];
  const core = selected.trim() || placeholder;
  const next = `${before}${lead}${marker}${core}${marker}${trail}${text.slice(end)}`;
  const selStart = before.length + lead.length + marker.length;
  return { text: next, start: selStart, end: selStart + core.length };
}

/** Add a prefix to every line touched by the selection ("> ", "- ", "1. "). */
export function prefixLines(text, start, end, kind) {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = text.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = text.length;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const out = lines.map((l, i) => {
    const clean = l.replace(/^(> |[*-] |\d{1,3}\. )/, "");
    if (kind === "quote") return `> ${clean}`;
    if (kind === "bullet") return `- ${clean}`;
    if (kind === "number") return `${i + 1}. ${clean}`;
    return l;
  }).join("\n");
  const next = text.slice(0, lineStart) + out + text.slice(lineEnd);
  return { text: next, start: lineStart, end: lineStart + out.length };
}

/** Insert text at the cursor (emoji, {variable}). */
export function insertAt(text, start, end, value) {
  return { text: text.slice(0, start) + value + text.slice(end), start: start + value.length, end: start + value.length };
}

export const FORMAT_HELP = [
  ["*bold*", "Bold"],
  ["_italic_", "Italic"],
  ["~strike~", "Strikethrough"],
  ["```mono```", "Monospace"],
  ["`code`", "Inline code"],
  ["> quote", "Quote"],
  ["- item", "Bulleted list"],
  ["1. item", "Numbered list"],
];
