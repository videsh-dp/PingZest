/**
 * Message templates: the list for one stage and language. Each template opens in its own editor page
 * (/app/templates/:id, with a breadcrumb back here).
 */
import { Link, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { listTemplates, customTemplateAllowance } from "../models/templates.server";
import { templateAction } from "../models/template-actions.server";
import prisma from "../db.server";
import { TEMPLATE_TYPES, LANGUAGES, STARTER_TEMPLATES } from "../lib/templates.js";
import { Page, Card, Badge, TabBar, EmptyState } from "../components/ui";
import { useT } from "../i18n/react.jsx";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [templates, usage, allowance] = await Promise.all([
    listTemplates(session.shop),
    prisma.messageLog.groupBy({ by: ["templateId"], where: { shop: session.shop }, _count: { _all: true } }),
    customTemplateAllowance(session.shop),
  ]);
  const sends = Object.fromEntries(usage.map((u) => [u.templateId, u._count._all]));
  return {
    allowance,
    templates: templates.map((t) => ({ id: t.id, type: t.type, lang: t.lang, name: t.name, body: t.body, isDefault: t.isDefault, seeded: t.seeded, sends: sends[t.id] || 0 })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return templateAction(session.shop, Object.fromEntries(await request.formData()));
};

export default function Templates() {
  const tr = useT();
  const { templates, allowance } = useLoaderData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const type = TEMPLATE_TYPES[params.get("type")] ? params.get("type") : "cod_confirm";
  const lang = LANGUAGES[params.get("lang")] ? params.get("lang") : "en";
  const list = templates.filter((t) => t.type === type && t.lang === lang);
  const starters = STARTER_TEMPLATES[type]?.[lang] || [];
  const go = (patch) => {
    const p = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === null ? p.delete(k) : p.set(k, v)));
    navigate(`?${p.toString()}`, { preventScrollReset: true });
  };
  const newLink = (from) => `/app/templates/new?type=${type}&lang=${lang}&from=${from}`;

  return (
    <Page
      size="large"
      title={tr("Message templates")}
      subtitle={tr("Write your own messages for each stage, then pick one in the queue when you send.")}
      primaryAction={allowance.canCreate ? { label: tr("Create template"), to: newLink("standard") } : undefined}
      tabs={
        <TabBar
          label={tr("Message stage")}
          current={type}
          onSelect={(k) => go({ type: k })}
          tabs={Object.entries(TEMPLATE_TYPES).map(([k, meta]) => ({ id: k, label: tr(meta.label), count: templates.filter((t) => t.type === k && t.lang === lang).length }))}
        />
      }
    >
      <Card className="wa-card--list">
        <div className="wa-list__toolbar">
          <label className="wa-picker">
            <span className="wa-muted">{tr("Message language")}</span>
            <select className="wa-input wa-input--inline" value={lang} onChange={(e) => go({ lang: e.target.value })}>
              {Object.entries(LANGUAGES).map(([k, v]) => (
                <option key={k} value={k}>{v} ({templates.filter((x) => x.type === type && x.lang === k).length})</option>
              ))}
            </select>
          </label>
          <span className="wa-muted wa-small wa-list__tools">{tr(TEMPLATE_TYPES[type].help)}</span>
        </div>
        {list.length === 0 ? (
          <EmptyState title={tr("No templates in this language yet")}>{tr("Create one from the standard message or a starter.")}</EmptyState>
        ) : (
          <ul className="wa-tpl-rows">
            {list.map((t) => (
              <li key={t.id}>
                <Link className="wa-tpl-row" to={`/app/templates/${t.id}`}>
                  <span className="wa-tpl-item__name">{t.name}{t.isDefault && <Badge tone="success">{tr("Default")}</Badge>}</span>
                  <span className="wa-tpl-item__body">{t.body.replace(/\s+/g, " ").slice(0, 140)}</span>
                  <span className="wa-muted wa-small">{t.sends ? tr.plural("Sent {count} time", "Sent {count} times", t.sends) : tr("Not used yet")}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={tr("New template")}>
        {allowance.canCreate ? (
          <div className="wa-row-gap">
            <Link className="wa-button wa-button--secondary" to={newLink("standard")}>{tr("Copy of the standard message")}</Link>
            <Link className="wa-button wa-button--secondary" to={newLink("blank")}>{tr("Blank")}</Link>
            {starters.map(([n], i) => <Link key={n} className="wa-button wa-button--secondary" to={newLink(String(i))}>{tr("Starter: {name}", { name: n })}</Link>)}
          </div>
        ) : (
          <p className="wa-warn" data-template-limit>
            {tr("You've used all {limit} custom templates on the Free plan. Delete one, or upgrade to PingZest Pro for unlimited templates.", { limit: allowance.limit })}{" "}
            <Link to="/app/settings/plan">{tr("See Pro")}</Link>
          </p>
        )}
        {allowance.limit != null && (
          <p className="wa-muted wa-small">
            {tr("Custom templates: {used} of {limit} on the Free plan. The Standard template for each stage and language is always included.", { used: allowance.used, limit: allowance.limit })}
          </p>
        )}
      </Card>
    </Page>
  );
}
