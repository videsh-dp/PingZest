#!/usr/bin/env node
/**
 * Downloads Shopify's Admin GraphQL schema (introspection) for the API version the app uses, so the
 * e2e fake Shopify can reject any query or variables the real Shopify would reject.
 *   node scripts/fetch-admin-schema.mjs /tmp/e2e/admin-schema.json
 */
import { writeFileSync } from "node:fs";
import { ApiVersion } from "@shopify/shopify-app-react-router/server";
import { getIntrospectionQuery } from "graphql";

const version = ApiVersion.October26 || ApiVersion.July26 || ApiVersion.April26 || ApiVersion.January26 || ApiVersion.October25;
const out = process.argv[2] || "/tmp/e2e/admin-schema.json";
const url = `https://shopify.dev/admin-graphql-direct-proxy/${version}`;
const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query: getIntrospectionQuery() }) });
const body = await res.json().catch(() => null);
if (!res.ok || !body?.data?.__schema) {
  console.error(`Could not download the Admin API schema ${version} from ${url}: HTTP ${res.status}`);
  process.exit(1);
}
writeFileSync(out, JSON.stringify(body.data));
console.log(`Admin API schema ${version}: ${body.data.__schema.types.length} types → ${out}`);
