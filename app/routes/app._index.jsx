import { useLoaderData, useRouteLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { dashboardStats } from "../models/orders.server";
import { fetchShopName } from "../models/shopify-admin.server";
import { savedSummary } from "../models/rto.server";
import prisma from "../db.server";
import { Page, Card, Stat, Banner } from "../components/ui";
import { useT } from "../i18n/react.jsx";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  let settings = await getSettings(shop);

  // First visit: remember the store name for messages.
  if (!settings.storeName) {
    try {
      const name = await fetchShopName(admin);
      if (name) settings = await prisma.shopSettings.update({ where: { shop }, data: { storeName: name } });
    } catch { /* not critical */ }
  }

  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const editor = `https://${shop}/admin/themes/current/editor`;
  const deepLinks = {
    chat: `${editor}?context=apps&activateAppId=${apiKey}/app-embed`,
    product: `${editor}?template=product&addAppBlockId=${apiKey}/product-button&target=mainSection`,
    cart: `${editor}?template=cart&addAppBlockId=${apiKey}/cart-order&target=mainSection`,
    optin: `${editor}?template=cart&addAppBlockId=${apiKey}/optin&target=mainSection`,
  };

  const [stats, saved] = await Promise.all([dashboardStats(shop), savedSummary(shop, settings, 30)]);
  const templatesSaved = await prisma.messageTemplate.count({ where: { shop } });
  const widgetsSaved = Boolean(await prisma.widgetConfig.findUnique({ where: { shop }, select: { syncedAt: true } }).then((w) => w?.syncedAt));
  return { settings, stats, saved, deepLinks, templatesSaved, widgetsSaved };
};

