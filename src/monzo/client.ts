/* ============================================================
   The Monzo client. READ-ONLY, and structurally so.

   Monzo's API can move money into and out of pots and write to the
   feed. This file implements none of that: every call below is a GET,
   and the only function that can send one is `get`. The single other
   request Nori ever makes to Monzo is its own login, in oauth.ts.
   There is no code path here that moves a penny — keep it that way.

   Facts this depends on, checked against docs.monzo.com on
   2026-09-19:
   - amounts are integers in minor units; negative is money out
   - GET /transactions takes since (RFC3339 or an object id), before,
     limit (default 30, max 100) and expand[]=merchant
   - pagination by passing the last id seen as `since`
   - the token grants nothing until the owner approves in the app
   - full history is readable for 5 minutes after authentication,
     then only the last 90 days
   ============================================================ */

const API = "https://api.monzo.com";

export class MonzoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  /** Before in-app approval, and after the history window closes. */
  get forbidden() {
    return this.status === 403;
  }
  get unauthorised() {
    return this.status === 401;
  }
}

async function get<T>(token: string, path: string, params: [string, string][] = []): Promise<T> {
  const url = new URL(API + path);
  for (const [k, v] of params) url.searchParams.append(k, v);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (res.ok) return (await res.json()) as T;
    /* Monzo does not publish its rate limit. Back off and retry twice,
     * then give up and let the next five-minute sync try again. */
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    let code = "unknown", message = res.statusText;
    try {
      const body = (await res.json()) as { code?: string; message?: string };
      code = body.code ?? code;
      message = body.message ?? message;
    } catch {}
    throw new MonzoError(res.status, code, `Monzo ${res.status} on ${path}: ${message}`);
  }
}

export interface MonzoAccount {
  id: string;
  type: string;
  description: string;
  created: string;
  closed: boolean;
}

export interface MonzoPot {
  id: string;
  name: string;
  balance: number;
  currency: string;
  goal_amount?: number | null;
  deleted: boolean;
  updated: string;
}

export interface MonzoMerchant {
  id: string;
  group_id?: string;
  name: string;
  category?: string;
}

export interface MonzoTransaction {
  id: string;
  account_id: string;
  amount: number;
  currency: string;
  local_amount?: number;
  local_currency?: string;
  created: string;
  settled?: string;
  description: string;
  category?: string;
  merchant?: MonzoMerchant | string | null;
  counterparty?: { name?: string; user_id?: string; account_id?: string } | null;
  metadata?: Record<string, string>;
  notes?: string;
  is_load?: boolean;
  decline_reason?: string;
  scheme?: string;
  include_in_spending?: boolean;
}

export const monzo = {
  whoami: (t: string) => get<{ authenticated: boolean; client_id: string; user_id: string }>(t, "/ping/whoami"),
  accounts: (t: string) => get<{ accounts: MonzoAccount[] }>(t, "/accounts").then((r) => r.accounts),
  balance: (t: string, accountId: string) => get<{ balance: number; total_balance: number; currency: string }>(t, "/balance", [["account_id", accountId]]),
  pots: (t: string, accountId: string) => get<{ pots: MonzoPot[] }>(t, "/pots", [["current_account_id", accountId]]).then((r) => r.pots),
  transactions: (t: string, accountId: string, since: string, before?: string) =>
    get<{ transactions: MonzoTransaction[] }>(t, "/transactions", [
      ["account_id", accountId],
      ["since", since],
      ...(before ? ([["before", before]] as [string, string][]) : []),
      ["limit", "100"],
      ["expand[]", "merchant"],
    ]).then((r) => r.transactions),
};

export const PAGE = 100;
