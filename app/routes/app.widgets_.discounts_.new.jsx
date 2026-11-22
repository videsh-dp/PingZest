/**
 * Create a discount code: its own page under Widgets → Discounts (breadcrumb back), saved with Shopify's save bar.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { createDiscount } from "../models/discounts.server";
import { Page, Card, Banner, SaveBar, useFormDirty } from "../components/ui";
import { useT } from "../i18n/react.jsx";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  return createDiscount(session.shop, admin, Object.fromEntries(await request.formData()));
};

export default function NewDiscount() {
  const tr = useT();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const formRef = useRef(null);
  const errors = fetcher.data?.errors || {};
  const created = fetcher.state === "idle" ? fetcher.data?.discount : null;
  const [dirty, discard] = useFormDirty(formRef, "new");
  useEffect(() => {
    if (!created) return;
    window.shopify?.toast?.show?.(tr("{code} is live in your Shopify discounts", { code: created.code }));
    navigate("/app/widgets/discounts");
  }, [created]); // eslint-disable-line react-hooks/exhaustive-deps
  const saving = fetcher.state !== "idle";
  const [leaving, setLeaving] = useState(false);
  useEffect(() => { if (leaving) navigate("/app/widgets/discounts"); }, [leaving]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page
      size="small"
      title={tr("Create a discount code")}
      subtitle={tr("The code is created in your Shopify store. Show it in the discount banner from Widgets.")}
      backTo={{ to: "/app/widgets/discounts", label: tr("Discounts") }}
    >
      {errors.form && <Banner tone="critical">{tr(errors.form)}</Banner>}
      <Card>
        <fetcher.Form method="post" ref={formRef} className="wa-form-grid" id="discount-form">
          <input type="hidden" name="intent" value="create" />
          <label className="wa-field">
            <span className="wa-field__label">{tr("Code")}</span>
            <input className={`wa-input ${errors.code ? "has-error" : ""}`} name="code" placeholder="WELCOME10" required maxLength={30} style={{ textTransform: "uppercase" }} />
            {errors.code && <span className="wa-error">{tr(errors.code)}</span>}
          </label>
          <div className="wa-field">
            <span className="wa-field__label">{tr("Discount")}</span>
            <div className="wa-inline">
              <input className={`wa-input wa-input--num ${errors.value ? "has-error" : ""}`} name="value" type="number" min="1" step="any" placeholder="10" required />
              <select name="kind" className="wa-input wa-input--inline" defaultValue="percentage">
                <option value="percentage">{tr("% off")}</option>
                <option value="fixed">{tr("amount off (₹)")}</option>
              </select>
            </div>
            {errors.value && <span className="wa-error">{tr(errors.value)}</span>}
          </div>
          <label className="wa-field">
            <span className="wa-field__label">{tr("Minimum order (optional)")}</span>
            <input className={`wa-input ${errors.minSubtotal ? "has-error" : ""}`} name="minSubtotal" type="number" min="0" step="any" placeholder={tr("e.g. 999")} />
            {errors.minSubtotal && <span className="wa-error">{tr(errors.minSubtotal)}</span>}
          </label>
          <label className="wa-field">
            <span className="wa-field__label">{tr("Ends on (optional)")}</span>
            <input className={`wa-input ${errors.endsAt ? "has-error" : ""}`} name="endsAt" type="date" />
            {errors.endsAt && <span className="wa-error">{tr(errors.endsAt)}</span>}
          </label>
          <label className="wa-field wa-span2">
            <span className="wa-field__label">{tr("Internal name (optional)")}</span>
            <input className="wa-input" name="title" placeholder={tr("Shown in Shopify admin → Discounts")} maxLength={80} />
          </label>
          <label className="wa-check wa-span2">
            <input type="checkbox" name="oncePerCustomer" defaultChecked /> {tr("Each customer can use it once")}
          </label>
        </fetcher.Form>
        <p className="wa-muted">{tr("Applies to all products and all customers. Can be combined with free shipping offers, not with other discounts.")}</p>
      </Card>
      <SaveBar
        id="discount-save-bar"
        dirty={dirty || saving}
        guard={dirty && !created && !leaving}
        saving={saving}
        onSave={() => { const f = formRef.current; if (f.reportValidity()) fetcher.submit(f); }}
        onDiscard={() => { discard(); setLeaving(true); }}
      />
      <p className="wa-muted wa-small"><Link to="/app/widgets">{tr("Show it in the discount banner →")}</Link></p>
    </Page>
  );
}
