import Link from "next/link";
import { Afford } from "@/components/Afford";
import { Hd, Head, Ranked, Sw, TableView, type RankRow } from "@/components/bits";
import { Daily, P, Spark } from "@/components/charts";
import { getPicture } from "@/lib/data";
import { gbp, list, pct, plain, round, words } from "@/lib/format";
import { addDays, short, weekdayName } from "@/lib/london";
import { affordInput, catById, dayOfCycle, type CatOut, type Month } from "@/lib/month";
import { describeCadence } from "@/lib/recurring";

/* ============================================================
   1 · HOME. The number, the one thing most wrong, and what needs
   you. Everything here is summed from Monzo's feed; nothing typed.
   ============================================================ */

export const dynamic = "force-dynamic";

export default async function Home() {
  const pic = await getPicture();
  const m = pic.month, c = m.cycle;
  const meta =
    c.basis === "salary"
      ? `DAY ${c.dayIndex} OF ${c.daysIn} · ${short(c.start)} – ${short(c.end)} · PAYDAY IN ${m.daysToPayday} DAYS`
      : `DAY ${c.dayIndex} OF ${c.daysIn} · CALENDAR MONTH · NO SALARY FOUND YET`;

  if (!pic.conn.connected && !pic.conn.example) {
    return (
      <>
        <Head title="Home" meta="NOT CONNECTED" />
        <div className="say">
          <span><span className="tag">START HERE</span></span>
          <h2>Connect Monzo and Nori does the rest.</h2>
          <p>Nothing gets typed in. Nori reads your account, finds payday from your salary, and turns what&apos;s left into a number a day. It can only read; it cannot move money.</p>
          <div className="ft"><Link className="btn" href="/settings">Connect Monzo</Link></div>
        </div>
      </>
    );
  }

  const daily = m.cats.filter((k) => k.daily);
  const spendCats = m.cats.filter((k) => !k.fixed);
  const worst = [...m.ious].sort((a, b) => b.amount - a.amount)[0];
  const slip = daily.filter((k) => k.pace > k.eff).sort((a, b) => b.pace - b.eff - (a.pace - a.eff))[0];
  const story: CatOut | undefined = (worst && catById(m, worst.to)) || slip || daily[0];
  const said = m.said[pic.voice];

  return (
    <>
      <Head title="Home" meta={meta} />
      <div className="hero">
        <Big m={m} />
        <div className="say">
          <span>
            {worst ? <span className="tag over">OVER · {catById(m, worst.to)!.name.toUpperCase()}</span> : slip ? <span className="tag story">HEADING OVER · {slip.name.toUpperCase()}</span> : <span className="tag">TODAY</span>}
          </span>
          <h2>{said.head}</h2>
          <p>{said.body}</p>
          <div className="ft">
            <Link className="lnk" href="/budgets">Open the IOU book →</Link>
            <span className="eb">Voice: {pic.voice}</span>
          </div>
        </div>
      </div>

      <Kpis m={m} paid={pic.pay && pic.pay.days.includes(c.start) ? { amount: pic.pay.amount, from: pic.pay.payer } : null} />

      <div className="grid4">
        {spendCats.map((k) => <CatCard key={k.id} m={m} c={k} />)}
      </div>

      <div className="row">
        <div className="stack">
          <DayByDay m={m} story={story} />
          <WhereItWent m={m} />
        </div>
        <div className="stack">
          <div className="card">
            <Hd title="Can I afford it?" right="PRESS A" />
            <p className="sub">Type a price. See the daily number move before you pay, not after.</p>
            <Afford id="aw" input={affordInput(m)} voice={pic.voice} start={60} cat={story?.id ?? ""} />
          </div>
          <div className="card">
            <Hd title="Needs you" right="MOST URGENT FIRST" />
            <Needs pic={pic} />
          </div>
        </div>
      </div>
    </>
  );
}

