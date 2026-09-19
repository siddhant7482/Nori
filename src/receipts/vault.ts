/* ============================================================
   Vault is where the photographs live.

   Nori keeps the figures it read and the link to the payment; the
   image itself belongs in the file app, where it is searchable,
   counted against the same allocation, and backed up with everything
   else. Nori reaches it with the shared machine key, because it has
   no browser and no session.

   If Vault is down, the receipt is not lost: nothing is written here
   until the upload succeeds, so the answer is "try again", never a
   row pointing at a file that does not exist.
   ============================================================ */

const FOLDER = "Receipts";

function base(): string {
  const u = process.env.VAULT_URL;
  if (!u) throw new Error("VAULT_URL is not set, so receipt photographs have nowhere to go.");
  return u.replace(/\/$/, "");
}

function key(): string {
  const k = process.env.HQ_API_TOKEN;
  if (!k) throw new Error("HQ_API_TOKEN is not set, so Vault will refuse Nori.");
  return k;
}

export function vaultConfigured(): boolean {
  return Boolean(process.env.VAULT_URL && process.env.HQ_API_TOKEN);
}

export interface Stored {
  id: number;
  key: string;
  name: string;
  bytes: number;
}

/** Puts the photograph in Vault's Receipts folder under a name that
 *  says what it is at a glance. */
export async function putReceipt(bytes: Uint8Array, name: string, contentType: string): Promise<Stored> {
  const url = new URL(base() + "/api/upload");
  url.searchParams.set("name", name);
  url.searchParams.set("folder", FOLDER);
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key()}`, "content-type": contentType, "content-length": String(bytes.byteLength) },
    body: bytes as BodyInit,
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Vault refused the photograph (${res.status}): ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as Stored;
}

/** Tells Vault what the file is for, so deleting it is an informed
 *  decision rather than a surprise. */
export async function registerRef(objectKey: string, label: string, href: string): Promise<void> {
  await fetch(base() + "/api/refs", {
    method: "POST",
    headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
    body: JSON.stringify({ app: "nori", objectKey, label, href }),
    cache: "no-store",
  }).catch(() => {
    /* A missing reference is a smaller problem than a failed upload,
     * and the next receipt will register its own. */
  });
}

/** The bytes back, for showing the photograph inside Nori. */
export async function getReceipt(objectId: number): Promise<{ body: ReadableStream<Uint8Array> | null; type: string } | null> {
  const res = await fetch(`${base()}/api/objects/${objectId}/url?intent=preview`, { headers: { authorization: `Bearer ${key()}` }, cache: "no-store" });
  if (!res.ok) return null;
  const { url } = (await res.json()) as { url: string };
  const file = await fetch(url.startsWith("http") ? url : base() + url, { cache: "no-store" });
  if (!file.ok) return null;
  return { body: file.body, type: file.headers.get("content-type") ?? "image/jpeg" };
}
