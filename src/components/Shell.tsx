"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gbp, words } from "@/lib/format";
import { logout } from "@/app/login/actions";
import { afford, type AffordIn, type Voice } from "@/lib/month";
import { Afford } from "./Afford";
import { Icon } from "./icons";

/* ============================================================
   THE FRAME. Ledger OS's instrument band across the top (logo, where
   you are, search; then the live feed: the Monzo light and the
   ticker), and the dock along the bottom. Everything between is a
   Canopy page.

   The numbers on the dock are the keyboard: they jump straight to a
   screen. A asks "can I afford it?". / or K opens the palette, which
   goes anywhere, finds any payment, and answers a price typed in.
   ============================================================ */

export interface Screen {
  id: string;
  k: string;
  name: string;
  short?: string;
  href: string;
  badge?: number;
}
export interface TickerItem {
  label: string;
  value: string;
  note: string;
  tone?: "ok" | "ov";
}
export interface SyncInfo {
  state: "live" | "example" | "off" | "waiting" | "error";
  lastSyncAt: string | null;
  detail: string | null;
}
export interface Payment {
  id: string;
  label: string;
  hint: string;
  search: string;
}

interface Props {
  screens: Screen[];
  ticker: TickerItem[];
  sync: SyncInfo;
  afford: AffordIn;
  voice: Voice;
  payments: Payment[];
  unfiled: { count: number; total: number };
  children: React.ReactNode;
}

type Layer = null | { kind: "afford"; amount: number } | { kind: "palette"; q: string };

