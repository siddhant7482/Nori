/* Hand-drawn at 24px on a 1.8 stroke, so they sit with the mono type
 * rather than looking borrowed from an icon set. */
const PATHS: Record<string, React.ReactNode> = {
  home: <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />,
  spending: <path d="M5 20v-8M12 20V5M19 20v-8" />,
  tx: <path d="M4 7h14M15 4l3 3-3 3M20 17H6M9 14l-3 3 3 3" />,
  budgets: (
    <>
      <path d="M12 3a9 9 0 1 0 9 9h-9z" />
      <path d="M15 3.5A9 9 0 0 1 20.5 9H15z" />
    </>
  ),
  income: <path d="M12 3v10M8 9l4 4 4-4M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />,
  subs: <path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />,
  owed: (
    <>
      <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6z" />
      <path d="M10 8v1.5M10 11.25v1.5M10 14.5V16" />
    </>
  ),
  receipts: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  closes: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4M9 15l2 2 4-4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
};

export function Icon({ name }: { name: string }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
