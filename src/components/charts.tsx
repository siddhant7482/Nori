import { gbp, round } from "@/lib/format";
import { addDays, diff, short, weekdayName, type Day } from "@/lib/london";

/* ============================================================
   Charts, in Canopy's palette. Every colour here was run through
   the colour-blind validator on white:
   - one series that is the point: coral; the rest: sage
   - OVER is orange, never red: forest green against red scored
     dE 2.3 for protanopes. Orange is always labelled OVER.
   Every mark carries data-tt, which the frame turns into a tooltip.
   Curves are monotone cubic: a running total never goes down, and a
   curve that overshoots would draw a day where it did.
   ============================================================ */

export const P = { text: "#15261d", ink2: "#56695e", grid: "#e6efe9", ctx: "#a9c3b4", story: "#e0603f", over: "#e8590c", surf: "#ffffff", line: "#0e5c3a" };

const f = (v: number) => Math.round(v * 10) / 10;
export const tt = (lines: string[]) => lines.join("|");

function topBar(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0.5) return "";
  r = Math.min(r, h, w / 2);
  return `M${f(x)},${f(y + h)}V${f(y + r)}Q${f(x)},${f(y)} ${f(x + r)},${f(y)}H${f(x + w - r)}Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + r)}V${f(y + h)}Z`;
}

