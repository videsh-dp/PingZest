/**
 * PostHog in the browser: page views, clicks, and JavaScript errors (error tracking).
 * Privacy: text and attributes of clicked elements are masked (queues show customer names and
 * phones), and session recording is off. The shop is identified in app.jsx.
 */
const SNIPPET =
  '!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once unregister getFeatureFlag isFeatureEnabled reloadFeatureFlags onFeatureFlags identify setPersonProperties group resetGroups reset get_distinct_id alias set_config captureException opt_in_capturing opt_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);';

export function PostHogScript({ config }) {
  const options = {
    api_host: config.host,
    person_profiles: "identified_only",
    capture_pageview: "history_change",
    capture_exceptions: true,
    disable_session_recording: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
  };
  const js = `${SNIPPET}posthog.init(${JSON.stringify(config.key)},${JSON.stringify(options)});`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}

/** Report an error caught by an error boundary (the browser SDK catches the rest by itself). */
export function reportError(error, extra = {}) {
  try {
    if (typeof window !== "undefined" && window.posthog?.captureException) window.posthog.captureException(error, extra);
  } catch { /* never break the page */ }
}
