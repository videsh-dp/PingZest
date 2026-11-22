import { Form, useActionData, useLoaderData, useNavigation, useRouteLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings, saveSettings } from "../models/settings.server";
import { formatPhone } from "../lib/phone.js";
import { LOCALES } from "../i18n/core.js";
import { useT } from "../i18n/react.jsx";
import { useEffect } from "react";
import { Page, Card, Banner, TabBar, useTabState } from "../components/ui";
import { Link } from "react-router";
import { hasFeature, planOf } from "../lib/plans.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return { settings, pro: hasFeature(planOf(settings), "codRisk") };
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
  const { settings, pro } = useLoaderData();
  const result = useActionData();
  const nav = useNavigation();
  const errors = result?.errors || {};
  const s = result?.settings || settings;
  const [tab, setTab] = useTabState(["general", "orders", "pro", "account"]);
  // A field with an error may be on another tab: show it.
  useEffect(() => { if (errors.whatsappNumber) setTab("general"); }, [errors.whatsappNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page
      title={tr("Settings")}
      subtitle={tr("Your store details, how orders are tagged, and the Pro money-savers.")}
      tabs={
        <TabBar
          label={tr("Settings")}
          current={tab}
          onSelect={setTab}
          tabs={[
            { id: "general", label: tr("General") },
            { id: "orders", label: tr("Orders") },
            { id: "pro", label: tr("COD money-savers"), badge: pro ? null : "Pro" },
            { id: "account", label: tr("Account") },
          ]}
        />
      }
    >
      {result?.settings && <Banner tone="success">{tr("Settings saved.")}</Banner>}
      {result?.errors && <Banner tone="critical">{tr("Check the highlighted fields.")}</Banner>}
      {/* One form across the tabs, so Save keeps every field (hidden tabs are still submitted). */}
      <Form method="post" hidden={tab === "account"}>
        <div role="tabpanel" hidden={tab !== "general"}>
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

        </div>
        <div role="tabpanel" hidden={tab !== "orders"}>
        <Card title={tr("COD confirmation")}>
          <Field label={tr("Tag for confirmed orders")} name="confirmedTag" defaultValue={s.confirmedTag} help={tr("Added to the Shopify order when the customer confirms.")} />
          <Field label={tr("Tag for cancelled orders")} name="cancelledTag" defaultValue={s.cancelledTag} help={tr("Filter these in Shopify Orders and cancel them before shipping.")} />
          <Field label={tr("Tag for orders with no reply")} name="noReplyTag" defaultValue={s.noReplyTag} help={tr("Added when an order expires or you mark it No reply.")} />
        </Card>

        <Card title={tr("COD follow-up")}>
          <input type="hidden" name="loopSettings" value="1" />
          <label className="wa-check"><input type="checkbox" name="codHold" defaultChecked={s.codHold} /> {tr("Hold fulfillment of new COD orders until the customer confirms")}</label>
          <p className="wa-muted wa-small">{tr("Shopify shows the order as On hold, so nobody packs it by mistake. PingZest releases the hold when the order is confirmed.")}</p>
          <div className="wa-grid wa-grid--2">
            <Field label={tr("Remind after (hours)")} name="codRemindHours" type="number" min={1} max={168} defaultValue={s.codRemindHours} help={tr("Orders without a reply move to COD confirmation → To remind.")} />
            <Field label={tr("Expire after (hours)")} name="codExpireHours" type="number" min={2} max={720} defaultValue={s.codExpireHours} help={tr("After this, an unanswered order counts as No reply.")} />
          </div>
          <label className="wa-check"><input type="checkbox" name="cancelRestock" defaultChecked={s.cancelRestock} /> {tr("Put items back in stock when PingZest cancels an order in Shopify")}</label>

          <h3 className="wa-h3">{tr("Autopilot")} {!pro && <span className="wa-tab__badge">Pro</span>}</h3>
          {!pro && <p className="wa-muted wa-small">{tr("On Free you expire and cancel orders with one click in COD confirmation.")} <Link to="/app/plan">{tr("See Pro")}</Link></p>}
          <fieldset disabled={!pro} className="wa-fieldset">
            {pro && <input type="hidden" name="loopPro" value="1" />}
            <label className="wa-check"><input type="checkbox" name="codAutoExpire" defaultChecked={s.codAutoExpire} /> {tr("Expire unanswered orders automatically")}</label>
            <label className="wa-check"><input type="checkbox" name="cancelOnCustomer" defaultChecked={s.cancelOnCustomer} /> {tr("Cancel the order in Shopify when the customer cancels")}</label>
            <label className="wa-check"><input type="checkbox" name="cancelOnExpire" defaultChecked={s.cancelOnExpire} /> {tr("Cancel the order in Shopify when it expires")}</label>
            <p className="wa-muted wa-small">{tr("Shipped orders and orders paid online are never cancelled. The customer isn't emailed.")}</p>
          </fieldset>
        </Card>

        <Card title={tr("Abandoned checkouts")}>
          <Field label={tr("Show checkouts after (minutes)")} name="abandonDelayMin" type="number" min={10} max={1440} defaultValue={s.abandonDelayMin} help={tr("Gives shoppers time to finish on their own first.")} />
        </Card>

        </div>
        <div role="tabpanel" hidden={tab !== "pro"}>
        <Card title={tr("COD money-savers (Pro)")}>
          {!pro && (
            <p className="wa-banner wa-banner--info">
              {tr("These run on the Pro plan.")} <Link to="/app/plan">{tr("See Pro")}</Link>
            </p>
          )}
          <fieldset disabled={!pro} className="wa-fieldset">
            {pro && <input type="hidden" name="proSettings" value="1" />}
            <h3 className="wa-h3">{tr("COD risk score")}</h3>
            <label className="wa-check"><input type="checkbox" name="riskTagHigh" defaultChecked={s.riskTagHigh} /> {tr("Tag high-risk COD orders in Shopify")}</label>
            <Field label={tr("Tag for high-risk orders")} name="riskTag" defaultValue={s.riskTag} />

            <h3 className="wa-h3">{tr("COD → prepaid")}</h3>
            <label className="wa-check"><input type="checkbox" name="prepaidEnabled" defaultChecked={s.prepaidEnabled} /> {tr("Offer “pay online now” on the confirm page")}</label>
            <div className="wa-grid wa-grid--2">
              <Field label={tr("Discount for paying online (%)")} name="prepaidPercent" type="number" min={0} max={30} step="0.5" defaultValue={s.prepaidPercent} help={tr("0 = no discount. Taken off the items, not shipping.")} />
              <Field label={tr("Maximum discount (0 = no limit)")} name="prepaidMaxAmount" type="number" min={0} step="1" defaultValue={s.prepaidMaxAmount} help={tr("In your store currency.")} />
            </div>
            <Field label={tr("Tag for orders paid online")} name="prepaidTag" defaultValue={s.prepaidTag} />
            <p className="wa-muted wa-small">{tr("The customer pays on Shopify's own payment page for the same order. Shopify needs an online payment method set up in Settings → Payments.")}</p>

            <h3 className="wa-h3">{tr("Address check")}</h3>
            <label className="wa-check"><input type="checkbox" name="addressCheck" defaultChecked={s.addressCheck} /> {tr("Let customers fix their address or add a landmark on the confirm page")}</label>
          </fieldset>
        </Card>
        </div>

        <div className="wa-sticky-actions">
          <button type="submit" className="wa-button wa-button--primary" disabled={nav.state !== "idle"}>
            {nav.state !== "idle" ? tr("Saving…") : tr("Save settings")}
          </button>
        </div>
      </Form>
      {tab === "account" && <Account />}
    </Page>
  );
}
