"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { fileTransaction } from "@/app/actions";
import { gbp } from "@/lib/format";
import { short, withDay } from "@/lib/london";
import { Hd } from "./bits";
import { toast } from "./toast";

export interface TxRow {
  id: string;
  day: string;
  time: string;
  amount: number;
  kind: "spend" | "refund" | "income" | "pot" | "transfer" | "ignored";
  categoryId: string | null;
  filedBy: "you" | "rule" | "monzo" | null;
  description: string;
  label: string;
  merchantGroupId: string | null;
  monzoCategory: string | null;
  pending: boolean;
  notes: string | null;
}

interface Cat {
  id: string;
  name: string;
  hex: string;
  fixed: boolean;
}

type Show = "all" | "spend" | "unfiled" | "in";
const SHOWS: [Show, string][] = [["all", "All"], ["spend", "Spending"], ["unfiled", "Unfiled"], ["in", "Money in & pots"]];
const isSpend = (t: TxRow) => t.kind === "spend" || t.kind === "refund";
const isUnfiled = (t: TxRow) => isSpend(t) && !t.categoryId;
const KIND_TAG: Partial<Record<TxRow["kind"], [string, string]>> = {
  income: ["MONEY IN", ""],
  pot: ["NOT SPENDING", "mute"],
  transfer: ["BETWEEN YOUR ACCOUNTS", "mute"],
  ignored: ["DECLINED", "mute"],
  refund: ["REFUND", ""],
};

