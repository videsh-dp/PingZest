/**
 * Public landing + "Log in with Shopify" page, shown when the app URL is opened
 * outside Shopify admin. Merchants sign in with their Shopify account: no separate password.
 */
import { Form } from "react-router";
import { useT, I18nProvider } from "../i18n/react.jsx";
import { N_, dirOf } from "../i18n/core.js";

const FEATURES = [
  ["💬", N_("WhatsApp chat button"), N_("Your design, your pages, desktop and mobile.")],
  ["✅", N_("COD confirmation"), N_("Customers confirm or cancel in one tap. Fewer returns.")],
  ["🏷️", N_("Discount banner"), N_("Create a code and let shoppers apply it instantly.")],
  ["📊", N_("Analytics"), N_("See what shoppers click and which messages work.")],
];

export function Landing(props) {
  return (
    <I18nProvider locale={props.locale || "en"} dict={props.dict || {}}>
      <div lang={props.locale || "en"} dir={dirOf(props.locale || "en")}><LandingInner {...props} /></div>
    </I18nProvider>
  );
}

function LandingInner({ errors = {}, defaultShop = "", signedOut = false }) {
  const tr = useT();
  return (
    <main className="lp">
      <section className="lp__hero">
        <p className="lp__brand"><span className="lp__logo" aria-hidden="true">●</span> {tr("PingZest")}</p>
        <h1 className="lp__title">{tr("WhatsApp tools for your Shopify store")}</h1>
        <p className="lp__lead">{tr("Chat button, COD confirmation, order updates and a discount banner. Free, with no Meta setup and no per-message fees.")}</p>
        <ul className="lp__features">
          {FEATURES.map(([icon, title, text]) => (
            <li key={title}><span aria-hidden="true">{icon}</span><div><strong>{tr(title)}</strong><span>{tr(text)}</span></div></li>
          ))}
        </ul>
      </section>

      <section className="lp__card" aria-labelledby="login-title">
        <h2 id="login-title">{tr("Log in with Shopify")}</h2>
        {signedOut && <p className="lp__ok">{tr("You're signed out.")}</p>}
        <p className="lp__muted">{tr("Enter your store address. You'll confirm on Shopify, so there's no new password to remember.")}</p>
        <Form method="post" action="/auth/login" className="lp__form">
          <label htmlFor="shop" className="lp__label">{tr("Store address")}</label>
          <div className={`lp__input ${errors.shop ? "has-error" : ""}`}>
            <input id="shop" name="shop" defaultValue={defaultShop} placeholder={tr("your-store")} autoComplete="on" autoCapitalize="none" spellCheck="false" required />
            <span>{tr(".myshopify.com")}</span>
          </div>
          {errors.shop && <p className="lp__error" role="alert">{tr(errors.shop)}</p>}
          <button type="submit" className="lp__btn">{tr("Log in with Shopify")}</button>
        </Form>
        <p className="lp__muted lp__small">{tr("New here? Logging in installs the app on your store. You can remove it any time from Shopify admin → Apps.")}</p>
      </section>
    </main>
  );
}
