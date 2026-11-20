import { useLoaderData, useRouteLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { dashboardStats } from "../models/orders.server";
import { fetchShopName } from "../models/shopify-admin.server";
import prisma from "../db.server";
import { Page, Card, Stat, Banner } from "../components/ui";

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

  const stats = await dashboardStats(shop);
  const templatesSaved = await prisma.messageTemplate.count({ where: { shop } });
  const widgetsSaved = Boolean(await prisma.widgetConfig.findUnique({ where: { shop }, select: { syncedAt: true } }).then((w) => w?.syncedAt));
  return { settings, stats, deepLinks, templatesSaved, widgetsSaved };
};

export default function Index() {
  const { settings, stats, deepLinks, templatesSaved, widgetsSaved } = useLoaderData();
  const app = useRouteLoaderData("routes/app") || {};
  const clicks = stats.clicksByType;
  const totalClicks = Object.values(clicks).reduce((a, b) => a + b, 0);
  const responded = stats.confirmed + stats.cancelled;

  const steps = [
    { done: Boolean(settings.whatsappNumber), title: "Add your store's WhatsApp number", text: "Used for reply links and as the default for widgets.", action: <Link className="wa-button wa-button--secondary" to="/app/settings">Open settings</Link> },
    { done: widgetsSaved, title: "Design your chat button", text: "Pick colours, shape and placement, and choose which pages show it. Live preview included.", action: <Link className="wa-button wa-button--secondary" to="/app/widgets">Open Widgets</Link> },
    { done: false, title: "Turn on WA Assist in your theme", text: "One switch in the theme editor makes your widgets appear in your store.", action: <a className="wa-button wa-button--secondary" href={deepLinks.chat} target="_top">Turn on</a> },
    { done: false, title: "Add “Ask on WhatsApp” to product pages", text: "Shoppers message you with the product already in the chat.", action: <a className="wa-button wa-button--secondary" href={deepLinks.product} target="_top">Add block</a> },
    { done: false, title: "Add “Order on WhatsApp” and the opt-in checkbox to the cart", text: "Takes orders from shoppers who prefer chat, and records WhatsApp consent.", action: <span className="wa-row-gap"><a className="wa-button wa-button--secondary" href={deepLinks.cart} target="_top">Order button</a><a className="wa-button wa-button--secondary" href={deepLinks.optin} target="_top">Opt-in</a></span> },
    { done: templatesSaved > 0, title: "Review your message templates", text: "Defaults are ready in English and Hindi. Adjust the tone to match your store.", action: <Link className="wa-button wa-button--secondary" to="/app/templates">Edit templates</Link> },
  ];

  return (
    <Page title={app.staff ? `Welcome, ${app.staff.split(" ")[0]}` : "WA Assist"} subtitle={`Free plan · ${settings.storeName || app.shop || ""}`}>
      {stats.codTodo > 0 && (
        <Banner tone="attention">
          <strong>{stats.codTodo} COD {stats.codTodo === 1 ? "order needs" : "orders need"} confirmation.</strong>{" "}
          <Link to="/app/cod">Open the queue</Link> and send each one in a click.
        </Banner>
      )}

      <div className="wa-grid wa-grid--4">
        <Stat label="COD to confirm" value={stats.codTodo} to="/app/cod" />
        <Stat label="Waiting for reply" value={stats.codWaiting} to="/app/cod?filter=waiting" />
        <Stat label="Abandoned checkouts sent (30d)" value={stats.cartsSent} hint={`${stats.recovered} recovered`} to="/app/carts" />
        <Stat label="Order updates to send" value={stats.updatesTodo} to="/app/updates" />
      </div>

      <div className="wa-grid wa-grid--2">
        <Card title="COD results, last 30 days">
          <div className="wa-grid wa-grid--3 wa-grid--tight">
            <Stat label="Confirmed" value={stats.confirmed} />
            <Stat label="Cancelled" value={stats.cancelled} hint="returns avoided" />
            <Stat label="Response rate" value={stats.codWaiting + responded ? `${Math.round((responded / (stats.codWaiting + responded)) * 100)}%` : "–"} />
          </div>
          <p className="wa-muted">Each cancelled COD order is a parcel you didn't ship and pay to get back.</p>
        </Card>
        <Card title="Widget clicks, last 30 days">
          <div className="wa-grid wa-grid--4 wa-grid--tight">
            <Stat label="Chat" value={clicks.chat || 0} />
            <Stat label="Product" value={clicks.product || 0} />
            <Stat label="Cart" value={clicks.cart || 0} />
            <Stat label="Discount" value={clicks.discount || 0} />
          </div>
          {totalClicks === 0 ? <p className="wa-muted">No clicks yet. Turn on the widgets below to start.</p> : <Link to="/app/analytics?view=widgets">See full analytics</Link>}
        </Card>
      </div>

      <Card title="Set up in a few minutes">
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

      <Card title="How sending works">
        <p>
          WA Assist prepares every message and opens WhatsApp with it typed in. You press send from your own
          WhatsApp or WhatsApp Business app, so there's no Meta setup and no per-message fees. COD messages
          include a confirm link: when the customer taps Confirm or Cancel, the order is tagged in Shopify automatically.
        </p>
      </Card>
    </Page>
  );
}
