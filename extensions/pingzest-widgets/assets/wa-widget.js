/*
 * PingZest storefront widgets (v2).
 * Settings come from the app (metafield pingzest.config, printed by snippets/wa-config.liquid).
 * Plain JS, no libraries, loaded with `defer`. Every widget only opens WhatsApp with a
 * message typed in; the shopper presses send.
 *
 * Preview mode: the app's Widgets editor loads this same file in an iframe with
 * window.__WA_PREVIEW__ = true, so the preview always matches the real store.
 */
(function () {
  "use strict";
  if (window.WAWidgets && window.WAWidgets.loaded) return;

  var PREVIEW = !!window.__WA_PREVIEW__;
  var NATIONAL_LENGTH = { "91": 10, "1": 10, "44": 10, "971": 9, "65": 8, "61": 9 };
  var DAYS = { all: [0, 1, 2, 3, 4, 5, 6], mon_sat: [1, 2, 3, 4, 5, 6], mon_fri: [1, 2, 3, 4, 5] };
  var ICONS = {
    bubble: '<path fill="currentColor" d="M12 2.5C6.5 2.5 2 6.4 2 11.2c0 2.4 1.1 4.6 3 6.2L4.2 21a.6.6 0 0 0 .9.6l4-2.1c.9.2 1.9.4 2.9.4 5.5 0 10-3.9 10-8.7S17.5 2.5 12 2.5z"/><circle cx="7.6" cy="11.2" r="1.4" fill="var(--wa-bg,#1f8f4e)"/><circle cx="12" cy="11.2" r="1.4" fill="var(--wa-bg,#1f8f4e)"/><circle cx="16.4" cy="11.2" r="1.4" fill="var(--wa-bg,#1f8f4e)"/>',
    phone: '<path fill="currentColor" d="M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/>',
    send: '<path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12.6 2-12.6 2z"/>',
  };

  /* ---------- helpers (exposed on window.WAWidgets for tests) ---------- */

  function normalizePhone(raw, cc) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).trim();
    if (!s) return null;
    cc = String(cc || "").replace(/\D/g, "");
    var plus = s.charAt(0) === "+";
    var d = s.replace(/\D/g, "");
    if (!d) return null;
    if (plus) {
      /* already international */
    } else if (d.indexOf("00") === 0) {
      d = d.slice(2);
    } else if (d.charAt(0) === "0") {
      d = cc + d.replace(/^0+/, "");
    } else if (cc) {
      var n = NATIONAL_LENGTH[cc];
      if ((n && d.length === n) || (!n && d.length <= 10)) d = cc + d;
    }
    return d.length >= 8 && d.length <= 15 ? d : null;
  }

  function waLink(phone, text) {
    var base = phone ? "https://wa.me/" + phone : "https://wa.me/";
    return text ? base + "?text=" + encodeURIComponent(text) : base;
  }

  function fillMessage(template, vars) {
    return String(template || "")
      .replace(/\{product\}/g, vars.product || "")
      .replace(/\{url\}/g, vars.url || "")
      .replace(/\{code\}/g, vars.code || "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/ {2,}/g, " ")
      .trim();
  }

  function isOpen(hours, now) {
    if (!hours || !hours.enabled) return true;
    now = now || new Date();
    var local = new Date(now.getTime() + (Number(hours.utcOffset) || 0) * 60000);
    var days = DAYS[hours.days] || DAYS.all;
    if (days.indexOf(local.getUTCDay()) === -1) return false;
    var hour = local.getUTCHours() + local.getUTCMinutes() / 60;
    var open = Number(hours.open), close = Number(hours.close);
    if (close <= open) return hour >= open || hour < close;
    return hour >= open && hour < close;
  }

  function pathMatches(pattern, path) {
    function norm(p) { return (p.length > 1 ? p.replace(/\/+$/, "") : p).toLowerCase(); }
    var escaped = norm(pattern).split("*").map(function (s) { return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"); }).join(".*");
    return new RegExp("^" + escaped + "$").test(norm(path));
  }

  function matchesPage(rules, page) {
    if (!rules || rules.mode === "all") return true;
    var hit = (rules.pageTypes || []).indexOf(page.pageType) !== -1 ||
      (rules.paths || []).some(function (p) { return pathMatches(p, page.path || "/"); });
    return rules.mode === "include" ? hit : !hit;
  }

  function formatMoney(cents, currency) {
    var amount = Number(cents) / 100;
    try {
      return new Intl.NumberFormat(currency === "INR" ? "en-IN" : undefined, {
        style: "currency", currency: currency || "INR", maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
      }).format(amount);
    } catch (e) {
      return (currency || "") + " " + amount.toFixed(2);
    }
  }

  function cartMessage(cart, opts) {
    if (!cart || !cart.items || !cart.items.length) return opts.empty || "";
    var currency = cart.currency || opts.currency;
    var lines = [opts.intro || ""];
    var permalink = [];
    cart.items.forEach(function (item) {
      var title = item.product_title || item.title;
      if (item.variant_title && item.variant_title !== "Default Title") title += " (" + item.variant_title + ")";
      lines.push("• " + item.quantity + " × " + title + " – " + formatMoney(item.final_line_price, currency));
      permalink.push(item.variant_id + ":" + item.quantity);
    });
    lines.push("Total: " + formatMoney(cart.total_price, currency));
    if (opts.outro) lines.push("", opts.outro);
    lines.push("", "Cart: " + window.location.origin + "/cart/" + permalink.join(","));
    return lines.join("\n").trim();
  }

  function discountApplyUrl(code, redirect) {
    return "/discount/" + encodeURIComponent(code) + "?redirect=" + encodeURIComponent(redirect || "/");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function icon(name) {
    return '<svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[name] || ICONS.bubble) + "</svg>";
  }
  function store(kind) {
    try { return kind === "session" ? window.sessionStorage : window.localStorage; } catch (e) { return null; }
  }
  function sget(key, kind) { try { var s = store(kind); return s ? s.getItem(key) : null; } catch (e) { return null; } }
  function sset(key, val, kind) { try { var s = store(kind); if (s) s.setItem(key, val); } catch (e) { /* private mode */ } }

  function readJSON(selector) {
    var el = document.querySelector(selector);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  /* ---------- context ---------- */

  var config = null;
  var page = { pageType: "other", path: "/", product: null, shop: "", currency: "INR", root: "/", locale: "en" };

  /* ---------- language: built-in labels + the merchant's per-language texts ---------- */

  var UI = {
    en: { online: "Online", offline: "Offline", close: "Close", dismiss: "Dismiss", copied: "Copied!", applied: "✓ Applied", discount: "Discount", chat: "Chat on WhatsApp", support: "Support", apply: "Apply", copy: "Copy code" },
    hi: { online: "ऑनलाइन", offline: "ऑफ़लाइन", close: "बंद करें", dismiss: "हटाएँ", copied: "कॉपी हो गया!", applied: "✓ लग गया", discount: "छूट", chat: "WhatsApp पर चैट करें", support: "सपोर्ट", apply: "लगाएँ", copy: "कोड कॉपी करें" },
    es: { online: "En línea", offline: "Desconectado", close: "Cerrar", dismiss: "Descartar", copied: "¡Copiado!", applied: "✓ Aplicado", discount: "Descuento", chat: "Chatea por WhatsApp", support: "Soporte", apply: "Aplicar", copy: "Copiar código" },
    pt: { online: "Online", offline: "Offline", close: "Fechar", dismiss: "Dispensar", copied: "Copiado!", applied: "✓ Aplicado", discount: "Desconto", chat: "Converse no WhatsApp", support: "Suporte", apply: "Aplicar", copy: "Copiar código" },
    fr: { online: "En ligne", offline: "Hors ligne", close: "Fermer", dismiss: "Ignorer", copied: "Copié !", applied: "✓ Appliqué", discount: "Réduction", chat: "Discuter sur WhatsApp", support: "Support", apply: "Appliquer", copy: "Copier le code" },
    de: { online: "Online", offline: "Offline", close: "Schließen", dismiss: "Ausblenden", copied: "Kopiert!", applied: "✓ Eingelöst", discount: "Rabatt", chat: "Per WhatsApp chatten", support: "Support", apply: "Einlösen", copy: "Code kopieren" },
    ar: { online: "متصل", offline: "غير متصل", close: "إغلاق", dismiss: "إخفاء", copied: "تم النسخ!", applied: "✓ تم التطبيق", discount: "خصم", chat: "دردش عبر واتساب", support: "الدعم", apply: "تطبيق", copy: "نسخ الرمز" },
  };
  function L(key) {
    var base = String(page.locale || "en").split("-")[0].toLowerCase();
    return (UI[base] && UI[base][key]) || UI.en[key];
  }
  function isRtl() { return /^(ar|he|fa|ur)\b/i.test(page.locale || ""); }

  /* Untouched default texts are shown in the shopper's language too. */
  var DEFAULTS_EN = {
    "chat.greeting": "Hi! I have a question about your store.",
    "chat.popup.title": "Chat with us",
    "chat.popup.text": "We usually reply within a few minutes.",
    "chat.offlineText": "We're offline right now. Leave a message and we'll reply when we open.",
    "chat.style.label": "Chat with us",
    "chat.tooltip.text": "Need help? Chat with us 👋",
    "discount.headline": "Get 10% off your first order",
    "discount.subtext": "Use code {code} at checkout",
    "discount.applyLabel": "Apply discount",
    "discount.copyLabel": "Copy code",
    "chat.productGreeting": "Hi! I have a question about {product}: {url}",
  };
  var DEFAULTS = {
    hi: ["नमस्ते! मेरा आपके स्टोर के बारे में एक सवाल है।", "हमसे चैट करें", "हम आम तौर पर कुछ ही मिनटों में जवाब देते हैं।", "हम अभी ऑफ़लाइन हैं। मैसेज छोड़ें, खुलते ही जवाब देंगे।", "हमसे चैट करें", "मदद चाहिए? हमसे चैट करें 👋", "पहले ऑर्डर पर 10% छूट पाएँ", "चेकआउट पर कोड {code} लगाएँ", "छूट लगाएँ", "कोड कॉपी करें", "नमस्ते! मेरा {product} के बारे में एक सवाल है: {url}"],
    es: ["¡Hola! Tengo una pregunta sobre tu tienda.", "Chatea con nosotros", "Solemos responder en pocos minutos.", "Ahora no estamos conectados. Déjanos un mensaje y te responderemos al abrir.", "Chatea con nosotros", "¿Necesitas ayuda? Escríbenos 👋", "10 % de descuento en tu primer pedido", "Usa el código {code} al pagar", "Aplicar descuento", "Copiar código", "¡Hola! Tengo una pregunta sobre {product}: {url}"],
    pt: ["Olá! Tenho uma dúvida sobre a sua loja.", "Fale com a gente", "Costumamos responder em poucos minutos.", "Estamos offline agora. Deixe uma mensagem e responderemos quando abrirmos.", "Fale com a gente", "Precisa de ajuda? Fale com a gente 👋", "Ganhe 10% de desconto no primeiro pedido", "Use o código {code} no checkout", "Aplicar desconto", "Copiar código", "Olá! Tenho uma dúvida sobre {product}: {url}"],
    fr: ["Bonjour ! J'ai une question sur votre boutique.", "Discutez avec nous", "Nous répondons généralement en quelques minutes.", "Nous sommes hors ligne. Laissez un message, nous répondrons à l'ouverture.", "Discutez avec nous", "Besoin d'aide ? Écrivez-nous 👋", "-10 % sur votre première commande", "Utilisez le code {code} au paiement", "Appliquer la réduction", "Copier le code", "Bonjour ! J'ai une question sur {product} : {url}"],
    de: ["Hallo! Ich habe eine Frage zu eurem Shop.", "Chatte mit uns", "Wir antworten meist innerhalb weniger Minuten.", "Wir sind gerade offline. Hinterlass eine Nachricht, wir antworten, sobald wir da sind.", "Chatte mit uns", "Brauchst du Hilfe? Chatte mit uns 👋", "10 % Rabatt auf deine erste Bestellung", "Nutze den Code {code} an der Kasse", "Rabatt einlösen", "Code kopieren", "Hallo! Ich habe eine Frage zu {product}: {url}"],
    ar: ["مرحبًا! لدي سؤال عن متجركم.", "تحدث معنا", "نرد عادةً خلال دقائق.", "نحن غير متصلين الآن. اترك رسالة وسنرد عند عودتنا.", "تحدث معنا", "تحتاج مساعدة؟ تحدث معنا 👋", "خصم 10% على طلبك الأول", "استخدم الرمز {code} عند الدفع", "تطبيق الخصم", "نسخ الرمز", "مرحبًا! لدي سؤال عن {product}: {url}"],
  };

  function setPath(obj, path, value) {
    var keys = path.split("."), o = obj;
    for (var i = 0; i < keys.length - 1 && o; i++) o = o[keys[i]];
    if (o) o[keys[keys.length - 1]] = value;
  }
  function getPath(obj, path) {
    return path.split(".").reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }

  /** Texts for this language: the merchant's own translations first, then built-in ones for untouched defaults. */
  function localize(cfg, locale) {
    if (!cfg) return cfg;
    var tr = cfg.translations || {};
    var base = String(locale || "").split("-")[0].toLowerCase();
    var texts = tr[locale] || tr[base];
    if (!texts) for (var k in tr) if (k.split("-")[0] === base) { texts = tr[k]; break; }
    var builtIn = DEFAULTS[base];
    if (!texts && !builtIn) return cfg;
    var out = JSON.parse(JSON.stringify(cfg));
    var paths = Object.keys(DEFAULTS_EN);
    for (var i = 0; i < paths.length; i++) {
      var path = paths[i];
      if (texts && texts[path]) setPath(out, path, texts[path]);
      else if (builtIn && getPath(cfg, path) === DEFAULTS_EN[path]) setPath(out, path, builtIn[i]);
    }
    return out;
  }
  var mobileQuery = window.matchMedia ? window.matchMedia("(max-width: 749px)") : { matches: false };
  function device() { return mobileQuery.matches ? "mobile" : "desktop"; }

  function loadContext() {
    config = readJSON("script[data-pingzest-config]") || null;
    var p = readJSON("script[data-pingzest-page]") || {};
    var root = p.root || (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
    var path = window.__WA_PREVIEW_PATH__ || window.location.pathname;
    if (root !== "/" && path.indexOf(root.replace(/\/$/, "")) === 0) path = path.slice(root.replace(/\/$/, "").length) || "/";
    page = {
      pageType: p.pageType || "other",
      path: path,
      product: p.product || null,
      shop: p.shop || "",
      currency: p.currency || "INR",
      root: root,
      locale: window.__WA_PREVIEW_LOCALE__ || p.locale || document.documentElement.lang || "en",
    };
    if (config) config = localize(config, page.locale);
  }

  function cleanUrl() {
    if (PREVIEW) return "https://your-store.com" + page.path;
    return window.location.origin + window.location.pathname;
  }

  /* ---------- tracking: one request per page for views, one per click ---------- */

  var pendingViews = [];
  var viewTimer = null;
  function send(events) {
    if (PREVIEW || !config || config.tracking === false || !events.length) return;
    try {
      var payload = JSON.stringify({ pageType: page.pageType, device: device(), events: events });
      var url = "/apps/pingzest/track";
      if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([payload], { type: "text/plain" }));
      else fetch(url, { method: "POST", body: payload, keepalive: true, credentials: "omit" });
    } catch (e) { /* tracking must never break a widget */ }
  }
  function trackView(widget) {
    pendingViews.push({ widget: widget, event: "view" });
    clearTimeout(viewTimer);
    viewTimer = setTimeout(function () { send(pendingViews.splice(0, 10)); }, 800);
  }
  function track(widget, event) { send([{ widget: widget, event: event }]); }

  /* ---------- opening WhatsApp ---------- */

  function toast(text) {
    var t = document.createElement("div");
    t.className = "wa-toast";
    t.setAttribute("role", "status");
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("is-out"); }, 2600);
    setTimeout(function () { t.remove(); }, 3000);
  }

  function openLink(url) {
    if (PREVIEW) {
      var text = "";
      try { text = new URL(url).searchParams.get("text") || ""; } catch (e) { /* ignore */ }
      return toast("Preview: opens WhatsApp" + (text ? " with “" + text.slice(0, 90) + (text.length > 90 ? "…" : "") + "”" : ""));
    }
    var w = window.open(url, "_blank", "noopener");
    if (!w) window.location.href = url;
  }

  function pickAgent(agents) {
    if (!agents.length) return null;
    var last = parseInt(sget("wa_agent_rr") || "-1", 10);
    var next = (isNaN(last) ? 0 : last + 1) % agents.length;
    sset("wa_agent_rr", String(next));
    return agents[next];
  }

  /* ---------- chat button ---------- */

  function chatAgents() {
    var c = config && config.chat;
    if (!c) return [];
    return (c.agents || [])
      .map(function (a) { return { name: (a.name || "").trim() || L("support"), phone: normalizePhone(a.phone, c.countryCode) }; })
      .filter(function (a) { return a.phone; });
  }

  function mountChat() {
    var c = config && config.chat;
    if (!c || !c.enabled || !matchesPage(c.pages, page)) return;
    var agents = chatAgents();
    if (!agents.length) return;
    var st = c.style || {};
    var d = c.desktop || {}, m = c.mobile || {};
    if (d.show === false && m.show === false) return;

    var root = document.createElement("div");
    if (isRtl()) root.dir = "rtl";
    root.className = [
      "wa-chat",
      "wa-chat--" + (st.shape || "pill"),
      "wa-chat--" + (st.size || "md"),
      "wa-chat--d-" + (d.position === "bottom-left" ? "left" : "right"),
      "wa-chat--m-" + (m.position === "bottom-left" ? "left" : "right"),
      d.show === false ? "wa-chat--d-hide" : "",
      m.show === false ? "wa-chat--m-hide" : "",
      m.iconOnly !== false ? "wa-chat--m-icon" : "",
      st.pulse ? "wa-chat--pulse" : "",
      st.label ? "" : "wa-chat--no-label",
    ].join(" ");
    root.style.cssText =
      "--wa-bg:" + (st.bg || "#1f8f4e") + ";--wa-fg:" + (st.fg || "#fff") + ";--wa-header:" + (st.headerBg || st.bg || "#1f8f4e") +
      ";--wa-dx:" + (d.offsetX || 0) + "px;--wa-dy:" + (d.offsetY || 0) + "px;--wa-mx:" + (m.offsetX || 0) + "px;--wa-my:" + (m.offsetY || 0) + "px";
    root.setAttribute("data-wa-widget", "chat");

    var popupOn = c.popup && c.popup.enabled !== false;
    root.innerHTML =
      '<div class="wa-chat__tooltip" hidden><button type="button" class="wa-chat__tooltip-text"></button><button type="button" class="wa-chat__tooltip-x" aria-label="' + esc(L("close")) + '">&times;</button></div>' +
      '<div class="wa-chat__popup" hidden role="dialog" aria-label="' + esc((c.popup && c.popup.title) || L("chat")) + '">' +
      '<div class="wa-chat__head"><strong class="wa-chat__title">' + esc(c.popup && c.popup.title) + '</strong><button type="button" class="wa-chat__close" aria-label="' + esc(L("close")) + '">&times;</button></div>' +
      '<p class="wa-chat__text"></p><ul class="wa-chat__agents"></ul></div>' +
      '<button type="button" class="wa-chat__bubble" aria-expanded="false" aria-label="' + esc(st.label || L("chat")) + '">' + icon(st.icon) +
      (st.label ? '<span class="wa-chat__label">' + esc(st.label) + "</span>" : "") + "</button>";
    document.body.appendChild(root);

    var popup = root.querySelector(".wa-chat__popup");
    var bubble = root.querySelector(".wa-chat__bubble");
    var list = root.querySelector(".wa-chat__agents");
    var tip = root.querySelector(".wa-chat__tooltip");
    var open = isOpen(c.hours);

    function message() {
      if (page.product && c.productGreeting) return fillMessage(c.productGreeting, { product: page.product, url: cleanUrl() });
      return fillMessage(c.greeting, { url: cleanUrl() });
    }
    function closePopup() { popup.hidden = true; bubble.setAttribute("aria-expanded", "false"); }
    function startChat(agent) {
      track("chat", "click");
      openLink(waLink(agent.phone, message()));
      closePopup();
    }
    function renderPopup() {
      root.querySelector(".wa-chat__text").textContent = open ? (c.popup && c.popup.text) || "" : c.offlineText || "";
      list.innerHTML = "";
      agents.forEach(function (agent) {
        var li = document.createElement("li");
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "wa-chat__agent";
        btn.disabled = !open && !c.allowOffline;
        btn.innerHTML = '<span class="wa-chat__avatar" aria-hidden="true">' + esc(agent.name.charAt(0).toUpperCase()) + "</span>" +
          '<span class="wa-chat__agent-name">' + esc(agent.name) + "</span>" +
          '<span class="wa-chat__status ' + (open ? "is-online" : "is-offline") + '">' + (open ? L("online") : L("offline")) + "</span>";
        btn.addEventListener("click", function () { startChat(agent); });
        li.appendChild(btn);
        list.appendChild(li);
      });
    }
    function onBubble() {
      tip.hidden = true;
      if (!popupOn && (open || c.allowOffline)) return startChat(agents.length === 1 ? agents[0] : pickAgent(agents));
      if (!popup.hidden) return closePopup();
      renderPopup();
      popup.hidden = false;
      bubble.setAttribute("aria-expanded", "true");
    }
    bubble.addEventListener("click", onBubble);
    root.querySelector(".wa-chat__close").addEventListener("click", function () { closePopup(); bubble.focus(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePopup(); });

    // "Need help?" tooltip, once per browser session
    var t = c.tooltip || {};
    if (t.enabled && t.text && (PREVIEW || !sget("wa_tip_seen", "session"))) {
      tip.querySelector(".wa-chat__tooltip-text").textContent = t.text;
      setTimeout(function () {
        if (!popup.hidden) return;
        tip.hidden = false;
        sset("wa_tip_seen", "1", "session");
      }, PREVIEW ? 300 : (t.delaySec || 0) * 1000);
      tip.querySelector(".wa-chat__tooltip-text").addEventListener("click", onBubble);
      tip.querySelector(".wa-chat__tooltip-x").addEventListener("click", function () { tip.hidden = true; });
    }

    if (getComputedStyle(root).display !== "none") trackView("chat");
  }

  /* ---------- discount banner ---------- */

  function appliedCode() {
    try {
      var m = document.cookie.match(/(?:^|;\s*)discount_code=([^;]+)/);
      return m ? decodeURIComponent(m[1]).toUpperCase() : "";
    } catch (e) {
      return ""; // sandboxed preview has no cookies
    }
  }

  function mountDiscount() {
    var ds = config && config.discount;
    if (!ds || !ds.enabled || !ds.code || !matchesPage(ds.pages, page)) return;
    var dev = device();
    if ((dev === "mobile" && ds.mobile && ds.mobile.show === false) || (dev === "desktop" && ds.desktop && ds.desktop.show === false)) return;
    var dismissKey = "wa_disc_x_" + ds.code;
    var dismissedAt = parseInt(sget(dismissKey) || "0", 10);
    if (!PREVIEW && ds.dismissible && dismissedAt && Date.now() - dismissedAt < (ds.dismissDays || 0) * 86400000) return;

    var st = ds.style || {};
    var chatLeft = config.chat && config.chat.desktop && config.chat.desktop.position === "bottom-left";
    var applied = appliedCode() === ds.code.toUpperCase();
    var codeHtml = '<strong class="wa-disc__code">' + esc(ds.code) + "</strong>";
    var sub = esc(ds.subtext || "").replace(/\{code\}/g, codeHtml);

    var el = document.createElement("div");
    if (isRtl()) el.dir = "rtl";
    el.className = [
      "wa-disc", "wa-disc--" + (ds.layout || "bar-top"), "wa-disc--" + (st.shape || "rounded"), "wa-disc--" + (st.size || "md"),
      ds.layout === "card" ? (chatLeft ? "wa-disc--right" : "wa-disc--left") : "",
    ].join(" ");
    el.style.cssText = "--wa-dbg:" + (st.bg || "#1c1c1c") + ";--wa-dfg:" + (st.fg || "#fff") + ";--wa-dacc:" + (st.accent || "#f5c542");
    el.setAttribute("data-wa-widget", "discount");
    el.setAttribute("role", ds.layout === "popup" ? "dialog" : "region");
    el.setAttribute("aria-label", ds.headline || L("discount"));
    el.innerHTML =
      (ds.layout === "popup" ? '<div class="wa-disc__overlay"></div>' : "") +
      '<div class="wa-disc__box">' +
      '<div class="wa-disc__body"><p class="wa-disc__headline">' + esc(ds.headline) + "</p>" + (sub ? '<p class="wa-disc__sub">' + sub + "</p>" : "") + "</div>" +
      '<div class="wa-disc__actions">' +
      (applied
        ? '<span class="wa-disc__applied">' + esc(L("applied")) + "</span>"
        : '<a class="wa-disc__btn wa-disc__btn--apply" href="' + esc(discountApplyUrl(ds.code, window.location.pathname + window.location.search)) + '">' + esc(ds.applyLabel || L("apply")) + "</a>" +
          '<button type="button" class="wa-disc__btn wa-disc__btn--copy">' + esc(ds.copyLabel || L("copy")) + "</button>") +
      "</div>" +
      (ds.dismissible ? '<button type="button" class="wa-disc__x" aria-label="' + esc(L("dismiss")) + '">&times;</button>' : "") +
      "</div>";

    // Bottom bars (and the mobile bottom sheet) push the chat button up so they never overlap.
    function updateLift() {
      var bottomAnchored = el.isConnected && (ds.layout === "bar-bottom" || (ds.layout === "card" && device() === "mobile"));
      var h = bottomAnchored ? el.querySelector(".wa-disc__box").getBoundingClientRect().height : 0;
      document.documentElement.style.setProperty("--wa-lift", Math.round(h) + "px");
    }
    function show() {
      if (ds.layout === "bar-top") document.body.insertBefore(el, document.body.firstChild);
      else document.body.appendChild(el);
      updateLift();
      if (window.ResizeObserver) new ResizeObserver(updateLift).observe(el);
      if (mobileQuery.addEventListener) mobileQuery.addEventListener("change", updateLift);
      trackView("discount");
    }
    var apply = el.querySelector(".wa-disc__btn--apply");
    if (apply) apply.addEventListener("click", function (e) {
      track("discount", "apply");
      if (PREVIEW) { e.preventDefault(); toast("Preview: applies " + ds.code + " to the cart and reloads this page"); }
    });
    var copy = el.querySelector(".wa-disc__btn--copy");
    if (copy) copy.addEventListener("click", function () {
      track("discount", "copy");
      var done = function () { copy.textContent = L("copied"); setTimeout(function () { copy.textContent = ds.copyLabel || L("copy"); }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ds.code).then(done, done);
      else done();
    });
    function dismiss() { el.remove(); updateLift(); sset(dismissKey, String(Date.now())); }
    var x = el.querySelector(".wa-disc__x");
    if (x) x.addEventListener("click", dismiss);
    var ov = el.querySelector(".wa-disc__overlay");
    if (ov && ds.dismissible) ov.addEventListener("click", dismiss);

    var delay = PREVIEW ? 0 : (ds.showAfterSec || 0) * 1000;
    if (delay) setTimeout(show, delay); else show();
  }

  /* ---------- inline buttons (product / cart / share blocks) ---------- */

  function styleButtons() {
    var b = config && config.buttons;
    var blocks = document.querySelectorAll("[data-wa-block]");
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      var kind = block.getAttribute("data-wa-block");
      var rules = b && b[kind] && b[kind].pages;
      if (rules && !matchesPage(rules, page)) { block.hidden = true; continue; }
      var btn = block.querySelector(".wa-btn");
      if (btn && b) {
        btn.classList.add("wa-btn--" + (b.style || "solid"), "wa-btn--shape-" + (b.shape || "rounded"), "wa-btn--size-" + (b.size || "md"));
        btn.style.setProperty("--wa-color", b.bg || "#1f8f4e");
        btn.style.setProperty("--wa-on", b.fg || "#fff");
      } else if (btn) {
        btn.classList.add("wa-btn--solid");
      }
      if (!block.__waViewed) { block.__waViewed = true; trackView(kind); }
    }
  }

  function fallbackPhone() {
    var a = chatAgents();
    return a.length ? a[0].phone : null;
  }

  function onButtonClick(e) {
    var el = e.target.closest && e.target.closest("a[data-wa-widget]");
    if (!el) return;
    var type = el.getAttribute("data-wa-widget");
    if (type !== "product" && type !== "share" && type !== "cart") return;
    e.preventDefault();
    var cc = el.getAttribute("data-country-code") || (config && config.chat && config.chat.countryCode) || "91";
    var phone = normalizePhone(el.getAttribute("data-phone"), cc) || fallbackPhone();

    if (type === "product" || type === "share") {
      var text = fillMessage(el.getAttribute("data-message"), { product: el.getAttribute("data-product"), url: cleanUrl() });
      if (type === "product" && !phone) return console.warn("[PingZest] Add a WhatsApp number in the app or block settings.");
      track(type, "click");
      return openLink(waLink(type === "product" ? phone : null, text));
    }

    if (!phone) return console.warn("[PingZest] Add a WhatsApp number in the app or block settings.");
    track("cart", "click");
    var win = PREVIEW ? null : window.open("", "_blank");
    fetch(page.root + "cart.js", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; })
      .then(function (cart) {
        var url = waLink(phone, cartMessage(cart, {
          intro: el.getAttribute("data-intro"), outro: el.getAttribute("data-outro"),
          empty: el.getAttribute("data-empty"), currency: el.getAttribute("data-currency") || page.currency,
        }));
        if (PREVIEW) return openLink(url);
        if (win) { win.opener = null; win.location.href = url; } else window.location.href = url;
      });
  }

  function onOptInChange(e) {
    var el = e.target;
    if (!el.matches || !el.matches('input[data-wa-widget="optin"]')) return;
    if (PREVIEW) return;
    fetch(page.root + "cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ attributes: { "WhatsApp updates": el.checked ? "yes" : "no" } }),
    }).catch(function () { el.checked = !el.checked; });
  }

  /* ---------- boot ---------- */

  var mounted = false;
  function init() {
    loadContext();
    if (!mounted) {
      mounted = true;
      mountDiscount();
      mountChat();
    }
    styleButtons();
  }

  document.addEventListener("click", onButtonClick);
  document.addEventListener("change", onOptInChange);
  document.addEventListener("shopify:section:load", styleButtons); // theme editor
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.WAWidgets = {
    loaded: true,
    normalizePhone: normalizePhone,
    waLink: waLink,
    fillMessage: fillMessage,
    isOpen: isOpen,
    matchesPage: matchesPage,
    pathMatches: pathMatches,
    cartMessage: cartMessage,
    formatMoney: formatMoney,
    discountApplyUrl: discountApplyUrl,
  };
})();
