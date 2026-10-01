/**
 * Server-seitige Authentifizierung.
 *  - Passwörter: scrypt mit zufälligem Salt
 *  - Sitzungen: zufälliges Token (Bearer), in der DB nur als SHA-256 gespeichert
 *  - Einfaches In-Memory-Rate-Limit gegen Brute-Force
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";

const SESSION_DAYS = 30;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Legt eine Sitzung an und gibt das (nur einmal sichtbare) Token zurück. */
export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000),
  });
  return token;
}

export function tokenFromRequest(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h || !h.startsWith("Bearer ")) return null;
  const t = h.slice(7).trim();
  return /^[a-f0-9]{64}$/.test(t) ? t : null;
}

/** Liefert den eingeloggten Nutzer (oder null). */
export async function getUserFromRequest(req: Request): Promise<{ id: number; username: string } | null> {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

/* ---------- Rate Limit (pro Prozess, reicht für eine einzelne Instanz) ---------- */
const attempts = new Map<string, { n: number; reset: number }>();

/** true = erlaubt. Maximal `max` Versuche pro Fenster. */
export function rateLimit(key: string, max = 10, windowMs = 60_000): boolean {
  const now = Date.now();
  const e = attempts.get(key);
  if (!e || e.reset < now) {
    attempts.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  e.n += 1;
  return e.n <= max;
}

export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== "string" || !/^[A-Za-z0-9_-]{3,24}$/.test(username))
    return "Benutzername: 3–24 Zeichen (Buchstaben, Zahlen, _ und -).";
  if (typeof password !== "string" || password.length < 6 || password.length > 100)
    return "Passwort: mindestens 6 Zeichen.";
  return null;
}
