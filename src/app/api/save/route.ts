import { eq } from "drizzle-orm";
import { db } from "@/db";
import { saves } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_BYTES = 600_000;

/** Spielstand laden */
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "Nicht eingeloggt." }, { status: 401 });
  const [row] = await db.select().from(saves).where(eq(saves.userId, user.id)).limit(1);
  if (!row) return Response.json({ save: null });
  return Response.json({ save: row.data, updatedAt: row.updatedAt });
}

/** Spielstand speichern (ein Slot pro Account) */
export async function PUT(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "Nicht eingeloggt." }, { status: 401 });

  const text = await req.text();
  if (text.length > MAX_BYTES) return Response.json({ error: "Spielstand zu groß." }, { status: 413 });
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return Response.json({ error: "Ungültige Daten." }, { status: 400 });
  }
  const d = data as Record<string, unknown>;
  // Minimale Strukturprüfung – die Engine validiert beim Laden zusätzlich.
  if (!d || typeof d.seed !== "number" || !Array.isArray(d.buildings) || typeof d.res !== "object") {
    return Response.json({ error: "Ungültiger Spielstand." }, { status: 400 });
  }
  const level = Math.max(1, Math.min(99, Math.floor(Number(d.level) || 1)));
  const population = Math.max(0, Math.floor(Number(d.pop) || 0));
  const now = new Date();
  await db
    .insert(saves)
    .values({ userId: user.id, data: d, level, population, updatedAt: now })
    .onConflictDoUpdate({ target: saves.userId, set: { data: d, level, population, updatedAt: now } });
  return Response.json({ ok: true, updatedAt: now });
}
