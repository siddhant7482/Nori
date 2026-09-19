import { gbp } from "@/lib/format";

export function Head({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="ph">
      <h1>{title}</h1>
      <span className="meta">{meta}</span>
    </div>
  );
}

export function Hd({ title, right }: { title: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="hd">
      <h3>{title}</h3>
      {right ? <span className="eb">{right}</span> : null}
    </div>
  );
}

export function Sw({ hex }: { hex: string }) {
  return <i className="sw" style={{ background: hex }} />;
}

export interface RankRow {
  label: string;
  v: number;
  hex?: string;
  cls?: "over" | "story" | "ctx" | "";
  tag?: string;
  tt: string[];
}

/** Largest first, one hue. A coloured swatch carries identity; the bar
 *  itself stays forest unless it is the story or OVER. */
export function Ranked({ rows }: { rows: RankRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="rank">
      {rows.map((r) => (
        <div className={"rk " + (r.cls ?? "")} key={r.label} data-tt={r.tt.join("|")}>
          <span className="l">
            {r.hex ? <i style={{ background: r.hex }} /> : null}
            {r.label}
            {r.tag ? <span className="tag over">{r.tag}</span> : null}
          </span>
          <span className="t"><i style={{ width: Math.max(1, (r.v / max) * 100).toFixed(1) + "%" }} /></span>
          <span className="v">{gbp(r.v)}</span>
        </div>
      ))}
    </div>
  );
}

export function TableView({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
  return (
    <details className="tablev">
      <summary>{caption}</summary>
      <div className="tw">
        <table>
          <thead>
            <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
