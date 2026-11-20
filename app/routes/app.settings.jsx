import { Form, useActionData, useLoaderData, useNavigation, useRouteLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings, saveSettings } from "../models/settings.server";
import { formatPhone } from "../lib/phone.js";
import { LOCALES } from "../i18n/core.js";
import { useT } from "../i18n/react.jsx";
import { Page, Card, Banner } from "../components/ui";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { settings: await getSettings(session.shop) };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const form = Object.fromEntries(await request.formData());
  return saveSettings(session.shop, form);
};

function Field({ label, name, defaultValue, help, error, type = "text", ...rest }) {
  const tr = useT();
  return (
    <label className="wa-field">
      <span className="wa-field__label">{label}</span>
      <input className={`wa-input ${error ? "has-error" : ""}`} name={name} type={type} defaultValue={defaultValue} {...rest} />
      {help && <span className="wa-muted">{help}</span>}
      {error && <span className="wa-error">{tr(error)}</span>}
    </label>
  );
}

function Account() {
  const tr = useT();
  const app = useRouteLoaderData("routes/app") || {};
  return (
    <Card title={tr("Account")}>
      <p>
        {app.staff ? tr("Signed in with Shopify as {name}", { name: app.staff }) : tr("Signed in with Shopify")} · <span className="wa-code">{app.shop}</span>
      </p>
      <p className="wa-muted">{tr("PingZest uses your Shopify login, so there's no separate password. Staff see the app if they have access to apps in Shopify.")}</p>
      <Form method="post" action="/app/logout">
        <button type="submit" className="wa-button wa-button--secondary">{tr("Sign out of PingZest")}</button>
      </Form>
    </Card>
  );
}

export default function Settings() {
  const tr = useT();
  const { settings } = useLoaderData();
  const result = useActionData();
  const nav = useNavigation();
  const errors = result?.errors || {};
  const s = result?.settings || settings;

  return (
    <Page title={tr("Settings")}>
      {result?.settings && <Banner tone="success">{tr("Settings saved.")}</Banner>}
      <Form method="post">
        <Card title={tr("Language")}>
          <label className="wa-field">
            <span className="wa-field__label">{tr("App language")}</span>
            <select name="appLocale" defaultValue={s.appLocale || "auto"} className="wa-input">
              <option value="auto">{tr("Same as my Shopify admin")}</option>
              {Object.entries(LOCALES).map(([code, l]) => <option key={code} value={code}>{l.native}</option>)}
            </select>
            <span className="wa-muted">{tr("The language of this app. Customers always get messages in the language you choose for each message.")}</span>
          </label>
        </Card>
        <Card title={tr("Store")}>
          <Field label={tr("Store name used in messages")} name="storeName" defaultValue={s.storeName} maxLength={80} />
          <Field
            label={tr("Your WhatsApp number")}
            name="whatsappNumber"
            defaultValue={s.whatsappNumber ? formatPhone(s.whatsappNumber) : ""}
            placeholder="+91 98765 43210"
            help={tr("The number you send from. Used for reply links.")}
            error={errors.whatsappNumber}
            inputMode="tel"
          />
          <Field label={tr("Default country code")} name="countryCode" defaultValue={s.countryCode} help={tr("Added to customer numbers typed without one, e.g. 91 for India.")} inputMode="numeric" maxLength={4} />
          <label className="wa-field">
            <span className="wa-field__label">{tr("Default message language")}</span>
            <select name="defaultLang" defaultValue={s.defaultLang} className="wa-input">
              {Object.entries(LOCALES).map(([code, l]) => <option key={code} value={code}>{l.native}</option>)}
            </select>
          </label>
        </Card>

        <Card title={tr("COD confirmation")}>
          <Field label={tr("Tag for confirmed orders")} name="confirmedTag" defaultValue={s.confirmedTag} help={tr("Added to the Shopify order when the customer confirms.")} />
          <Field label={tr("Tag for cancelled orders")} name="cancelledTag" defaultValue={s.cancelledTag} help={tr("Filter these in Shopify Orders and cancel them before shipping.")} />
        </Card>

        <Card title={tr("Abandoned checkouts")}>
          <Field label={tr("Show checkouts after (minutes)")} name="abandonDelayMin" type="number" min={10} max={1440} defaultValue={s.abandonDelayMin} help={tr("Gives shoppers time to finish on their own first.")} />
        </Card>

        <div className="wa-sticky-actions">
          <button type="submit" className="wa-button wa-button--primary" disabled={nav.state !== "idle"}>
            {nav.state !== "idle" ? tr("Saving…") : tr("Save settings")}
          </button>
        </div>
      </Form>
      <Account />
    </Page>
  );
}
