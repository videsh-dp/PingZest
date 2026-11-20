import { Form, useActionData, useLoaderData, useNavigation, useRouteLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings, saveSettings } from "../models/settings.server";
import { formatPhone } from "../lib/phone.js";
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
  return (
    <label className="wa-field">
      <span className="wa-field__label">{label}</span>
      <input className={`wa-input ${error ? "has-error" : ""}`} name={name} type={type} defaultValue={defaultValue} {...rest} />
      {help && <span className="wa-muted">{help}</span>}
      {error && <span className="wa-error">{error}</span>}
    </label>
  );
}

function Account() {
  const app = useRouteLoaderData("routes/app") || {};
  return (
    <Card title="Account">
      <p>
        Signed in with Shopify{app.staff ? <> as <strong>{app.staff}</strong></> : null} · <span className="wa-code">{app.shop}</span>
      </p>
      <p className="wa-muted">WA Assist uses your Shopify login, so there's no separate password. Staff see the app if they have access to apps in Shopify.</p>
      <Form method="post" action="/app/logout">
        <button type="submit" className="wa-button wa-button--secondary">Sign out of WA Assist</button>
      </Form>
    </Card>
  );
}

export default function Settings() {
  const { settings } = useLoaderData();
  const result = useActionData();
  const nav = useNavigation();
  const errors = result?.errors || {};
  const s = result?.settings || settings;

  return (
    <Page title="Settings">
      {result?.settings && <Banner tone="success">Settings saved.</Banner>}
      <Form method="post">
        <Card title="Store">
          <Field label="Store name used in messages" name="storeName" defaultValue={s.storeName} maxLength={80} />
          <Field
            label="Your WhatsApp number"
            name="whatsappNumber"
            defaultValue={s.whatsappNumber ? formatPhone(s.whatsappNumber) : ""}
            placeholder="+91 98765 43210"
            help="The number you send from. Used for reply links."
            error={errors.whatsappNumber}
            inputMode="tel"
          />
          <Field label="Default country code" name="countryCode" defaultValue={s.countryCode} help="Added to customer numbers typed without one, e.g. 91 for India." inputMode="numeric" maxLength={4} />
          <label className="wa-field">
            <span className="wa-field__label">Default message language</span>
            <select name="defaultLang" defaultValue={s.defaultLang} className="wa-input">
              <option value="en">English</option>
              <option value="hi">Hindi</option>
            </select>
          </label>
        </Card>

        <Card title="COD confirmation">
          <Field label="Tag for confirmed orders" name="confirmedTag" defaultValue={s.confirmedTag} help="Added to the Shopify order when the customer confirms." />
          <Field label="Tag for cancelled orders" name="cancelledTag" defaultValue={s.cancelledTag} help="Filter these in Shopify Orders and cancel them before shipping." />
        </Card>

        <Card title="Abandoned checkouts">
          <Field label="Show checkouts after (minutes)" name="abandonDelayMin" type="number" min={10} max={1440} defaultValue={s.abandonDelayMin} help="Gives shoppers time to finish on their own first." />
        </Card>

        <div className="wa-sticky-actions">
          <button type="submit" className="wa-button wa-button--primary" disabled={nav.state !== "idle"}>
            {nav.state !== "idle" ? "Saving…" : "Save settings"}
          </button>
        </div>
      </Form>
      <Account />
    </Page>
  );
}
