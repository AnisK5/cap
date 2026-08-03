import { requireUser } from "@/lib/auth";
import { getSessionById, listRecentSessions } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET : l'historique des fils passés. Sans `id`, la liste résumée (pour la
// vue « Historique ») ; avec `?id=…`, le fil complet d'un jour, en lecture seule.
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const session = await getSessionById(auth.supabase, auth.user.id, id);
    if (!session) {
      return Response.json({ error: "Fil introuvable." }, { status: 404 });
    }
    return Response.json({ session });
  }

  const sessions = await listRecentSessions(auth.supabase, auth.user.id);
  return Response.json({ sessions });
}