export function curve(pts: [number, number][]): string {
  if (pts.length < 3) return "M" + pts.map((p) => `${f(p[0])},${f(p[1])}`).join("L");
  const n = pts.length, dx: number[] = [], m: number[] = [], t: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f(pts[i][0] + h)},${f(pts[i][1] + t[i] * h)} ${f(pts[i + 1][0] - h)},${f(pts[i + 1][1] - t[i + 1] * h)} ${f(pts[i + 1][0])},${f(pts[i + 1][1])}`;
  }
  return d;
}

function splitAt(pts: [number, number][], limitY: number) {
  for (let i = 1; i < pts.length; i++)
    if (pts[i - 1][1] >= limitY && pts[i][1] < limitY) {
      const a = pts[i - 1], b = pts[i], k = (limitY - a[1]) / (b[1] - a[1]);
      const c: [number, number] = [a[0] + k * (b[0] - a[0]), limitY];
      return { before: [...pts.slice(0, i), c], after: [c, ...pts.slice(i)] };
    }
  return null;
}

/* ---------- a budget's pace, small ---------- */
export function Spark({ name, byDay, limit, spent, daysIn, dayIndex, start, width = 220 }: { name: string; byDay: number[]; limit: number; spent: number; daysIn: number; dayIndex: number; start: Day; width?: number }) {
  const H = 42, w = width;
  const X = (d: number) => 2 + (d / daysIn) * (w - 8);
  const max = Math.max(limit * 1.12, spent * 1.06, 1);
  const Y = (v: number) => H - 4 - (v / max) * (H - 9);
  const pts: [number, number][] = [[X(0), Y(0)]];
  let run = 0;
  for (let d = 1; d <= dayIndex; d++) {
    run += byDay[d - 1] ?? 0;
    pts.push([X(d), Y(run)]);
  }
  const sp = limit > 0 ? splitAt(pts, Y(limit)) : null;
  const last = pts[pts.length - 1], over = limit > 0 && spent > limit;
  const proj = Math.round((spent / dayIndex) * daysIn);
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`${name} pace`} className="spark">
      {limit > 0 && <line x1={f(X(0))} y1={f(Y(0))} x2={f(X(daysIn))} y2={f(Y(limit))} stroke={P.ctx} strokeWidth={1.5} strokeDasharray="4 3" />}
      {sp ? (
        <>
          <path d={curve(sp.before)} fill="none" stroke={P.line} strokeWidth={2} />
          <path d={curve(sp.after)} fill="none" stroke={P.over} strokeWidth={2} />
        </>
      ) : (
        <path d={curve(pts)} fill="none" stroke={P.line} strokeWidth={2} />
      )}
      <circle cx={f(last[0])} cy={f(last[1])} r={3.5} fill={over ? P.over : P.line} stroke={P.surf} strokeWidth={1.5} />
      <rect x={0} y={0} width={w} height={H} fill="transparent" data-tt={tt([`${name} · this cycle`, `Spent ${gbp(spent)} by ${short(addDays(start, dayIndex - 1))}`, `At this pace ${gbp(proj)} by payday`, ...(limit > 0 ? ["Dashed: on-budget pace"] : [])])} />
    </svg>
  );
}

/* ---------- the cycle, day by day ---------- */
export function Daily({ story, other, storyName, allow, leftADay, daysIn, dayIndex, start }: { story: number[]; other: number[]; storyName: string; allow: number; leftADay: number; daysIn: number; dayIndex: number; start: Day }) {
  const W = 760, H = 230, m = { l: 40, r: 12, t: 26, b: 28 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const peak = Math.max(allow * 1.4, ...story.map((v, i) => v + other[i]), leftADay, 1);
  const step = peak > 20000 ? 10000 : peak > 8000 ? 5000 : 2000;
  const max = Math.ceil(peak / step) * step;
  const band = iw / daysIn, bw = Math.max(3, band * 0.6);
  const Y = (v: number) => m.t + ih - (v / max) * ih;
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  const labelDays = [1, Math.round(daysIn / 4), Math.round(daysIn / 2), Math.round((3 * daysIn) / 4), daysIn].filter((d, i, a) => a.indexOf(d) === i && Math.abs(d - dayIndex) > 1);
  const ya = Y(allow), xe = m.l + dayIndex * band;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spending per day this cycle" className="daily">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={m.l} x2={W - m.r} y1={f(Y(v))} y2={f(Y(v))} stroke={P.grid} />
          <text x={m.l - 6} y={f(Y(v) + 4)} fontSize={10} fill={P.ink2} textAnchor="end" className="mono">£{Math.round(v / 100)}</text>
        </g>
      ))}
      {Array.from({ length: daysIn }, (_, i) => {
        const d = i + 1, x = m.l + i * band + (band - bw) / 2, day = addDays(start, i);
        if (d <= dayIndex) {
          const e = story[i] ?? 0, o = other[i] ?? 0, gap = o && e ? 2 : 0;
          return (
            <g key={d}>
              {o > 0 && <path d={topBar(x, Y(o), bw, (o / max) * ih, e ? 0 : 4)} fill={P.ctx} />}
              {e > 0 && <path d={topBar(x, Y(o) - gap - (e / max) * ih, bw, (e / max) * ih, 4)} fill={P.story} />}
              <rect x={f(m.l + i * band)} y={m.t} width={f(band)} height={ih} fill="transparent" data-tt={tt([`${weekdayName(day)} ${short(day)} · ${gbp(e + o)}`, `${storyName} ${gbp(e)}`, `Everything else ${gbp(o)}`])} />
            </g>
          );
        }
        return (
          <g key={d}>
            <rect x={f(x + 0.75)} y={f(Y(leftADay))} width={f(bw - 1.5)} height={f((leftADay / max) * ih)} fill="none" stroke={P.ctx} strokeWidth={1.5} strokeDasharray="3 2" rx={3} />
            <rect x={f(m.l + i * band)} y={m.t} width={f(band)} height={ih} fill="transparent" data-tt={tt([`${weekdayName(day)} ${short(day)} · ahead`, `${gbp(leftADay)} a day is what's left`])} />
          </g>
        );
      })}
      {allow > 0 && (
        <>
          <line x1={m.l} x2={f(xe)} y1={f(ya)} y2={f(ya)} stroke={P.text} strokeWidth={1.5} strokeDasharray="6 4" />
          <text x={f(Math.min(xe + 4, W - 70))} y={f(ya - 4)} fontSize={10.5} fill={P.text} fontWeight={700} className="mono">{gbp(allow)}/day</text>
        </>
      )}
      <text x={f(m.l + (dayIndex - 0.5) * band)} y={m.t - 10} fontSize={10} fontWeight={800} fill={P.text} textAnchor="middle" className="mono">TODAY</text>
      {[...labelDays, dayIndex].map((d) => (
        <text key={"l" + d} x={f(m.l + (d - 0.5) * band)} y={H - 8} fontSize={10} textAnchor="middle" className="mono" fill={d === dayIndex ? P.text : P.ink2} fontWeight={d === dayIndex ? 800 : 400}>
          {short(addDays(start, d - 1))}
        </text>
      ))}
    </svg>
  );
}

