/** Actions shared by the Templates list and the template editor page. */
import {
  createTemplate, updateTemplate, duplicateTemplate, setDefaultTemplate, deleteTemplate,
} from "./templates.server";
import { translateTexts } from "../lib/translate.js";
import { toId } from "../lib/ids.js";
import { trackCall } from "../posthog.server";

export async function templateAction(shop, form) {
  const id = toId(form.id);
  if (["update", "duplicate", "default", "delete"].includes(form.intent) && !id) return { error: "Template not found." };
  switch (form.intent) {
    case "create": return createTemplate(shop, form);
    case "update": return updateTemplate(shop, id, form);
    case "duplicate": return duplicateTemplate(shop, id);
    case "default": return setDefaultTemplate(shop, id);
    case "delete": return { ...(await deleteTemplate(shop, id)), deleted: id };
    case "translate": {
      // Draft only: the text comes back into the editor, nothing is saved until the merchant presses Save.
      try {
        const [text] = await trackCall("external_api_call", null, { service: "google_translate", target: String(form.lang), strings: 1 }, () => translateTexts([String(form.body || "")], String(form.lang), String(form.from || "") || undefined));
        return { translatedBody: text, translatedLang: String(form.lang) };
      } catch (e) {
        return { error: e.message };
      }
    }
    default: return { error: "Unknown action" };
  }
}