function Big({ m }: { m: Month }) {
  const [pounds, pence] = plain(m.leftADay).split(".");
  const used = Math.min(100, pct(m.dailySpent, m.dailyLimit)), elapsed = pct(m.cycle.dayIndex, m.cycle.daysIn);
  if (!m.dailyLimit)
    return (
      <div className="big">
        <span className="k">Left to spend, each day, until payday</span>
        <div className="n">£–<em>a day</em></div>
        <p>Set your budgets and this becomes the number you spend by. Settings offers what you actually spent over the last three cycles, so you don&apos;t have to guess.</p>
        <div className="meter"><Link className="ask" href="/settings#budgets">Set budgets</Link></div>
      </div>
    );
  return (
    <div className="big">
      <span className="k">Left to spend, each day, until payday</span>
      <div className="n">£{pounds}<small>.{pence}</small><em>a day</em></div>
      <p>
        For the next <b>{words(m.cycle.daysLeft)} days</b>, today included{m.reserved ? <>, after holding back <b>{gbp(m.reserved)}</b> for what&apos;s still to leave</> : ""}. You&apos;ve averaged <b>{gbp(Math.round(m.dailySpent / m.cycle.dayIndex))}</b> a day so far; the budgets allowed {gbp(m.allow)}.
      </p>
      <div className="meter">
        <div className="lb"><span>SPENT {gbp(m.dailySpent)} OF {gbp(m.dailyLimit)}</span><span>{used}%</span></div>
        <div className="tr" data-tt={["The cycle so far", `${used}% of the money is gone`, `${elapsed}% of the days are gone`, "The white tick is today"].join("|")}>
          <i style={{ width: used + "%" }} />
          <u style={{ left: `calc(${elapsed}% - 1px)` }} />
        </div>
        <div className="lb"><span>TODAY · DAY {m.cycle.dayIndex} OF {m.cycle.daysIn}</span><span>{elapsed}% OF THE CYCLE</span></div>
      </div>
    </div>
  );
}

function Kpis({ m, paid }: { m: Month; paid: { amount: number; from: string } | null }) {
  const fixed = m.cats.filter((k) => k.fixed);
  const billsSpent = fixed.reduce((n, k) => n + k.spent, 0);
  const hot = m.dailyLimit > 0 && m.proj > m.dailyLimit;
  const pay = paid?.amount ?? m.income;
  return (
    <div className="kpis">
      <div className="kpi"><small>Paid in</small><b>{gbp(pay)}</b><em>{paid ? `${paid.from} · ${short(m.cycle.start)}` : "this cycle, everything that arrived"}</em></div>
      <div className="kpi"><small>To pots</small><b>{gbp(m.saved)}</b><em>{pay ? `${pct(m.saved, pay)}% of pay, moved where it can't be spent by accident` : "moved into pots this cycle"}</em></div>
      <div className={"kpi" + (hot ? " hot" : "")}>
        <small>Spent from budgets</small>
        <b>{gbp(m.dailySpent)}</b>
        <em>of {m.dailyLimit ? gbp(m.dailyLimit) : "no budgets yet"}{hot ? <> · <span className="tag over">OVER PACE</span> heading for {round(m.proj)}</> : null}</em>
      </div>
      <div className={"kpi" + (m.committed ? " hot" : "")}>
        <small>Still to leave</small>
        <b>{gbp(m.committed)}</b>
        <em>{m.due.length ? <>{m.due.length === 1 ? "one payment" : `${m.due.length} payments`} before payday · <Link className="lnk" href="/budgets">see them</Link></> : <>nothing recurring is still expected · bills so far {gbp(billsSpent)}</>}</em>
      </div>
    </div>
  );
}

