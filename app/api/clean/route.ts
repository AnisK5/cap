import { requireUser } from "@/lib/auth";
import { getState, putState } from "@/lib/db";
import { dedupeObjectives } from "@/lib/merge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nettoyage de la carte à la demande : fusion DÉTERMINISTE des doublons de
// flux/étapes dans chaque cap (identiques ou l'un sous-ensemble de l'autre),
// sans perte (« fait »/état préservés, titre le plus riche gardé). Renvoie le
// nombre fusionné pour un retour honnête. Snapshots quotidiens = filet.
export async function POST() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const current = await getState(supabase, user.id);
  if (!current || current.state.objectives.length === 0) {
    return Response.json({ state: current?.state ?? null, updatedAt: null, removed: 0 });
  }

  const { objectives, removed } = dedupeObjectives(current.state.objectives);
  if (removed === 0) {
    return Response.json({ ...current, removed: 0 });
  }

  const next = { ...current.state, objectives };
  const written = await putState(supabase, user.id, next, current.updatedAt);
  return Response.json({ ...(written ?? current), removed: written ? removed : 0 });
}
