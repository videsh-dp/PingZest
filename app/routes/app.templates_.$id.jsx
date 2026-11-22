/**
 * One message template in its own page: /app/templates/<id>, or /app/templates/new?type=&lang=&from=
 * (from = standard | blank | starter number). Breadcrumb back to the list; saving uses Shopify's save bar.
 */
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { customTemplateAllowance } from "../models/templates.server";
import { templateAction } from "../models/template-actions.server";
import prisma from "../db.server";
import { TEMPLATE_TYPES, LANGUAGES, DEFAULT_TEMPLATES, STARTER_TEMPLATES } from "../lib/templates.js";
import { translationEnabled } from "../lib/translate.js";
import { flagOn } from "../posthog.server";
import { toId } from "../lib/ids.js";
import { Page, Card } from "../components/ui";
import { TemplateEditor } from "../components/TemplateEditor";
import { useT } from "../i18n/react.jsx";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const [settings, allowance] = await Promise.all([getSettings(shop), customTemplateAllowance(shop)]);
  let template = null;
  if (params.id === "new") {
    const type = TEMPLATE_TYPES[url.searchParams.get("type")] ? url.searchParams.get("type") : "cod_confirm";
    const lang = LANGUAGES[url.searchParams.get("lang")] ? url.searchParams.get("lang") : "en";
    const from = url.searchParams.get("from") || "standard";
    const starter = from === "blank" ? ["", ""] : from === "standard" ? [null, DEFAULT_TEMPLATES[type][lang] || DEFAULT_TEMPLATES[type].en] : STARTER_TEMPLATES[type]?.[lang]?.[Number(from)] || ["", ""];
    template = { id: null, type, lang, name: starter[0], body: starter[1], isDefault: false, standardCopy: from === "standard" };
  } else {
    const id = toId(params.id);
    const t = id ? await prisma.messageTemplate.findFirst({ where: { id, shop } }) : null;
    if (!t) throw new Response("Template not found", { status: 404 });
    template = { id: t.id, type: t.type, lang: t.lang, name: t.name, body: t.body, isDefault: t.isDefault };
  }
  return {
    template,
    storeName: settings.storeName || "Your Store",
    canTranslate: translationEnabled() && (await flagOn(shop, "google-translate")),
    allowance,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return templateAction(session.shop, Object.fromEntries(await request.formData()));
};

export default function TemplatePage() {
  const tr = useT();
  const { template: t, storeName, canTranslate, allowance } = useLoaderData();
  const navigate = useNavigate();
  const template = t.standardCopy ? { ...t, name: tr("Standard copy") } : t;
  const listUrl = `/app/templates?type=${template.type}&lang=${template.lang}`;
  const isNew = !template.id;
  return (
    <Page
      title={isNew ? tr("New template") : tr("Edit “{name}”", { name: template.name })}
      subtitle={`${tr(TEMPLATE_TYPES[template.type].label)} · ${LANGUAGES[template.lang]}`}
      backTo={{ to: listUrl, label: tr("Message templates") }}
    >
      {isNew && !allowance.canCreate ? (
        <Card><p className="wa-warn">{tr("You've used all {limit} custom templates on the Free plan. Delete one, or upgrade to PingZest Pro for unlimited templates.", { limit: allowance.limit })}</p></Card>
      ) : (
        <Card>
          <TemplateEditor
            key={template.id ?? "new"}
            template={template}
            type={template.type}
            lang={template.lang}
            storeName={storeName}
            canTranslate={canTranslate}
            canCreate={allowance.canCreate}
            onDone={(newId) => navigate(newId ? `/app/templates/${newId}` : listUrl, { replace: !newId })}
          />
        </Card>
      )}
    </Page>
  );
}
