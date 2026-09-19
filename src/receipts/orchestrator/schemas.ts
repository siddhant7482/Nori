import { z } from "zod";
import { CATEGORY_SLUGS } from "@/receipts/categories";

/**
 * The extraction contract.
 *
 * Every field is nullable by deliberate design. A model permitted to answer
 * "I could not read that" invents far fewer values than one forced to produce
 * a string, and on smudged thermal paper an honest null is worth more than a
 * plausible guess that silently enters someone's ledger.
 */

export const LineItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  /** Minor units. See lib/money.ts — never a decimal. */
  unitPrice: z.number().int().nullable(),
  total: z.number().int(),
});

export const FieldConfidenceSchema = z.object({
  merchantName: z.number(),
  purchasedAt: z.number(),
  total: z.number(),
  lineItems: z.number(),
});

export const ExtractedReceiptSchema = z.object({
  merchantName: z.string().nullable(),
  merchantAddress: z.string().nullable(),
  /** ISO 8601. Null when unreadable or absent — never inferred from "today". */
  purchasedAt: z.string().nullable(),
  /** ISO-4217. */
  currency: z.string().nullable(),

  // All amounts in the currency's minor unit, as integers.
  subtotal: z.number().int().nullable(),
  taxTotal: z.number().int().nullable(),
  tipTotal: z.number().int().nullable(),
  total: z.number().int().nullable(),

  paymentMethod: z.enum(["CARD", "CASH", "OTHER"]).nullable(),
  cardLast4: z.string().nullable(),

  lineItems: z.array(LineItemSchema),

  /** Chosen from lib/categories.ts. */
  category: z.enum(CATEGORY_SLUGS).nullable(),
  categoryReason: z.string().nullable(),

  fieldConfidence: FieldConfidenceSchema,
});

export type ExtractedReceipt = z.infer<typeof ExtractedReceiptSchema>;
export type ExtractedLineItem = z.infer<typeof LineItemSchema>;

/**
 * Convert to the JSON Schema dialect that strict structured outputs require.
 *
 * The provider rejects a schema unless every object lists *all* of its
 * properties in `required` and sets `additionalProperties: false`. Zod emits
 * neither for nullable fields, so the tree is walked and tightened here rather
 * than hand-maintaining a parallel JSON Schema that would drift from the Zod
 * source of truth.
 */
type JsonSchemaNode = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  [k: string]: unknown;
};

function tighten(node: JsonSchemaNode): JsonSchemaNode {
  if (!node || typeof node !== "object") return node;

  if (node.properties) {
    node.required = Object.keys(node.properties);
    node.additionalProperties = false;
    for (const child of Object.values(node.properties)) tighten(child);
  }
  if (node.items) tighten(node.items);
  if (node.anyOf) node.anyOf.forEach(tighten);

  // `format` and numeric bounds are silently ignored or rejected depending on
  // the provider; drop them rather than risk a 400 on an untested model.
  delete node.format;
  delete node.minimum;
  delete node.maximum;
  delete node.exclusiveMinimum;
  delete node.exclusiveMaximum;

  return node;
}

export function strictJsonSchema(schema: z.ZodType): JsonSchemaNode {
  const raw = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "output",
    unrepresentable: "any",
  }) as JsonSchemaNode;

  // $schema is not accepted inside a response_format json_schema payload.
  delete raw.$schema;
  return tighten(raw);
}

export const EXTRACTED_RECEIPT_JSON_SCHEMA = strictJsonSchema(
  ExtractedReceiptSchema,
);
