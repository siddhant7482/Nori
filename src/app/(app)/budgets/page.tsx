import Link from "next/link";
import { Hd, Head, Sw, TableView } from "@/components/bits";
import { Budgets } from "@/components/SettingsParts";
import { P, Pace } from "@/components/charts";
import { getPicture, suggestedLimits } from "@/lib/data";
import { gbp, round, words } from "@/lib/format";
import { addDays, short, weekdayName, withDay, type Day } from "@/lib/london";
import { catById, dayOfCycle, type CatOut, type Month } from "@/lib/month";
import { describeCadence } from "@/lib/recurring";

/* ============================================================
   4 · BUDGETS. What's left, divided by the days left, and the two
   things that move those figures: money already promised to a bill,
   and money one budget has lent another.
   ============================================================ */

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  const pic = await getPicture();
  const m = pic.month;
  const suggested = await suggestedLimits();
  const spend = m.cats.filter((c) => !c.fixed);
  const bills = m.cats.filter((c) => c.fixed);

  return (
    <>
      <Head title="Budgets" meta={`WHAT'S LEFT ÷ DAYS LEFT · ${m.cycle.daysLeft} DAYS · NOTHING ELSE`} />

      <StillDue m={m} />

      <div className="card">
        <Hd title="The IOU book" right={`${m.ious.length} OPEN · ALL CLEAR ON ${short(m.cycle.nextPayday).toUpperCase()}`} />
        <p className="sub">When a budget runs out, it borrows from the one with the most room. The lender really does have less. Nothing is hidden and nothing is forgiven until payday resets both.</p>
        {m.ious.length ? (
          <div className="stack" style={{ gap: ".6rem" }}>
            {m.ious.map((i) => {
              const from = catById(m, i.from)!, to = catById(m, i.to)!;
              return (
                <div className="iou" key={i.from + i.to}>
                  <div className="p">
                    <small>Lender</small>
                    <b><Sw hex={from.hex} />{from.name}</b>
                    <span>now {gbp(from.eff)} · was {gbp(from.limit)}</span>
                  </div>
                  <div className="arrow">
                    <b>{gbp(i.amount)}</b>
                    <i />
                    <span>{i.day ? "SINCE " + short(dayOfCycle(m, i.day)).toUpperCase() : "THIS CYCLE"}</span>
                  </div>
                  <div className="p r">
                    <small>Borrower</small>
                    <b><Sw hex={to.hex} />{to.name}</b>
                    <span>now {gbp(to.eff)} · was {gbp(to.limit)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="howto">No IOUs. Every budget is living on its own money.</p>
        )}
        <Table m={m} />
      </div>

      <div className="grid2">
        {spend.map((c) => <BudgetCard key={c.id} m={m} c={c} />)}
      </div>

      {bills.map((c) => <BillsCard key={c.id} m={m} c={c} />)}

      <div className="card" id="set">
        <Hd title="Set the budgets" right="PER PAYDAY CYCLE" />
        <p className="sub">A budget counts in the daily number unless it&apos;s fixed. Where Nori has history it offers what you actually spent over the last three cycles, so the first number is yours rather than a guess.</p>
        <Budgets cats={m.cats.map((c) => ({ id: c.id, name: c.name, hex: c.hex, limit: c.limit, fixed: c.fixed, suggested: suggested[c.id] ?? null }))} />
      </div>
    </>
  );
}

function StillDue({ m }: { m: Month }) {
  if (!m.due.length)
    return (
      <div className="card">
        <Hd title="Still to leave before payday" right="NOTHING FOUND" />
        <p className="sub">Nori hasn&apos;t found any recurring payment still to come this cycle. It needs to have seen a payee three times at a steady interval before it will count on it.</p>
      </div>
    );
  const byCat = new Map<string, number>();
  for (const d of m.due) byCat.set(d.series.categoryId ?? "", (byCat.get(d.series.categoryId ?? "") ?? 0) + d.amount);
  return (
    <div className="card">
      <Hd title="Still to leave before payday" right={`${round(m.committed)} · ${m.due.length} PAYMENT${m.due.length === 1 ? "" : "S"}`} />
      <p className="sub">
        Found from your own history: the same payee, same sort of interval, same sort of amount, at least three times. {m.reserved ? <>Of this, <b>{gbp(m.reserved)}</b> comes out of budgets you spend from, so it&apos;s held back from the daily number: {gbp(m.leftADayBefore)} a day becomes <b>{gbp(m.leftADay)}</b>.</> : <>None of it comes out of the budgets you spend from, so the daily number is unaffected.</>}
      </p>
      <div className="lt-w">
        <table className="lt">
          <thead>
            <tr><th>Expected</th><th>Payee</th><th>Pattern</th><th>Budget</th><th>Amount</th></tr>
          </thead>
          <tbody>
            {m.due.map((d, i) => {
              const c = d.series.categoryId ? catById(m, d.series.categoryId) : null;
              return (
                <tr key={i}>
                  <td>{d.overdue ? <span className="tag over">OVERDUE</span> : withDay(d.due)}</td>
                  <td>{d.series.label}</td>
                  <td className="m">{describeCadence(d.series)}{d.series.changed ? ` · up ${d.series.changed.pct}%` : ""}</td>
                  <td>{c ? <><Sw hex={c.hex} />{c.name}</> : <span className="m">unfiled</span>}</td>
                  <td>{gbp(d.amount)}</td>
                </tr>
              );
            })}
            <tr>
              <td><b>Between them</b></td>
              <td colSpan={3} className="m">{[...byCat.entries()].map(([id, v]) => `${id ? catById(m, id)?.name ?? id : "unfiled"} ${round(v)}`).join(" · ")}</td>
              <td><b>{gbp(m.committed)}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Table({ m }: { m: Month }) {
  const rows = m.cats.map((c) => {
    const lent = m.ious.find((i) => i.from === c.id), got = m.ious.find((i) => i.to === c.id);
    const over = !c.fixed && c.pace > c.eff;
    return (
      <tr key={c.id}>
        <td><Sw hex={c.hex} />{c.name}</td>
        <td>{c.limit ? gbp(c.limit) : <span className="m">not set</span>}</td>
        <td className={got ? "o" : ""}>{lent ? "−" + gbp(lent.amount) : got ? "+" + gbp(got.amount) : <span className="m">—</span>}</td>
        <td>{gbp(c.eff)}</td>
        <td>{gbp(c.spent)}</td>
        <td>{c.due ? gbp(c.due) : <span className="m">—</span>}</td>
        <td>{gbp(Math.max(0, c.room - Math.min(c.due, Math.max(0, c.room))))}</td>
        <td>{c.fixed || !c.limit ? <span className="m">—</span> : gbp(c.perDayLeft)}</td>
        <td className={over ? "o" : ""}>{c.fixed || !c.limit ? <span className="m">—</span> : <>{gbp(c.pace)}{over ? <span className="tag over"> OVER</span> : null}</>}</td>
      </tr>
    );
  });
  return (
    <div className="lt-w" style={{ marginTop: "1rem" }}>
      <table className="lt">
        <thead>
          <tr><th>Budget</th><th>Set</th><th>IOU</th><th>Now</th><th>Spent</th><th>Still due</th><th>Free</th><th>Per day</th><th>At this pace</th></tr>
        </thead>
        <tbody>
          {rows}
          <tr>
            <td><b>Budgets you spend from</b></td>
            <td>{gbp(m.dailyLimit)}</td>
            <td className="m">±0</td>
            <td>{gbp(m.dailyLimit)}</td>
            <td>{gbp(m.dailySpent)}</td>
            <td>{m.reserved ? gbp(m.reserved) : <span className="m">—</span>}</td>
            <td>{gbp(Math.max(0, m.dailyLimit - m.dailySpent - m.reserved))}</td>
            <td><b>{gbp(m.leftADay)}</b></td>
            <td className={m.proj > m.dailyLimit ? "o" : ""}>{gbp(m.proj)}{m.proj > m.dailyLimit ? <span className="tag over"> OVER</span> : null}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function dueOf(m: Month, id: string) {
  return m.due.filter((d) => d.series.categoryId === id).map((d) => ({ day: d.due as Day, amount: d.amount, label: d.series.label }));
}

function BudgetCard({ m, c }: { m: Month; c: CatOut }) {
  const over = c.limit > 0 && c.spent > c.limit;
  const moved = c.eff !== c.limit;
  const due = dueOf(m, c.id);
  const rows: string[][] = [];
  let run = 0;
  for (let d = 1; d <= m.cycle.dayIndex; d++) {
    const day = addDays(m.cycle.start, d - 1);
    run += c.byDay[d - 1] ?? 0;
    rows.push([`${weekdayName(day)} ${short(day)}`, gbp(c.byDay[d - 1] ?? 0), gbp(run), gbp(Math.round((c.eff / m.cycle.daysIn) * d))]);
  }
  return (
    <div className="card">
      <div className="hd">
        <h3><Sw hex={c.hex} />{c.name}</h3>
        <span className="eb">{c.limit ? `${round(c.limit)} A CYCLE` : "NO BUDGET SET"}</span>
      </div>
      {!c.limit ? (
        <p className="bud-say">You&apos;ve spent {gbp(c.spent)} here this cycle and there&apos;s no budget to measure it against. <Link className="lnk" href="#set">Set one below</Link>.</p>
      ) : (
        <>
          <p className="bud-say">{say(m, c)}</p>
          <div className="stats">
            <div className={"stat" + (over ? " o" : "")}><small>Spent{over ? " · OVER" : ""}</small><b>{gbp(c.spent)}</b></div>
            <div className="stat"><small>Allowed by now</small><b>{gbp(Math.round((c.eff / m.cycle.daysIn) * m.cycle.dayIndex))}</b></div>
            <div className={"stat" + (c.due ? " o" : "")}><small>Still due</small><b>{c.due ? gbp(c.due) : "—"}</b></div>
            <div className={"stat" + (c.pace > c.eff ? " o" : "")}><small>At this pace{c.pace > c.eff ? " · OVER" : ""}</small><b>{gbp(c.pace)}</b></div>
          </div>
          <div className="lg">
            <span><i style={{ background: P.line }} />Spent</span>
            {over && <span><i style={{ background: P.over }} />OVER</span>}
            <span><i className="dash ctx" />On-budget pace</span>
            <span><i className="dot" />At this pace</span>
            {due.length > 0 && <span><i className="dash" style={{ borderTopColor: P.ink2 }} />Still to leave</span>}
            {moved ? (<><span><i className="solid" />After IOU</span><span><i className="faint" />Original</span></>) : <span><i className="solid" />Budget</span>}
          </div>
          <div className="chart-scroll">
            <Pace name={c.name} byDay={c.byDay} limit={c.limit} eff={c.eff} spent={c.spent} daysIn={m.cycle.daysIn} dayIndex={m.cycle.dayIndex} daysLeft={m.cycle.daysLeft} start={m.cycle.start} due={due} />
          </div>
          <TableView caption={`${c.name} by day`} head={["Day", "That day", "Running total", "On-budget pace"]} rows={rows} />
        </>
      )}
    </div>
  );
}

function BillsCard({ m, c }: { m: Month; c: CatOut }) {
  const due = dueOf(m, c.id);
  return (
    <div className="card">
      <Hd title={<><Sw hex={c.hex} />{c.name}</>} right="FIXED · NOT IN THE DAILY NUMBER" />
      <p className="bud-say">
        {gbp(c.spent)} has left this cycle{due.length ? <>, and <b>{gbp(c.due)}</b> is still to go: {due.map((d) => `${d.label} ${gbp(d.amount)} on ${short(d.day)}`).join(", ")}.</> : c.limit ? <>, against a {gbp(c.limit)} budget. Nothing else is expected before payday.</> : ". Nothing else is expected before payday."}
      </p>
      <div className="stats">
        <div className="stat"><small>Paid</small><b>{gbp(c.spent)}</b></div>
        <div className="stat"><small>Still due</small><b>{c.due ? gbp(c.due) : "—"}</b></div>
        <div className="stat"><small>Cycle total</small><b>{gbp(c.spent + c.due)}</b></div>
        <div className="stat"><small>Budget</small><b>{c.limit ? gbp(c.limit) : "—"}</b></div>
      </div>
    </div>
  );
}

/** The sentence under a budget's name. Says the one thing that is
 *  true of it right now, and nothing else. */
function say(m: Month, c: CatOut): string {
  const lent = m.ious.find((i) => i.from === c.id), got = m.ious.find((i) => i.to === c.id);
  const free = Math.max(0, c.room - Math.min(c.due, Math.max(0, c.room)));
  if (got) return `Over by ${gbp(got.amount)}${got.day ? ` since ${short(dayOfCycle(m, got.day))}` : ""}. ${catById(m, got.from)!.name} covered it, so every penny more comes out of ${catById(m, got.from)!.name.toLowerCase()} too.`;
  if (lent) return `Lent ${gbp(lent.amount)} to ${catById(m, lent.to)!.name.toLowerCase()}. That leaves ${gbp(c.perDayLeft)} a day, and you've been spending ${gbp(c.perDaySoFar)}.`;
  if (c.due > free) return `${gbp(c.due)} is still to leave here and only ${gbp(Math.max(0, c.room))} is left in it. Something has to give before payday.`;
  const p = c.pace - c.eff;
  if (p > 0) return `${gbp(c.perDayLeft)} a day left${c.due ? ` after the ${gbp(c.due)} still to leave` : ""}, and you've been spending ${gbp(c.perDaySoFar)}. Keep that up and it finishes ${gbp(p)} over.`;
  return `${gbp(free)} left${c.due ? ` once the ${gbp(c.due)} still to leave has gone` : ""}, over ${words(m.cycle.daysLeft)} days.`;
}
