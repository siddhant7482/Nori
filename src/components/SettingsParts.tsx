"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteRule, setBudget, setPaydayRule, setVoice, syncNow } from "@/app/actions";
import { gbp } from "@/lib/format";
import { toast } from "./toast";

function useAct() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn();
      toast(r.message);
      if (r.ok) router.refresh();
    });
  return { busy, run };
}

/* ---------- the first sync, racing Monzo's five-minute window ---------- */
type First = { state: "waiting"; secondsLeft: number } | { state: "syncing" } | { state: "done"; fetched: number; fullHistory: boolean } | { state: "error"; message: string };

export function FirstSync({ fresh }: { fresh: boolean }) {
  const router = useRouter();
  const [s, setS] = useState<First>({ state: "waiting", secondsLeft: 300 });
  const stopped = useRef(false);
  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = (await fetch("/api/monzo/first-sync", { method: "POST" }).then((x) => x.json())) as First;
        if (stopped.current) return;
        setS(r);
        if (r.state === "done") {
          toast(`Synced ${r.fetched} transactions${r.fullHistory ? ", your whole history" : ", the last 90 days"}. Everything on Home is yours now.`);
          router.refresh();
          return;
        }
      } catch {
        /* a dropped poll is not a failure; the next one tries again */
      }
      timer = setTimeout(tick, 3000);
    };
    tick();
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [router]);

  return (
    <div className="wait" aria-live="polite">
      {s.state === "waiting" && (
        <>
          <b>Approve Nori in your Monzo app.</b>
          <span>Monzo has sent a notification to your phone. Nori can&apos;t read anything until you approve it there. {fresh ? "The moment you do, the first sync starts on its own; leave this page open." : "Leave this page open; it checks every few seconds."}</span>
          {s.secondsLeft > 0 && <span className="eb">Full-history window: about <span className="num" style={{ fontSize: ".9rem" }}>{Math.floor(s.secondsLeft / 60)}:{String(s.secondsLeft % 60).padStart(2, "0")}</span> left</span>}
          {s.secondsLeft <= 0 && <span className="eb">The full-history window has probably closed. Nori will still take the last 90 days.</span>}
        </>
      )}
      {s.state === "syncing" && (
        <>
          <b>Approved. Reading your history…</b>
          <span>Every transaction since the account opened, a hundred at a time. Usually under a minute.</span>
        </>
      )}
      {s.state === "error" && (
        <>
          <b>The first sync failed.</b>
          <span>{s.message}</span>
        </>
      )}
      {s.state === "done" && <b>Done. {s.fetched} transactions read.</b>}
    </div>
  );
}

export function SyncNow() {
  const { busy, run } = useAct();
  return (
    <button className="btn ghost" type="button" disabled={busy} onClick={() => run(syncNow)}>
      {busy ? "Syncing…" : "Sync now"}
    </button>
  );
}

/* ---------- budgets ---------- */
interface BudgetCat {
  id: string;
  name: string;
  hex: string;
  limit: number;
  fixed: boolean;
  suggested: number | null;
}

export function Budgets({ cats }: { cats: BudgetCat[] }) {
  return (
    <div>
      {cats.map((c) => <BudgetRow key={c.id + c.limit} c={c} />)}
    </div>
  );
}

function BudgetRow({ c }: { c: BudgetCat }) {
  const { busy, run } = useAct();
  const [v, setV] = useState(c.limit ? String(c.limit / 100) : "");
  const id = "lim-" + c.id;
  return (
    <div className="bud-row">
      <span className="nm"><i className="sw" style={{ background: c.hex }} />{c.name}{c.fixed ? <span className="tag mute" style={{ marginLeft: ".5rem" }}>FIXED</span> : null}</span>
      <form
        className="edit"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => setBudget(c.id, v || "0"));
        }}
      >
        <label htmlFor={id}>£</label>
        <input id={id} value={v} inputMode="decimal" placeholder="not set" onChange={(e) => setV(e.target.value)} />
        <button type="submit" disabled={busy}>Save</button>
      </form>
      <span className="hint">
        {c.suggested ? (
          <>
            The last three cycles averaged {gbp(c.suggested)}.{" "}
            {c.suggested !== c.limit && (
              <button type="button" disabled={busy} onClick={() => { setV(String(c.suggested! / 100)); run(() => setBudget(c.id, String(c.suggested! / 100))); }}>
                Use {gbp(c.suggested)}
              </button>
            )}
          </>
        ) : c.fixed ? "Rent, council tax and the like: known in advance, so not in the daily number." : "No history yet to suggest a number from."}
      </span>
    </div>
  );
}

/* ---------- payday rule ---------- */
export function PaydayRule({ value, detected }: { value: string; detected: string | null }) {
  const { busy, run } = useAct();
  const doms = Array.from({ length: 31 }, (_, i) => i + 1);
  return (
    <label className="field" htmlFor="pay-rule" style={{ marginTop: "1rem" }}>
      The rule
      <select id="pay-rule" value={value} disabled={busy} onChange={(e) => run(() => setPaydayRule(e.target.value))}>
        <option value="auto">Follow my salary{detected ? ` (${detected})` : ""}</option>
        <option value="lwd">The last working day of the month</option>
        {doms.map((d) => <option key={d} value={`dom:${d}`}>The {d}{d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}, or the Friday before a weekend</option>)}
        <option value="calendar">The calendar month, ignore payday</option>
      </select>
    </label>
  );
}

/* ---------- voice ---------- */
type V = "clean" | "direct" | "warden";
export function VoiceDial({ value, preview }: { value: V; preview: Record<V, { head: string; body: string; afford: string }> }) {
  const { busy, run } = useAct();
  const [v, setV] = useState<V>(value);
  const opts: [V, string, string][] = [["clean", "Clean", "facts, politely"], ["direct", "Direct", "facts, and what they mean"], ["warden", "Warden", "one swear, well placed"]];
  return (
    <>
      <div className="dial" role="radiogroup" aria-label="Voice">
        {opts.map(([k, name, sub]) => (
          <label key={k}>
            <input type="radio" name="voice" value={k} checked={v === k} disabled={busy} onChange={() => { setV(k); run(() => setVoice(k)); }} />
            {name}
            <span>{sub}</span>
          </label>
        ))}
      </div>
      <div className="preview" aria-live="polite">
        <h4>{preview[v].head}</h4>
        <p>{preview[v].body}</p>
        {preview[v].afford && (
          <p style={{ marginTop: ".4rem" }}>
            <span className="eb">A £60 spend, asked</span>
            <br />
            {preview[v].afford}
          </p>
        )}
      </div>
    </>
  );
}

/* ---------- learned rules ---------- */
export function RuleList({ rules }: { rules: { id: number; label: string; match: string; cat: string; at: string }[] }) {
  const { busy, run } = useAct();
  if (!rules.length) return <p className="empty">None yet. File a payment in Transactions and the first one appears here.</p>;
  return (
    <div className="lt-w">
      <table className="lt">
        <thead><tr><th>Shop</th><th>Matches</th><th>Files it as</th><th>Since</th><th></th></tr></thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td>{r.label}</td>
              <td className="m">{r.match}</td>
              <td>{r.cat}</td>
              <td>{r.at}</td>
              <td><button className="lnk" type="button" disabled={busy} onClick={() => run(() => deleteRule(r.id))}>Forget</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
