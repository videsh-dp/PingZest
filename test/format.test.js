import { test } from "node:test";
import assert from "node:assert/strict";
import { formatWhatsApp, wrapSelection, prefixLines, insertAt } from "../app/lib/whatsapp-format.js";

test("bold, italic, strike, inline code", () => {
  assert.equal(formatWhatsApp("Hi *Priya*, _thanks_ ~old~ `CODE`"), "Hi <strong>Priya</strong>, <em>thanks</em> <s>old</s> <code>CODE</code>");
});

test("markers need text right inside them, like WhatsApp", () => {
  assert.equal(formatWhatsApp("2 * 3 * 4"), "2 * 3 * 4");
  assert.equal(formatWhatsApp("Hi * not bold * ok"), "Hi * not bold * ok");
  assert.equal(formatWhatsApp("snake_case_name"), "snake_case_name");
  assert.equal(formatWhatsApp("total: *₹1,299*."), "total: <strong>₹1,299</strong>.");
});

test("markers inside inline code stay literal", () => {
  assert.equal(formatWhatsApp("`*not bold*`"), "<code>*not bold*</code>");
});

test("escapes HTML so previews are safe", () => {
  assert.equal(formatWhatsApp("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(formatWhatsApp('*<img src=x onerror="a">*'), "<strong>&lt;img src=x onerror=&quot;a&quot;&gt;</strong>");
});

test("lists, quotes, line breaks and monospace blocks", () => {
  assert.equal(formatWhatsApp("Items:\n- Kurta\n- Dupatta\nThanks"), "Items:<br><ul><li>Kurta</li><li>Dupatta</li></ul>Thanks");
  assert.equal(formatWhatsApp("1. Pay\n2. Ship"), '<ol start="1"><li>Pay</li><li>Ship</li></ol>');
  assert.equal(formatWhatsApp("> Order #1042"), "<blockquote>Order #1042</blockquote>");
  assert.equal(formatWhatsApp("Code:\n```\nWELCOME10\n```"), 'Code:<br><pre class="wa-fmt-mono">WELCOME10</pre>');
  assert.equal(formatWhatsApp("unclosed ```mono"), "unclosed ```mono");
});

test("links are highlighted, trailing punctuation excluded", () => {
  assert.equal(formatWhatsApp("Track: https://t.co/x1."), 'Track: <span class="wa-fmt-link">https://t.co/x1</span>.');
});

test("Hindi text formats too", () => {
  assert.equal(formatWhatsApp("*धन्यवाद* जी"), "<strong>धन्यवाद</strong> जी");
});

test("wrapSelection wraps, keeps spaces outside, inserts a placeholder", () => {
  assert.deepEqual(wrapSelection("Hi Priya", 3, 8, "*"), { text: "Hi *Priya*", start: 4, end: 9 });
  assert.deepEqual(wrapSelection("Hi Priya ", 2, 9, "_"), { text: "Hi _Priya_ ", start: 4, end: 9 });
  assert.deepEqual(wrapSelection("Hi ", 3, 3, "~", "text"), { text: "Hi ~text~", start: 4, end: 8 });
});

test("prefixLines toggles list and quote prefixes on touched lines", () => {
  const t = "Kurta\nDupatta\nThanks";
  assert.equal(prefixLines(t, 0, 10, "bullet").text, "- Kurta\n- Dupatta\nThanks");
  assert.equal(prefixLines("- Kurta\n- Dupatta", 0, 15, "number").text, "1. Kurta\n2. Dupatta");
  assert.equal(prefixLines("a\nb", 2, 2, "quote").text, "a\n> b");
});

test("insertAt", () => {
  assert.deepEqual(insertAt("Hi !", 3, 3, "{name}"), { text: "Hi {name}!", start: 9, end: 9 });
});