export default function Index() {
  const tr = useT();
  const { settings, stats, saved, deepLinks, templatesSaved, widgetsSaved } = useLoaderData();
  const app = useRouteLoaderData("routes/app") || {};
  const clicks = stats.clicksByType;
  const totalClicks = Object.values(clicks).reduce((a, b) => a + b, 0);
  const responded = stats.confirmed + stats.cancelled;

  const steps = [
    { done: Boolean(settings.whatsappNumber), title: tr("Add your store's WhatsApp number"), text: tr("Used for reply links and as the default for widgets."), action: <Link className="wa-button wa-button--secondary" to="/app/settings">{tr("Open settings")}</Link> },
    { done: widgetsSaved, title: tr("Design your chat button"), text: tr("Pick colours, shape and placement, and choose which pages show it. Live preview included."), action: <Link className="wa-button wa-button--secondary" to="/app/widgets">{tr("Open Widgets")}</Link> },
    { done: false, title: tr("Turn on PingZest in your theme"), text: tr("One switch in the theme editor makes your widgets appear in your store."), action: <a className="wa-button wa-button--secondary" href={deepLinks.chat} target="_top">{tr("Turn on")}</a> },
    { done: false, title: tr("Add “Ask on WhatsApp” to product pages"), text: tr("Shoppers message you with the product already in the chat."), action: <a className="wa-button wa-button--secondary" href={deepLinks.product} target="_top">{tr("Add block")}</a> },
    { done: false, title: tr("Add “Order on WhatsApp” and the opt-in checkbox to the cart"), text: tr("Takes orders from shoppers who prefer chat, and records WhatsApp consent."), action: <span className="wa-row-gap"><a className="wa-button wa-button--secondary" href={deepLinks.cart} target="_top">{tr("Order button")}</a><a className="wa-button wa-button--secondary" href={deepLinks.optin} target="_top">{tr("Opt-in")}</a></span> },
    { done: templatesSaved > 0, title: tr("Review your message templates"), text: tr("Defaults are ready in 7 languages. Adjust the tone to match your store."), action: <Link className="wa-button wa-button--secondary" to="/app/templates">{tr("Edit templates")}</Link> },
  ];

  return (
    <Page title={app.staff ? tr("Welcome, {name}", { name: app.staff.split(" ")[0] }) : "PingZest"} subtitle={`${app.plan === "pro" ? tr("Pro plan") : tr("Free plan")} · ${settings.storeName || app.shop || ""}`}>
      {stats.codTodo > 0 && (
        <Banner tone="attention">
          <strong>{tr.plural("{count} COD order needs confirmation.", "{count} COD orders need confirmation.", stats.codTodo)}</strong>{" "}
          <Link to="/app/cod">{tr("Open the queue to send each one in a click.")}</Link>
        </Banner>
      )}

      <div className="wa-grid wa-grid--4">
        <Stat label={tr("COD to confirm")} value={stats.codTodo} to="/app/cod" />
        <Stat label={tr("Waiting for reply")} value={stats.codWaiting} to="/app/cod?filter=waiting" />
        <Stat label={tr("Abandoned checkouts sent (30d)")} value={stats.cartsSent} hint={tr("{count} recovered", { count: stats.recovered })} to="/app/carts" />
        <Stat label={tr("Order updates to send")} value={stats.updatesTodo} to="/app/updates" />
      </div>

      <div className="wa-grid wa-grid--2">
        <Card title={tr("COD results, last 30 days")}>
          <div className="wa-grid wa-grid--4 wa-grid--tight">
            <Stat label={tr("Saved on returns")} value={saved.saved == null ? tr.n(saved.avoided) : tr.money(saved.saved, saved.currency)} hint={tr("{count} parcels you didn't ship", { count: tr.n(saved.avoided) })} to="/app/analytics?view=returns" />
            <Stat label={tr("Confirmed")} value={stats.confirmed} />
            <Stat label={tr("Cancelled")} value={stats.cancelled} hint={tr("returns avoided")} />
            <Stat label={tr("Response rate")} value={stats.codWaiting + responded ? tr.pct(responded / (stats.codWaiting + responded)) : "–"} />
          </div>
          <p className="wa-muted">
            {saved.cost == null
              ? tr("Each cancelled COD order is a parcel you didn't ship and pay to get back.")
              : tr("Each COD order you didn't ship after a cancel or no reply saves about {cost} in return costs.", { cost: tr.money(saved.cost, saved.currency) })}{" "}
            <Link to="/app/settings?tab=orders">{tr("Change the cost")}</Link>
          </p>
        </Card>
        <Card title={tr("Widget clicks, last 30 days")}>
          <div className="wa-grid wa-grid--4 wa-grid--tight">
            <Stat label={tr("Chat")} value={clicks.chat || 0} />
            <Stat label={tr("Product")} value={clicks.product || 0} />
            <Stat label={tr("Cart")} value={clicks.cart || 0} />
            <Stat label={tr("Discount")} value={clicks.discount || 0} />
          </div>
          {totalClicks === 0 ? <p className="wa-muted">{tr("No clicks yet. Turn on the widgets below to start.")}</p> : <Link to="/app/analytics?view=widgets">{tr("See full analytics")}</Link>}
        </Card>
      </div>

      <Card title={tr("Set up in a few minutes")}>
        <div className="wa-progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={steps.filter((x) => x.done).length} aria-label={tr("Setup progress")}>
          <span className="wa-progress__bar" style={{ width: `${Math.round((steps.filter((x) => x.done).length / steps.length) * 100)}%` }} />
        </div>
        <p className="wa-muted wa-small">{tr("{done} of {total} done", { done: steps.filter((x) => x.done).length, total: steps.length })}</p>
        <ol className="wa-steps">
          {steps.map((s, i) => (
            <li key={i} className={`wa-step ${s.done ? "is-done" : ""}`}>
              <span className="wa-step__check" aria-hidden="true">{s.done ? "✓" : i + 1}</span>
              <div className="wa-step__body">
                <strong>{s.title}</strong>
                <span className="wa-muted">{s.text}</span>
              </div>
              <div className="wa-step__action">{s.action}</div>
            </li>
          ))}
        </ol>
      </Card>

      <Card title={tr("How sending works")}>
        <p>{tr("PingZest prepares every message and opens WhatsApp with it typed in. You press send from your own WhatsApp or WhatsApp Business app, so there's no Meta setup and no per-message fees. COD messages include a confirm link: when the customer taps Confirm or Cancel, the order is tagged in Shopify automatically.")}</p>
      </Card>
    </Page>
  );
}
