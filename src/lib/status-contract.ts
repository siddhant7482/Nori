/* ============================================================
   The CommandHQ status contract, declared locally.

   The hub declares the same shape in its own repo. That duplication
   is deliberate and matches Warden and Vault: separate repos deploy on
   their own schedule, and a shared package for twenty lines of types
   would couple releases that have no reason to be coupled.
   ============================================================ */

export type StatusLevel = "ok" | "warn" | "attention" | "down";

export interface StatusMetric {
  label: string;
  value: string;
}

export interface StatusAlert {
  /** Readable out of context: it sits beside alerts from other apps. */
  text: string;
  due?: string;
  severity: "info" | "soon" | "urgent";
  /** Path within Nori. */
  href?: string;
}

export interface AppStatus {
  app: "nori";
  level: StatusLevel;
  headline: string;
  metrics: StatusMetric[];
  alerts: StatusAlert[];
  at: string;
}