function CatCard({ m, c }: { m: Month; c: CatOut }) {
  const over = c.limit > 0 && c.spent > c.limit;
  const lent = m.ious.find((i) => i.from === c.id), got = m.ious.find((i) => i.to === c.id);
  const slip = !over && c.limit > 0 && c.pace > c.eff;
  const tag = !c.limit ? <em className="tag mute">NO BUDGET</em> : over ? <em className="tag over">OVER</em> : lent ? <em className="tag mute">LENT {round(lent.amount)}</em> : slip ? <em className="tag story">HEADING OVER</em> : <em className="tag">ON TRACK</em>;
  const scale = Math.max(c.limit, c.spent, c.eff, 1);
  const w = (v: number) => ((v / scale) * 100).toFixed(1) + "%";
  const tip = [c.name, `Spent ${gbp(c.spent)}${c.limit ? ` of ${gbp(c.limit)}` : ""}`];
  if (over) tip.push(`OVER by ${gbp(c.spent - c.limit)}, borrowed`);
  if (lent) tip.push(`Lent ${gbp(lent.amount)} (hatched): now ${gbp(c.eff)}`);
  return (
    <div className="card cat">
      <div className="c"><span><Sw hex={c.hex} />{c.name}</span>{tag}</div>
      <div className="a">{gbp(c.spent)}</div>
      <div className="of">
        {!c.limit ? <Link className="lnk" href="/settings#budgets">Set a budget</Link> : got ? <>of {gbp(c.limit)} · <b>{gbp(got.amount)}</b> borrowed</> : lent ? <>of {gbp(c.limit)} · now <b>{gbp(c.eff)}</b></> : <>of {gbp(c.limit)}</>}
      </div>
      {c.limit > 0 && (
        <div className="bar" data-tt={tip.join("|")}>
          <i className="sp" style={{ width: w(Math.min(c.spent, c.limit)) }} />
          {over && <i className="ov" style={{ left: w(c.limit), width: w(c.spent - c.limit) }} />}
          {lent && <i className="lent" style={{ left: w(c.eff), width: w(c.limit - c.eff) }} />}
          <i className="mk" style={{ left: `calc(${w(c.limit)} - 2px)` }} />
        </div>
      )}
      <div className="u">
        {!c.limit ? <>You&apos;ve averaged <b>{gbp(c.perDaySoFar)}</b> a day</> : over ? <>Spending <b>{gbp(c.perDaySoFar)}</b> a day · the budget allowed {gbp(Math.round(c.limit / m.cycle.daysIn))}</> : <><b>{gbp(c.perDayLeft)}</b> a day left · you&apos;ve averaged {gbp(c.perDaySoFar)}</>}
      </div>
      <Spark name={c.name} byDay={c.byDay} limit={c.limit} spent={c.spent} daysIn={m.cycle.daysIn} dayIndex={m.cycle.dayIndex} start={m.cycle.start} />
    </div>
  );
}

function DayByDay({ m, story }: { m: Month; story?: CatOut }) {
  const idx = Array.from({ length: m.cycle.daysIn }, (_, i) => i);
  const s = idx.map((i) => (story ? story.byDay[i] : 0));
  const o = idx.map((i) => m.byDay[i] - s[i]);
  const rows = idx.slice(0, m.cycle.dayIndex).map((i) => {
    const d = addDays(m.cycle.start, i);
    return [`${weekdayName(d)} ${short(d)}`, gbp(s[i]), gbp(o[i]), gbp(s[i] + o[i])];
  });
  const sn = story?.name ?? "—";
  return (
    <div className="card">
      <Hd title="Day by day" right="SINCE PAYDAY" />
      <p className="sub">What each day cost against the daily allowance. The dashed boxes ahead are what&apos;s left: {gbp(m.leftADay)} a day, everything except bills.</p>
      <div className="lg">
        <span><i style={{ background: P.story }} />{sn}</span>
        <span><i style={{ background: P.ctx }} />Everything else</span>
        <span><i className="dash" />Allowance {gbp(m.allow)}/day</span>
        <span><i className="out" />Left per day</span>
      </div>
      <div className="chart-scroll">
        <Daily story={s} other={o} storyName={sn} allow={m.allow} leftADay={m.leftADay} daysIn={m.cycle.daysIn} dayIndex={m.cycle.dayIndex} start={m.cycle.start} />
      </div>
      <TableView caption="Days as a table" head={["Day", sn, "Everything else", "Total"]} rows={rows} />
    </div>
  );
}

function WhereItWent({ m }: { m: Month }) {
  const daily = m.cats.filter((k) => !k.fixed && k.spent);
  const total = daily.reduce((n, k) => n + k.spent, 0);
  const rows: RankRow[] = daily.map((k) => {
    const over = k.limit > 0 && k.spent > k.limit;
    return { label: k.name, v: k.spent, hex: k.hex, cls: over ? "over" : "", tag: over ? "OVER" : "", tt: [k.name, `${gbp(k.spent)}${k.limit ? " of " + gbp(k.limit) : ""}`, `${pct(k.spent, total)}% of what came out of budgets`] };
  });
  if (m.unfiled.length) rows.push({ label: "Unfiled", v: m.unfiledTotal, cls: "ctx", tt: ["Unfiled", "Not in any budget until you file it"] });
  rows.sort((a, b) => b.v - a.v);
  const bills = m.cats.filter((k) => k.fixed).reduce((n, k) => n + k.spent, 0);
  return (
    <div className="card">
      <Hd title="Where it went" right={`${round(total)} FROM BUDGETS`} />
      <p className="sub">{bills ? `Bills (${gbp(bills)}) are left out: they're fixed, and nothing about them is a decision.` : "Largest first."}</p>
      {rows.length ? <Ranked rows={rows} /> : <p className="empty">Nothing spent yet this cycle.</p>}
    </div>
  );
}

