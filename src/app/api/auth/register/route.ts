import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { clientKey, createSession, hashPassword, rateLimit, validateCredentials } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!rateLimit("reg:" + clientKey(req), 10)) {
    return Response.json({ error: "Zu viele Versuche. Bitte kurz warten." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const err = validateCredentials(body?.username, body?.password);
  if (err) return Response.json({ error: err }, { status: 400 });

  const username = (body.username as string).trim();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  if (existing.length) return Response.json({ error: "Benutzername bereits vergeben." }, { status: 409 });

  const passwordHash = await hashPassword(body.password);
  const [row] = await db.insert(users).values({ username, passwordHash }).returning({ id: users.id });
  const token = await createSession(row.id);
  return Response.json({ token, username });
}
