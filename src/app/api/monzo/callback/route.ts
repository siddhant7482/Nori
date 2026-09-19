import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeCode } from "@/monzo/oauth";

export const dynamic = "force-dynamic";

function page(title: string, body: string, status = 400) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Nori</title>
     <body style="background:#eef7f0;color:#15261d;font:16px/1.6 system-ui,sans-serif;padding:3rem;max-width:44rem">
     <p style="font-weight:700;color:#0e5c3a">nori</p>
     <p style="font-size:1.4rem">${title}</p>
     <p style="color:#56695e">${body}</p>
     <p><a href="/settings" style="color:#0e5c3a">Back to Settings</a></p></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/* Monzo sends you back here with a code. It is traded for tokens at
 * once, and you land on Settings, which starts watching for the
 * in-app approval so the first sync can begin inside the window. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) return page("Monzo didn't authorise Nori.", `Monzo said: ${error}`);
  if (!code || !state) return page("No authorisation code came back.", "Start again from Settings.");

  const jar = await cookies();
  const expected = jar.get("nori_oauth_state")?.value;
  jar.delete("nori_oauth_state");
  if (!expected || expected !== state) return page("This redirect didn't start from Nori.", "Start again from Settings, in the same browser.");

  try {
    await exchangeCode(code);
  } catch (e) {
    return page("Monzo refused the login.", e instanceof Error ? e.message : String(e), 502);
  }
  return NextResponse.redirect(new URL("/settings?monzo=approve#monzo", process.env.MONZO_REDIRECT_URI ?? request.url));
}