function Needs({ pic }: { pic: Awaited<ReturnType<typeof getPicture>> }) {
  const m = pic.month;
  const items: { t: string; href: string; hot?: boolean; s: React.ReactNode }[] = [];
  if (!pic.conn.connected) items.push({ t: "NOW", href: "/settings", hot: true, s: <><b>Monzo isn&apos;t connected.</b> You&apos;re looking at the example cycle, not your money.</> });
  else if (!pic.conn.approved) items.push({ t: "NOW", href: "/settings", hot: true, s: <><b>Approve Nori in the Monzo app.</b> Nothing can be read until you do.</> });
  else if (pic.conn.lastError) items.push({ t: "SYNC", href: "/settings", hot: true, s: <><b>The last sync failed.</b> {pic.conn.lastError}</> });
  if (!pic.pay && pic.candidates.length) items.push({ t: "SETUP", href: "/settings#payday", hot: true, s: <><b>Tell Nori which credit is your pay.</b> Until then cycles are calendar months. {pic.candidates[0].payer} pays you most often, {pic.candidates[0].count} times.</> });
  if (m.cycle.late) items.push({ t: "LATE", href: "/settings#payday", hot: true, s: <><b>Payday was due and no salary has landed.</b> The cycle stretches until it does.</> });
  if (m.unfiled.length) items.push({ t: "NOW", href: "/transactions?show=unfiled", hot: true, s: <><b>{words(m.unfiled.length)} payment{m.unfiled.length === 1 ? "" : "s"}</b> the rules couldn&apos;t place, {gbp(m.unfiledTotal)} between them. File each once and Nori knows the shop from then on.</> });
  for (const i of m.ious) {
    const to = catById(m, i.to)!, from = catById(m, i.from)!;
    items.push({ t: i.day ? short(dayOfCycle(m, i.day)).toUpperCase() : "IOU", href: `/transactions?cat=${to.id}`, hot: true, s: <><b>{to.name} went over.</b> {from.name} lent it {gbp(i.amount)} and has that much less.</> });
  }
  for (const d of m.due.filter((x) => x.overdue)) items.push({ t: "LATE", href: "/budgets", hot: true, s: <><b>{d.series.label} hasn&apos;t arrived.</b> {gbp(d.amount)} was expected {short(d.series.due)}, and it&apos;s still being held back from the daily number.</> });
  for (const s of pic.series.filter((x) => x.changed && x.last.day >= m.cycle.start)) items.push({ t: short(s.last.day).toUpperCase(), href: "/budgets", s: <><b>{s.label} {s.changed!.pct > 0 ? "went up" : "went down"} {Math.abs(s.changed!.pct)}%.</b> {gbp(s.changed!.from)} to {gbp(s.changed!.to)}, {describeCadence(s)}. Nobody told you; the statement did.</> });
  for (const d of pic.doubles) items.push({ t: short(d.day).toUpperCase(), href: `/transactions?q=${encodeURIComponent(d.label)}`, hot: true, s: <><b>{d.label} charged {gbp(d.amount)} twice</b> within the hour. If that wasn&apos;t two things, it&apos;s worth a look.</> });
  const slip = m.cats.filter((k) => k.daily && k.spent <= k.limit && k.pace > k.eff);
  if (slip.length) items.push({ t: "PACE", href: `/transactions?cat=${slip[0].id}`, s: <><b>{list(slip.map((k) => k.name))}</b> {slip.length > 1 ? "are" : "is"} on pace to finish over, though {slip.length > 2 ? "none is" : slip.length > 1 ? "neither is" : "it isn't"} yet.</> });
  const unset = m.cats.filter((k) => !k.fixed && !k.limit);
  if (unset.length) items.push({ t: "SETUP", href: "/settings#budgets", s: <><b>{list(unset.map((k) => k.name))}</b> {unset.length > 1 ? "have" : "has"} no budget, so {unset.length > 1 ? "they don't" : "it doesn't"} count in the daily number.</> });
  if (!items.length) return <p className="empty">Nothing. Everything is filed and inside its budget.</p>;
  return (
    <div className="log">
      {items.map((i, k) => (
        <Link key={k} href={i.href} className={i.hot ? "hot" : undefined}>
          <time>{i.t}</time>
          <span>{i.s}</span>
        </Link>
      ))}
    </div>
  );
}