export function TxBrowser({ rows, cats, offset, hasEarlier, initial }: { rows: TxRow[]; cats: Cat[]; offset: number; hasEarlier: boolean; initial: { show: Show; cat: string | null; tx: string | null; q: string } }) {
  const router = useRouter();
  const [show, setShow] = useState<Show>(initial.show);
  const [cat, setCat] = useState<string | null>(initial.cat);
  const [q, setQ] = useState(initial.q);
  const [open, setOpen] = useState<string | null>(initial.tx);
  const [busy, start] = useTransition();
  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);

  useEffect(() => setOpen(initial.tx), [initial.tx]);

  const file = (id: string, categoryId: string | null) =>
    start(async () => {
      const r = await fileTransaction(id, categoryId);
      toast(r.message);
      router.refresh();
    });

  const ql = q.trim().toLowerCase();
  const shown = rows.filter((t) => {
    if (show === "spend" && !isSpend(t)) return false;
    if (show === "unfiled" && !isUnfiled(t)) return false;
    if (show === "in" && !(t.kind === "income" || t.kind === "pot" || t.kind === "transfer")) return false;
    if (cat && t.categoryId !== cat) return false;
    if (ql && !`${t.label} ${t.description} ${t.categoryId ? byId.get(t.categoryId)?.name ?? "" : "unfiled"}`.toLowerCase().includes(ql)) return false;
    return true;
  });
  const days: [string, TxRow[]][] = [];
  for (const t of shown) {
    const last = days[days.length - 1];
    if (last && last[0] === t.day) last[1].push(t);
    else days.push([t.day, [t]]);
  }
  const unfiled = rows.filter(isUnfiled);
  const openTx = rows.find((t) => t.id === open) ?? null;
  const filter = cat ? byId.get(cat) : null;

  return (
    <>
      <div className="toolbar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a shop or a budget: Pret, groceries, Uber…" autoComplete="off" aria-label="Find a transaction" />
        <div className="seg" role="group" aria-label="Show">
          {SHOWS.map(([k, name]) => (
            <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>
              {name}
              {k === "unfiled" && unfiled.length ? <span className="num">{unfiled.length}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {filter && (
        <p className="sub" style={{ margin: 0 }}>
          Only <b>{filter.name}</b>. <button className="lnk" type="button" onClick={() => setCat(null)}>Show everything</button>
        </p>
      )}

      {unfiled.length > 0 && show !== "in" && !filter && (
        <div className="unf">
          <Hd title={`Needs you · ${unfiled.length} unfiled`} right="FILE ONCE, NORI REMEMBERS" />
          {unfiled.map((t) => (
            <div className="unf-row" key={t.id}>
              <span className="m">
                <b>{t.description}</b>
                <span>{withDay(t.day)} · {t.monzoCategory ? `Monzo calls it ${t.monzoCategory.toLowerCase()}, and no budget claims that` : "no rule matches"}</span>
              </span>
              <span className="a">{gbp(-t.amount)}</span>
              <div className="cats">
                {cats.map((c) => (
                  <button key={c.id} type="button" disabled={busy} onClick={() => file(t.id, c.id)}>
                    <i className="sw" style={{ background: c.hex }} />
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="stack" id="tx-list">
        {days.length ? (
          days.map(([day, list]) => {
            const spent = list.filter(isSpend).reduce((n, t) => n - t.amount, 0);
            return (
              <div className="day" key={day}>
                <h4>
                  <span>{withDay(day)}</span>
                  <span>{spent ? `${gbp(spent)} spent` : "no spending"}</span>
                </h4>
                {list.map((t) => (
                  <Row key={t.id} t={t} cat={t.categoryId ? byId.get(t.categoryId) : undefined} onOpen={() => setOpen(t.id)} />
                ))}
              </div>
            );
          })
        ) : (
          <p className="empty">Nothing in this cycle matches{q ? ` "${q}"` : ""}.</p>
        )}
      </div>

      <div className="ft" style={{ display: "flex", gap: "1rem", justifyContent: "space-between" }}>
        {offset > 0 ? <Link className="lnk" href={offset === 1 ? "/transactions" : `/transactions?c=${offset - 1}`}>← Newer cycle</Link> : <span />}
        {hasEarlier ? <Link className="lnk" href={`/transactions?c=${offset + 1}`}>Earlier cycle →</Link> : <span />}
      </div>

      {openTx && <Drawer t={openTx} cats={cats} cat={openTx.categoryId ? byId.get(openTx.categoryId) : undefined} rows={rows} busy={busy} onFile={file} onClose={() => setOpen(null)} />}
    </>
  );
}

function Row({ t, cat, onOpen }: { t: TxRow; cat?: Cat; onOpen: () => void }) {
  const kind = KIND_TAG[t.kind];
  const money = t.kind === "income" || t.kind === "refund" || (t.kind === "transfer" && t.amount > 0) ? "+" + gbp(t.amount) : gbp(-t.amount);
  return (
    <button className="tx" type="button" onClick={onOpen}>
      <span className="m">
        <b>{t.label}</b>
        <span>
          {kind && <span className={"tag " + kind[1]}>{kind[0]}</span>}
          {isSpend(t) && (cat ? <span><i className="sw" style={{ background: cat.hex }} />{cat.name}</span> : <span className="tag over">UNFILED</span>)}
          {t.pending && <span className="tag mute">PENDING</span>}
        </span>
      </span>
      <span className={"a" + (t.kind === "income" ? " in" : t.kind === "pot" || t.kind === "transfer" ? " pot" : "")}>{money}</span>
    </button>
  );
}

function Drawer({ t, cats, cat, rows, busy, onFile, onClose }: { t: TxRow; cats: Cat[]; cat?: Cat; rows: TxRow[]; busy: boolean; onFile: (id: string, c: string | null) => void; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const same = rows.filter((r) => (t.merchantGroupId ? r.merchantGroupId === t.merchantGroupId : r.description === t.description));
  const by = t.filedBy === "you" ? "you filed it" : t.filedBy === "rule" ? "a rule you made files it" : t.filedBy === "monzo" ? `Monzo calls it ${t.monzoCategory?.toLowerCase() ?? "this"}` : "nothing places it yet";
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t.label}>
        <button className="x" type="button" onClick={onClose} autoFocus>Close</button>
        <div className="card cat">
          <div className="c">
            <span>{cat ? (<><i className="sw" style={{ background: cat.hex }} />{cat.name}</>) : isSpend(t) ? "Unfiled" : KIND_TAG[t.kind]?.[0] ?? t.kind}</span>
            {isUnfiled(t) && <em className="tag over">UNFILED</em>}
          </div>
          <div className="a">{t.kind === "income" || t.kind === "refund" ? "+" + gbp(t.amount) : gbp(-t.amount)}</div>
          <div className="of"><b>{t.label}</b> · {withDay(t.day)} · {new Date(t.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}</div>
          {t.label !== t.description && <div className="fb">On the statement: <span className="num">{t.description}</span></div>}
          {t.notes && <div className="fb">Your note in Monzo: {t.notes}</div>}
        </div>
        {isSpend(t) ? (
          <div className="card">
            <label className="field" htmlFor="recat">
              Budget
              <select id="recat" value={t.categoryId ?? ""} disabled={busy} onChange={(e) => onFile(t.id, e.target.value || null)}>
                <option value="">Unfiled</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <p className="fb">In this budget because {by}. Changing it writes a rule, so every {t.label} payment follows.</p>
          </div>
        ) : (
          <div className="card">
            <p className="howto">
              {t.kind === "income" ? <>Money in. If it&apos;s your salary, this is what payday is found from.</> : t.kind === "pot" ? <>Moved to or from one of your pots. <b>Not spending</b>, and never counted against a budget.</> : t.kind === "transfer" ? <>Between your own accounts. Money moving, not money going.</> : <>Declined or zero. It never left the account.</>}
            </p>
          </div>
        )}
        {same.length > 1 && (
          <div className="card">
            <Hd title={`${t.label}, this cycle`} right={`${same.length} · ${gbp(same.reduce((n, r) => n - r.amount, 0))}`} />
            <div className="log">
              {same.map((r) => (
                <div key={r.id} className={"tx" + (r.id === t.id ? " sel" : "")} style={{ padding: ".35rem .4rem" }}>
                  <span className="m"><span>{short(r.day)}</span></span>
                  <span className="a">{gbp(-r.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
