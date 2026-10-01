import { getUserFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return Response.json({ error: "Nicht eingeloggt." }, { status: 401 });
  return Response.json({ username: user.username });
}
