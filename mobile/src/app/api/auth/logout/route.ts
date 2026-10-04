import { destroySession, tokenFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = tokenFromRequest(req);
  if (token) await destroySession(token);
  return Response.json({ ok: true });
}
