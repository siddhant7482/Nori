import { Hd, Head } from "@/components/bits";
import Link from "next/link";
import { FirstSync, PaydayRule, RuleList, SyncNow, VoiceDial } from "@/components/SettingsParts";
import { allRules, getPicture, lastRuns } from "@/lib/data";
import { gbp } from "@/lib/format";
import { short, withDay } from "@/lib/london";
import { affordInput, afford, affordText } from "@/lib/month";
import { describeRule } from "@/lib/payday";
import { hasEncryptionKey } from "@/lib/crypto";
import { isConfigured } from "@/monzo/oauth";
import { logout } from "@/app/login/actions";
import { SESSION_DAYS } from "@/lib/session";

/* ============================================================
   0 · SETTINGS. Nothing here moves money: the Monzo connection is
   read-only, and every setting is a way of reading the same feed.
   ============================================================ */

export const dynamic = "force-dynamic";

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const pic = await getPicture();
  const m = pic.month;
  const [ruleRows, runs] = await Promise.all([allRules(), lastRuns(5)]);
  const catName = new Map(m.cats.map((c) => [c.id, c.name]));

  const sample = afford(affordInput(m), 6000, null);
  const preview = Object.fromEntries(
    (["clean", "direct", "warden"] as const).map((v) => [v, { ...m.said[v], afford: sample ? affordText(sample, v, m.cycle.daysLeft) : "" }]),
  ) as Record<"clean" | "direct" | "warden", { head: string; body: string; afford: string }>;

  return (
    <>
      <Head title="Settings" meta="READ-ONLY · NOTHING HERE MOVES MONEY" />

      <div className="row even">
        <div className="card" id="monzo">
          <Hd title="Monzo" right={pic.conn.approved ? <span className="tag">CONNECTED</span> : pic.conn.connected ? <span className="tag story">APPROVE IN APP</span> : <span className="tag mute">NOT CONNECTED</span>} />
          {!pic.conn.connected ? (
            <>
              <p className="sub">Nori reads your Monzo account and nothing else. The first sync has to happen within about five minutes of you approving it in the Monzo app, because that is the only time Monzo serves history older than 90 days. Nori starts it the moment you approve.</p>
              {!isConfigured() || !hasEncryptionKey() ? (
                <>
                  <p className="howto">Before connecting, Nori needs its own Monzo client:</p>
                  <ol className="steps">
                    <li>At <b>developers.monzo.com</b>, sign in and open <b>Clients → New OAuth Client</b>.</li>
                    <li>Choose <b>Confidential</b>. Only confidential clients get refresh tokens; without one Nori loses access every six hours.</li>
                    <li>Set the redirect URL to <code>{process.env.MONZO_REDIRECT_URI || "http://nori.hq.<your domain>/api/monzo/callback"}</code>.</li>
                    <li>Put the client ID and secret in Nori&apos;s <code>.env.local</code> as <code>MONZO_CLIENT_ID</code> and <code>MONZO_CLIENT_SECRET</code>{hasEncryptionKey() ? "" : <>, with a <code>TOKEN_ENCRYPTION_KEY</code></>}, and restart Nori.</li>
                  </ol>
                  <p className="sub" style={{ marginTop: ".8rem" }}>Missing now: {[!process.env.MONZO_CLIENT_ID && "client ID", !process.env.MONZO_CLIENT_SECRET && "client secret", !process.env.MONZO_REDIRECT_URI && "redirect URL", !hasEncryptionKey() && "encryption key"].filter(Boolean).join(", ")}.</p>
                </>
              ) : (
                <div className="ft"><a className="btn" href="/api/monzo/connect">Connect Monzo</a></div>
              )}
              {pic.conn.example && <p className="sub" style={{ marginTop: ".8rem" }}>Until then every figure is the example cycle. Connecting replaces it with your own.</p>}
            </>
          ) : !pic.conn.approved ? (
            <FirstSync fresh={sp.monzo === "approve"} />
          ) : (
            <>
              <div className="pay">
                <div className="ln"><span>History</span><span className="num">{pic.conn.historyFrom ? "from " + short(pic.conn.historyFrom.toISOString().slice(0, 10)) + " " + pic.conn.historyFrom.getFullYear() : "none yet"}{pic.conn.fullHistory ? " · all of it" : " · last 90 days"}</span></div>
                <div className="ln"><span>Last sync</span><span className="num">{pic.conn.lastSyncAt ? pic.conn.lastSyncAt.toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }) : "never"}</span></div>
                <div className="ln"><span>Checks for new payments</span><span className="num">every 5 min</span></div>
              </div>
              {pic.conn.lastError && <p className="sub" style={{ marginTop: ".8rem", color: "var(--over-ink)" }}>Last sync failed: {pic.conn.lastError}</p>}
              {!pic.conn.fullHistory && <p className="sub" style={{ marginTop: ".8rem" }}>The first sync only reached the last 90 days: the five-minute window closed before it finished. What&apos;s here is kept; older months can only come back by connecting again inside that window.</p>}
              <div className="ft" style={{ marginTop: ".8rem" }}><SyncNow /></div>
            </>
          )}
          <div className="can" style={{ marginTop: "1rem" }}>
            <div><span className="eb">Nori reads</span><ul><li>Accounts and balance</li><li>Transactions</li><li>Pots, and what moves into them</li></ul></div>
            <div className="no"><span className="eb">Nori never calls</span><ul><li>Moves into or out of pots</li><li>Anything that writes to your feed</li><li>Anything that sends money</li></ul></div>
          </div>
          <p className="sub" style={{ marginTop: ".8rem" }}>Nori&apos;s Monzo client only has read calls in it. The one other thing it ever sends to Monzo is its own login.</p>
        </div>

        <div className="stack">
          <div className="card" id="payday">
            <Hd title="Payday" right={pic.pay ? "FOUND, NOT TYPED" : "NOT FOUND YET"} />
            {pic.pay ? (
              <>
                <p className="sub">Your salary from <b>{pic.pay.payer}</b>, found in {pic.pay.days.length} payments. Budgets run salary to salary, so a cycle ends the day before the next one lands. The rule that fits: {describeRule(pic.pay.rule)}.</p>
                <div className="pay">
                  {pic.pay.days.slice(-6).map((d, i, a) => (
                    <div className="ln" key={d}><span>{withDay(d)}</span><span className="num">{gbp(pic.pay!.amounts[pic.pay!.amounts.length - a.length + i])}</span></div>
                  ))}
                  <div className="ln tot"><span>Next, predicted</span><span className="num">{withDay(m.cycle.nextPayday)}</span></div>
                </div>
              </>
            ) : (
              <p className="sub">No salary found yet: that takes two monthly payments of at least £300 from the same payer. Until then cycles follow the calendar month.</p>
            )}
            <PaydayRule value={pic.paydayRule} detected={pic.pay ? describeRule(pic.pay.rule) : null} />
          </div>
          <div className="card">
            <Hd title="What Nori will never do" />
            <p className="howto">Text you. Email you. Message a friend. Nudge whoever owes you money.</p>
            <p className="howto" style={{ marginTop: ".7rem", color: "var(--t2)" }}>The pressure lives in here and on your CommandHQ hub, nowhere else. It is the same arithmetic Warden uses, without Warden&apos;s witnesses.</p>
          </div>
          <div className="card">
            <Hd title="This device" right={`SIGNED IN FOR ${SESSION_DAYS} DAYS`} />
            <p className="sub">Nori asks for its password once per device, then remembers it. Lost a phone? Changing Nori&apos;s session secret on the node signs every device out at once.</p>
            <form action={logout}><button className="btn ghost" type="submit">Sign out here</button></form>
          </div>
        </div>
      </div>

      <div className="card" id="budgets">
        <Hd title="Budgets" right="ON THE BUDGETS SCREEN" />
        <p className="sub">Budgets are set where you can see what they are doing: <Link className="lnk" href="/budgets#set">open Budgets</Link>. {m.cats.filter((c) => !c.fixed && !c.limit).length ? "Some have no budget yet, so they aren't in the daily number." : "All of them are set."}</p>
      </div>

      <div className="card">
        <Hd title="Voice" right="HOW HARD NORI SAYS IT" />
        <p className="sub">Same numbers, three ways of saying them. It changes every message in Nori and on the hub.</p>
        <VoiceDial value={pic.voice} preview={preview} />
      </div>

      <div className="card">
        <Hd title="Rules Nori learned" right={`${ruleRows.length} RULE${ruleRows.length === 1 ? "" : "S"}`} />
        <p className="sub">Monzo names most shops itself. When it can&apos;t, or files one somewhere you disagree with, you file it once and a rule is written for you.</p>
        <RuleList rules={ruleRows.map((r) => ({ id: r.id, label: r.label, match: r.merchantGroupId ? "every branch Monzo groups together" : r.pattern ?? "", cat: catName.get(r.categoryId) ?? r.categoryId, at: short(r.createdAt.toISOString().slice(0, 10)) }))} />
      </div>

      {runs.length > 0 && (
        <div className="card">
          <Hd title="Recent syncs" right="THE LAST FIVE" />
          <div className="lt-w">
            <table className="lt">
              <thead><tr><th>When</th><th>Kind</th><th>Read</th><th>Result</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.startedAt.toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "medium" })}</td>
                    <td>{r.mode === "full" ? "first sync" : "recent"}</td>
                    <td>{r.fetched}</td>
                    <td className={r.ok === false ? "o" : r.ok ? "g" : "m"}>{r.ok === null ? "running" : r.ok ? "ok" : (r.detail ?? "failed").slice(0, 60)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
