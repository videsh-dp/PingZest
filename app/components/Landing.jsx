/**
 * Public landing + "Log in with Shopify" page, shown when the app URL is opened
 * outside Shopify admin. Merchants sign in with their Shopify account: no separate password.
 */
import { Form } from "react-router";

const FEATURES = [
  ["💬", "WhatsApp chat button", "Your design, your pages, desktop and mobile."],
  ["✅", "COD confirmation", "Customers confirm or cancel in one tap. Fewer returns."],
  ["🏷️", "Discount banner", "Create a code and let shoppers apply it instantly."],
  ["📊", "Analytics", "See what shoppers click and which messages work."],
];

export function Landing({ errors = {}, defaultShop = "", signedOut = false }) {
  return (
    <main className="lp">
      <section className="lp__hero">
        <p className="lp__brand"><span className="lp__logo" aria-hidden="true">●</span> WA Assist</p>
        <h1 className="lp__title">WhatsApp tools for your Shopify store</h1>
        <p className="lp__lead">Chat button, COD confirmation, order updates and a discount banner. Free, with no Meta setup and no per-message fees.</p>
        <ul className="lp__features">
          {FEATURES.map(([icon, title, text]) => (
            <li key={title}><span aria-hidden="true">{icon}</span><div><strong>{title}</strong><span>{text}</span></div></li>
          ))}
        </ul>
      </section>

      <section className="lp__card" aria-labelledby="login-title">
        <h2 id="login-title">Log in with Shopify</h2>
        {signedOut && <p className="lp__ok">You're signed out.</p>}
        <p className="lp__muted">Enter your store address. You'll confirm on Shopify, so there's no new password to remember.</p>
        <Form method="post" action="/auth/login" className="lp__form">
          <label htmlFor="shop" className="lp__label">Store address</label>
          <div className={`lp__input ${errors.shop ? "has-error" : ""}`}>
            <input id="shop" name="shop" defaultValue={defaultShop} placeholder="your-store" autoComplete="on" autoCapitalize="none" spellCheck="false" required />
            <span>.myshopify.com</span>
          </div>
          {errors.shop && <p className="lp__error" role="alert">{errors.shop}</p>}
          <button type="submit" className="lp__btn">Log in with Shopify</button>
        </Form>
        <p className="lp__muted lp__small">New here? Logging in installs the app on your store. You can remove it any time from Shopify admin → Apps.</p>
      </section>
    </main>
  );
}
