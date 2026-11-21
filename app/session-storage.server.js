import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { Session } from "@shopify/shopify-api";

/**
 * PrismaSessionStorage plus expiring offline access tokens.
 *
 * Shopify's Admin API rejects non-expiring offline tokens ("Non-expiring access tokens are no longer
 * accepted"), so the app uses expiring ones (future.expiringOfflineAccessTokens in shopify.server.js).
 * They last about an hour and are renewed with a refresh token, which the installed storage version
 * doesn't save; this subclass stores it so webhooks and the public confirm page keep working.
 *
 * Installs that still have an old non-expiring token are migrated the first time it's loaded
 * (Shopify's token exchange for offline tokens), so nobody has to reopen the app.
 */
export class PingZestSessionStorage extends PrismaSessionStorage {
  /** Shops whose offline token is known to be the expiring kind (checked once per process). */
  #offlineOk = new Set();
  #migrating = new Map();

  sessionToRow(session) {
    return {
      ...super.sessionToRow(session),
      refreshToken: session.refreshToken || null,
      refreshTokenExpires: session.refreshTokenExpires ? new Date(session.refreshTokenExpires) : null,
    };
  }

  rowToSession(row) {
    const session = super.rowToSession(row);
    if (row.refreshToken) session.refreshToken = row.refreshToken;
    if (row.refreshTokenExpires) session.refreshTokenExpires = new Date(row.refreshTokenExpires);
    return session;
  }

  async loadSession(id) {
    const session = await super.loadSession(id);
    if (!session) return session;
    if (!session.isOnline) return session.expires ? session : this.#migrate(session);
    if (!this.#offlineOk.has(session.shop)) {
      const offlineId = `offline_${session.shop}`;
      const offline = await this.loadSession(offlineId); // migrates a legacy token if needed
      const refreshDead = offline?.refreshTokenExpires && new Date(offline.refreshTokenExpires) < new Date();
      // No usable offline token: hide the online session so the library runs a token exchange,
      // which stores a new offline token as well.
      if (!offline || refreshDead) return undefined;
      this.#offlineOk.add(session.shop);
    }
    return session;
  }

  async findSessionsByShop(shop) {
    const sessions = await super.findSessionsByShop(shop);
    const out = [];
    for (const s of sessions) {
      if (s.isOnline || s.expires) out.push(s);
      else {
        const migrated = await this.#migrate(s);
        if (migrated) out.push(migrated);
      }
    }
    return out;
  }

  async storeSession(session) {
    const ok = await super.storeSession(session);
    if (!session.isOnline) this.#offlineOk.delete(session.shop); // re-check on next load
    return ok;
  }

  /** Swap a non-expiring offline token for an expiring one (one request per shop at a time). */
  #migrate(legacy) {
    if (!this.#migrating.has(legacy.shop)) {
      const job = migrateOfflineToken(legacy)
        .then(async (session) => {
          if (session) await this.storeSession(session);
          return session;
        })
        .catch((e) => {
          console.error("offline token migration failed", legacy.shop, e?.message);
          return undefined;
        })
        .finally(() => this.#migrating.delete(legacy.shop));
      this.#migrating.set(legacy.shop, job);
    }
    return this.#migrating.get(legacy.shop);
  }
}

/**
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens
 * Token exchange with the old offline token as the subject; returns the new expiring Session or undefined.
 */
export async function migrateOfflineToken(legacy) {
  const res = await fetch(`https://${legacy.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: legacy.accessToken,
      subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
      requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
      expiring: "1",
    }),
  });
  if (!res.ok) {
    console.error("offline token migration refused", legacy.shop, res.status);
    return undefined;
  }
  const body = await res.json();
  const now = Date.now();
  return new Session({
    id: legacy.id,
    shop: legacy.shop,
    state: legacy.state || "",
    isOnline: false,
    scope: body.scope,
    accessToken: body.access_token,
    expires: body.expires_in ? new Date(now + body.expires_in * 1000) : undefined,
    refreshToken: body.refresh_token,
    refreshTokenExpires: body.refresh_token_expires_in ? new Date(now + body.refresh_token_expires_in * 1000) : undefined,
  });
}
