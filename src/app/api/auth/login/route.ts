import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { clientKey, createSession, rateLimit, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!rateLimit(`login:${clientKey(req)}:${username.toLowerCase()}`, 8)) {
    return Response.json({ error: "Zu viele Versuche. Bitte kurz warten." }, { status: 429 });
  }
  if (!username || !password) return Response.json({ error: "Bitte Benutzername und Passwort eingeben." }, { status: 400 });

  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) return Response.json({ error: "Benutzername oder Passwort falsch." }, { status: 401 });

  const token = await createSession(user.id);
  return Response.json({ token, username: user.username });
}