/* ---------- one budget, against its own line ----------
   The curve is what you have spent, day by day. Where it crosses the
   budget it turns orange and says OVER, with the date. The dotted
   line carries today's pace to payday; the dashed sage line is what
   staying inside the budget would have looked like all along.

   When a budget has lent or borrowed, BOTH lines are drawn: the
   original faint and dashed, the one it actually has now, solid. A
   bill still to come is a dashed step up from today, because that
   money is already spent, it just hasn't left yet.
   ---------- */
export function Pace({ name, byDay, limit, eff, spent, daysIn, dayIndex, daysLeft, start, due, narrow = false }: { name: string; byDay: number[]; limit: number; eff: number; spent: number; daysIn: number; dayIndex: number; daysLeft: number; start: Day; due: { day: Day; amount: number; label: string }[]; narrow?: boolean }) {
  const W = 700, H = 250, m = { l: 48, r: narrow ? 14 : 116, t: 22, b: 28 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const proj = Math.round((spent / dayIndex) * daysIn);
  const dueTotal = due.reduce((n, d) => n + d.amount, 0);
  const step = limit > 40000 ? 20000 : limit > 12000 ? 5000 : 2000;
  const max = Math.max(step, Math.ceil(Math.max(limit * 1.2, eff * 1.1, proj * 1.05, (spent + dueTotal) * 1.05) / step) * step);
  const X = (d: number) => m.l + (d / daysIn) * iw;
  const Y = (v: number) => m.t + ih - (v / max) * ih;
  const pts: [number, number][] = [[X(0), Y(0)]];
  let run = 0;
  for (let d = 1; d <= dayIndex; d++) {
    run += byDay[d - 1] ?? 0;
    pts.push([X(d), Y(run)]);
  }
  const moved = eff !== limit;
  const sp = limit > 0 ? splitAt(pts, Y(limit)) : null;
  const crossed = sp ? Math.ceil(((sp.after[0][0] - m.l) / iw) * daysIn) : 0;
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  const labelDays = [1, Math.round(daysIn / 4), Math.round(daysIn / 2), Math.round((3 * daysIn) / 4), daysIn];
  const labels: { y: number; a: string; b: string; w: number }[] = [
    { y: Y(proj), a: gbp(proj), b: "at this pace", w: 800 },
    moved ? { y: Y(eff), a: `after IOU ${round(eff)}`, b: `was ${round(limit)}`, w: 700 } : { y: Y(limit), a: `budget ${round(limit)}`, b: "", w: 600 },
  ].sort((a, b) => a.y - b.y);
  if (labels[1].y - labels[0].y < 30) labels[1].y = labels[0].y + 30;
  let acc = spent;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name} against its budget`} className="pace">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={m.l} x2={W - m.r} y1={f(Y(v))} y2={f(Y(v))} stroke={P.grid} />
          <text x={m.l - 6} y={f(Y(v) + 4)} fontSize={10} fill={P.ink2} textAnchor="end" className="mono">£{Math.round(v / 100)}</text>
        </g>
      ))}
      {limit > 0 && <line x1={m.l} x2={f(X(daysIn))} y1={f(Y(limit))} y2={f(Y(limit))} stroke={P.text} strokeWidth={1} strokeDasharray={moved ? "3 3" : undefined} opacity={moved ? 0.45 : 0.6} />}
      {moved && <line x1={m.l} x2={f(X(daysIn))} y1={f(Y(eff))} y2={f(Y(eff))} stroke={P.text} strokeWidth={1.5} />}
      {eff > 0 && <line x1={f(X(0))} y1={f(Y(0))} x2={f(X(daysIn))} y2={f(Y(eff))} stroke={P.ctx} strokeWidth={1.5} strokeDasharray="5 4" />}
      <path d={`M${f(X(dayIndex))},${f(Y(spent))}L${f(X(daysIn))},${f(Y(proj))}`} fill="none" stroke={P.story} strokeWidth={2} strokeDasharray="2 4" strokeLinecap="round" />
      {due.map((d, i) => {
        const at = Math.min(daysIn, diff(start, d.day) + 1);
        const from = acc;
        acc += d.amount;
        return <path key={i} d={`M${f(X(Math.max(dayIndex, at - 1)))},${f(Y(from))}L${f(X(at))},${f(Y(from))}L${f(X(at))},${f(Y(acc))}`} fill="none" stroke={P.ink2} strokeWidth={1.5} strokeDasharray="4 3" data-tt={tt([`${d.label} · still to leave`, `${gbp(d.amount)} expected ${short(d.day)}`])} />;
      })}
      {sp ? (
        <>
          <path d={curve(sp.before)} fill="none" stroke={P.line} strokeWidth={2.2} />
          <path d={curve(sp.after)} fill="none" stroke={P.over} strokeWidth={2.2} />
          <circle cx={f(sp.after[0][0])} cy={f(Y(limit))} r={4} fill={P.over} stroke={P.surf} strokeWidth={2} />
          <text x={f(sp.after[0][0] - 6)} y={f(Y(limit) - 9)} fontSize={10.5} fontWeight={700} fill={P.over} textAnchor="end">OVER from {short(addDays(start, crossed - 1))}</text>
        </>
      ) : (
        <path d={curve(pts)} fill="none" stroke={P.line} strokeWidth={2.2} />
      )}
      <circle cx={f(X(dayIndex))} cy={f(Y(spent))} r={5} fill={limit > 0 && spent > limit ? P.over : P.line} stroke={P.surf} strokeWidth={2} />
      <circle cx={f(X(daysIn))} cy={f(Y(proj))} r={4} fill={P.surf} stroke={P.story} strokeWidth={2} />
      {!narrow &&
        labels.map((L, i) => (
          <g key={i}>
            <text x={f(X(daysIn) + 8)} y={f(L.y + 4)} fontSize={11} fontWeight={L.w} fill={P.text}>{L.a}</text>
            {L.b && <text x={f(X(daysIn) + 8)} y={f(L.y + 17)} fontSize={10} fill={P.ink2}>{L.b}</text>}
          </g>
        ))}
      {labelDays.map((d) => (
        <text key={d} x={f(X(d))} y={H - 9} fontSize={10} textAnchor="middle" className="mono" fill={P.ink2}>{short(addDays(start, d - 1))}</text>
      ))}
      {Array.from({ length: dayIndex }, (_, i) => i + 1).map((d) => {
        let upTo = 0;
        for (let k = 0; k < d; k++) upTo += byDay[k] ?? 0;
        return <rect key={d} x={f(X(d - 1))} y={m.t} width={f(iw / daysIn)} height={ih} fill="transparent" data-tt={tt([`${weekdayName(addDays(start, d - 1))} ${short(addDays(start, d - 1))}`, `Spent so far ${gbp(upTo)}`, `On-budget pace ${gbp(Math.round((eff / daysIn) * d))}`])} />;
      })}
    </svg>
  );
}
