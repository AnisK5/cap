import { requireUser } from "@/lib/auth";
import { createSession, getOpenSessionToday } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET : la session ouverte du jour (celle qu'on reprend après un refresh).
export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const session = await getOpenSessionToday(auth.supabase, auth.user.id);
  return Response.json({ session });
}

// POST : démarre une nouvelle session (première du jour, ou « Recommencer »).
export async function POST() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const id = await createSession(auth.supabase, auth.user.id);
  return Response.json({ session: { id, messages: [], landed: false } });
}
