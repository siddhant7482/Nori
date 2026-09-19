/**
 * The seed category set.
 *
 * This list is injected verbatim into the categorisation prompt, so editing it
 * changes model behaviour. Treat additions and renames as prompt changes:
 * re-run the fixture suite before shipping one.
 */

export type CategoryDef = {
  /** Stable key. Persisted and sent to the model — never renamed casually. */
  slug: string;
  name: string;
  /** Emoji used until per-category icon selection exists. */
  icon: string;
  /** Index into the --chart-N ramp in globals.css. */
  chart: number;
};

export const CATEGORIES: CategoryDef[] = [
  { slug: "groceries", name: "Groceries", icon: "🛒", chart: 1 },
  { slug: "restaurants", name: "Restaurants & Cafés", icon: "🍽️", chart: 3 },
  { slug: "transport", name: "Transport", icon: "🚆", chart: 2 },
  { slug: "fuel", name: "Fuel", icon: "⛽", chart: 5 },
  { slug: "travel", name: "Travel & Accommodation", icon: "✈️", chart: 6 },
  { slug: "utilities", name: "Utilities", icon: "💡", chart: 4 },
  { slug: "housing", name: "Rent & Mortgage", icon: "🏠", chart: 7 },
  { slug: "health", name: "Health & Pharmacy", icon: "💊", chart: 5 },
  { slug: "personal-care", name: "Personal Care", icon: "🧴", chart: 7 },
  { slug: "clothing", name: "Clothing", icon: "👕", chart: 4 },
  { slug: "electronics", name: "Electronics", icon: "🔌", chart: 2 },
  { slug: "home", name: "Home & Garden", icon: "🪴", chart: 8 },
  { slug: "entertainment", name: "Entertainment", icon: "🎬", chart: 7 },
  { slug: "subscriptions", name: "Subscriptions", icon: "🔁", chart: 4 },
  { slug: "education", name: "Education", icon: "📚", chart: 6 },
  { slug: "office", name: "Office & Software", icon: "💼", chart: 2 },
  { slug: "gifts", name: "Gifts & Donations", icon: "🎁", chart: 7 },
  { slug: "fees", name: "Fees & Charges", icon: "🏦", chart: 5 },
  { slug: "other", name: "Other", icon: "📄", chart: 8 },
];

export const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug) as [
  string,
  ...string[],
];

export function categoryBySlug(slug: string | null | undefined) {
  if (!slug) return undefined;
  return CATEGORIES.find((c) => c.slug === slug);
}

/** Rendered into the prompt so the model sees names, not just slugs. */
export function categoryPromptList(): string {
  return CATEGORIES.map((c) => `- ${c.slug}: ${c.name}`).join("\n");
}