export function Shell(props: Props) {
  const { screens, ticker, sync, voice, payments, unfiled, children } = props;
  const router = useRouter();
  const path = usePathname();
  const [layer, setLayer] = useState<Layer>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tip, setTip] = useState<{ lines: string[]; x: number; y: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  const current = screens.find((s) => (s.href === "/" ? path === "/" : path.startsWith(s.href))) ?? screens[0];

  const open = useCallback((l: Layer) => {
    lastFocus.current = document.activeElement as HTMLElement;
    setLayer(l);
  }, []);
  const close = useCallback(() => {
    setLayer(null);
    lastFocus.current?.focus?.();
  }, []);

  /* keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        return open({ kind: "palette", q: "" });
      }
      const t = e.target as HTMLElement;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = screens.find((x) => x.k === e.key);
      if (s) {
        e.preventDefault();
        setLayer(null);
        return router.push(s.href);
      }
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        return open({ kind: "afford", amount: 60 });
      }
      if (e.key === "/" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        open({ kind: "palette", q: "" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screens, router, open, close]);

  /* toasts */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 4200);
    };
    window.addEventListener("nori:toast", on);
    return () => window.removeEventListener("nori:toast", on);
  }, []);

  /* tooltips: any element with data-tt, lines separated by | */
  useEffect(() => {
    const show = (el: Element, x: number, y: number) => setTip({ lines: (el.getAttribute("data-tt") ?? "").split("|"), x, y });
    const move = (e: MouseEvent) => {
      const el = (e.target as Element).closest?.("[data-tt]");
      if (el) show(el, e.clientX, e.clientY);
      else setTip(null);
    };
    const focus = (e: FocusEvent) => {
      const el = (e.target as Element).closest?.("[data-tt]");
      if (!el) return;
      const r = el.getBoundingClientRect();
      show(el, r.left + r.width / 2, r.top);
    };
    const blur = () => setTip(null);
    document.addEventListener("mousemove", move);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
    };
  }, []);
  const [tipPos, setTipPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!tip || !tipRef.current) return;
    const w = tipRef.current.offsetWidth, h = tipRef.current.offsetHeight;
    setTipPos({ left: Math.min(window.innerWidth - w - 8, Math.max(8, tip.x + 14)), top: tip.y - h - 12 < 8 ? tip.y + 18 : tip.y - h - 12 });
  }, [tip]);

  const half = Math.ceil(screens.length / 2);

  return (
    <div className="main">
      <header className="band">
        <div className="bar-row">
          <Link className="brand" href="/" aria-label="Nori home">nori<i /></Link>
          <span className="crumb"><b>{current.k}</b>{current.name}</span>
          <div className="bar-r">
            <button className="srch" type="button" aria-label="Go to or find" data-tt="Go to, or find|Press / or K" onClick={() => open({ kind: "palette", q: "" })}>
              <Icon name="search" />
            </button>
          </div>
        </div>
        <div className="feed">
          <SyncLight sync={sync} />
          <div className="tick" aria-label="This cycle at a glance">
            <div className="run">
              {[0, 1].map((copy) => (
                <div className="half" key={copy} aria-hidden={copy === 1 || undefined}>
                  {ticker.map((t, i) => (
                    <span key={i}>
                      {t.label}<b>{t.value}</b><em className={t.tone}>{t.note}</em>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="page docked">
        <div className="screen">{children}</div>
      </main>

      <nav className="dock" aria-label="Sections">
        {screens.map((s, i) => (
          <DockItem key={s.id} s={s} active={s.id === current.id} before={i === half ? <AskItem onClick={() => open({ kind: "afford", amount: 60 })} /> : null} />
        ))}
        {screens.length <= half && <AskItem onClick={() => open({ kind: "afford", amount: 60 })} />}
      </nav>

      {layer && <div className="scrim" onClick={close} />}
      {layer?.kind === "afford" && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="af-t">
          <div className="hd">
            <h2 id="af-t">Can I afford it?</h2>
            <button className="x" type="button" onClick={close}>Close</button>
          </div>
          <p className="sub" style={{ margin: 0 }}>Type the price. Pick the budget it would come from, or let Nori find room.</p>
          <Afford id="af" input={props.afford} voice={voice} start={layer.amount} autoFocus />
        </div>
      )}
      {layer?.kind === "palette" && (
        <Palette
          q={layer.q}
          screens={screens}
          payments={payments}
          unfiled={unfiled}
          affordIn={props.afford}
          onClose={close}
          go={(href) => {
            setLayer(null);
            router.push(href);
          }}
          ask={(amount) => setLayer({ kind: "afford", amount })}
        />
      )}

      {message && <div className="toast" role="status">{message}</div>}
      {tip && (
        <div className="tt" ref={tipRef} style={tipPos}>
          <b>{tip.lines[0]}</b>
          {tip.lines.slice(1).map((l, i) => (
            <span key={i}><br />{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function DockItem({ s, active, before }: { s: Screen; active: boolean; before: React.ReactNode }) {
  return (
    <>
      {before}
      <Link className="dk" href={s.href} aria-current={active ? "page" : undefined}>
        <kbd>{s.k}</kbd>
        {s.badge ? <span className="bd">{s.badge}</span> : null}
        <Icon name={s.id} />
        <span>{s.short ?? s.name}</span>
      </Link>
    </>
  );
}

function AskItem({ onClick }: { onClick: () => void }) {
  return (
    <button className="dk dk-ask" type="button" aria-label="Can I afford it?" onClick={onClick}>
      <kbd>A</kbd>
      <b>£?</b>
      <span>Afford</span>
    </button>
  );
}

/* ---------- the Monzo light: the feed's fixed first word ---------- */
function SyncLight({ sync }: { sync: SyncInfo }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (sync.state === "example") return <span className="sync" data-tt="Example data|Monzo is not connected. Every figure is the example cycle.|Connect Monzo in Settings">EXAMPLE DATA</span>;
  if (sync.state === "off") return <span className="sync" data-tt="Monzo is not connected|Connect it in Settings">MONZO <b>NOT CONNECTED</b></span>;
  if (sync.state === "waiting") return <span className="sync" data-tt="Waiting for approval|Approve Nori in the Monzo app">MONZO <b>APPROVE IN APP</b></span>;
  const last = sync.lastSyncAt ? new Date(sync.lastSyncAt).getTime() : 0;
  const left = Math.round((last + 5 * 60_000 - now) / 1000);
  const mmss = left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "DUE";
  const at = last ? new Date(last).toLocaleTimeString("en-GB") : "never";
  if (sync.state === "error")
    return (
      <span className="sync" data-tt={`Monzo · the last sync failed|${sync.detail ?? ""}|Last good sync ${at}`}>
        <span className="live err" />MONZO · <b className="ov">SYNC FAILED</b>
      </span>
    );
  return (
    <span className="sync" data-tt={`Monzo · read-only|Last check ${at}|Next check in ${mmss}|Every five minutes`}>
      <span className="live" />MONZO · NEXT <b>{mmss}</b>
    </span>
  );
}

/* ---------- the palette ---------- */
interface Row {
  g: string;
  label: string;
  hint: string;
  icon?: string;
  glyph?: string;
  run: () => void;
}

function Palette({ q: initial, screens, payments, unfiled, affordIn, onClose, go, ask }: { q: string; screens: Screen[]; payments: Payment[]; unfiled: { count: number; total: number }; affordIn: AffordIn; onClose: () => void; go: (href: string) => void; ask: (amount: number) => void }) {
  const [q, setQ] = useState(initial);
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<Row[]>(() => {
    const ql = q.trim().toLowerCase(), out: Row[] = [];
    const m = ql.match(/^(?:can i afford\s*)?£?\s*(\d+(?:\.\d{1,2})?)\s*\??$/);
    if (m) {
      const pounds = parseFloat(m[1]), r = afford(affordIn, Math.round(pounds * 100), null);
      if (r) out.push({ g: "Ask", glyph: "£?", label: `Can I afford ${gbp(Math.round(pounds * 100))}?`, hint: r.kind === "no" ? `no, ${gbp(r.short)} short` : `${gbp(r.after)} a day after${r.kind === "iou" ? " · needs an IOU" : ""}`, run: () => ask(pounds) });
    }
    for (const s of screens) if (!ql || s.name.toLowerCase().includes(ql)) out.push({ g: "Go to", icon: s.id, label: s.name, hint: (s.badge ? `${s.badge} new · ` : "") + "press " + s.k, run: () => go(s.href) });
    if (!m && (!ql || "can i afford it".includes(ql))) out.push({ g: "Do", glyph: "£?", label: "Can I afford it?", hint: "press A", run: () => ask(60) });
    if (unfiled.count && (!ql || "file unfiled payments".includes(ql))) out.push({ g: "Do", glyph: String(unfiled.count), label: `File ${words(unfiled.count)} unfiled payment${unfiled.count === 1 ? "" : "s"}`, hint: gbp(unfiled.total), run: () => go("/transactions?show=unfiled") });
    if (ql && "sign out log out".includes(ql)) out.push({ g: "Do", glyph: "↪", label: "Sign out of Nori on this device", hint: "", run: () => void logout() });
    if (ql.length >= 2 && !m) for (const p of payments.filter((p) => p.search.includes(ql)).slice(0, 8)) out.push({ g: "Payments", icon: "tx", label: p.label, hint: p.hint, run: () => go(`/transactions?tx=${encodeURIComponent(p.id)}`) });
    return out;
  }, [q, screens, payments, unfiled, affordIn, go, ask]);

  const at = Math.min(sel, Math.max(0, rows.length - 1));
  useEffect(() => {
    listRef.current?.querySelector(`#pal-${at}`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  let group = "";
  return (
    <div className="pal" role="dialog" aria-modal="true" aria-label="Go to or find">
      <div className="pal-q">
        <Icon name="search" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="cmd-list"
          aria-activedescendant={rows.length ? `pal-${at}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Go to a screen, find a payment, or type a price…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const n = Math.max(1, rows.length);
              setSel((at + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
            } else if (e.key === "Enter") {
              e.preventDefault();
              rows[at]?.run();
            } else if (e.key === "Escape") onClose();
          }}
        />
      </div>
      <div className="pal-list" id="cmd-list" role="listbox" aria-label="Results" ref={listRef}>
        {rows.length ? (
          rows.map((r, i) => {
            const head = r.g !== group ? <div className="pal-h" key={"h" + r.g}>{r.g}</div> : null;
            group = r.g;
            return (
              <div key={i} style={{ display: "contents" }}>
                {head}
                <button className="pal-i" role="option" id={`pal-${i}`} aria-selected={i === at} type="button" onClick={r.run} onMouseMove={() => setSel(i)}>
                  <span className="ic">{r.icon ? <Icon name={r.icon} /> : <b>{r.glyph}</b>}</span>
                  <span>{r.label}</span>
                  <span className="h">{r.hint}</span>
                </button>
              </div>
            );
          })
        ) : (
          <p className="empty" style={{ padding: ".6rem .7rem" }}>Nothing matches. Try a shop, a budget, or a price like 60.</p>
        )}
      </div>
      <div className="pal-f">↑ ↓ MOVE · ENTER OPENS · ESC CLOSES · NUMBERS JUMP FROM ANYWHERE</div>
    </div>
  );
}
