import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/auth";
import { getState, putState } from "@/lib/db";
import {
  applyReconciliation,
  dedupeObjectives,
  type Reconciliation,
} from "@/lib/merge";
import { RECONCILE_MODEL } from "@/lib/model";
import { RECONCILE_TOOL } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Un titre « à rallonge » : plus de 5 mots ou trop long pour être scanné.
const isLong = (t: string) =>
  t.trim().split(/\s+/).length > 5 || t.trim().length > 34;

// Bouton « Nettoyer » : range la carte, sans perte.
//  1) Dédup DÉTERMINISTE (caps en double + flux/étapes redondants) — fiable.
//  2) Passe IA CIBLÉE qui raccourcit les titres de caps trop longs (renommage
//     via previousTitle → id/flux/étapes préservés). Tâche simple = fiable.
export async function POST() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const current = await getState(supabase, user.id);
  if (!current || current.state.objectives.length === 0) {
    return Response.json({
      state: current?.state ?? null,
      updatedAt: null,
      removed: 0,
      shortened: 0,
    });
  }

  // 1) Dédup déterministe.
  const dd = dedupeObjectives(current.state.objectives);
  let objectives = dd.objectives;
  let removed = dd.removed;
  let shortened = 0;

  // 2) Raccourcir les titres de caps trop longs.
  const longCaps = objectives.filter((o) => isLong(o.title));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (longCaps.length > 0 && apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      const res = await client.messages.create({
        model: RECONCILE_MODEL,
        max_tokens: 600,
        system:
          "Tu raccourcis des titres de projets trop longs (des phrases) en 2-5 mots scannables, SANS perdre le sens (le détail vit ailleurs, pas dans le titre). Pour CHAQUE titre trop long, appelle l'outil enregistrer avec objectives:[{previousTitle: le titre EXACT actuel, title: la version courte}]. Ne renvoie QUE ceux à raccourcir, rien d'autre.",
        tools: [RECONCILE_TOOL],
        tool_choice: { type: "tool", name: "enregistrer" },
        messages: [
          {
            role: "user",
            content: `Titres de caps actuels :\n${longCaps
              .map((o) => `- ${o.title}`)
              .join("\n")}\n\nRaccourcis ceux qui sont trop longs.`,
          },
        ],
      });
      const block = res.content.find((b) => b.type === "tool_use");
      if (block && block.type === "tool_use") {
        const r = block.input as Reconciliation;
        const renames = (r.objectives ?? []).filter(
          (o) => o.previousTitle && o.title && o.title !== o.previousTitle,
        );
        if (renames.length > 0) {
          const merged = applyReconciliation(
            { ...current.state, objectives },
            { objectives: renames },
          );
          const dd2 = dedupeObjectives(merged.objectives);
          objectives = dd2.objectives;
          removed += dd2.removed;
          shortened = renames.length;
        }
      }
    } catch {
      // La dédup a déjà eu lieu : on n'échoue pas tout le nettoyage pour ça.
    }
  }

  if (removed === 0 && shortened === 0) {
    return Response.json({ ...current, removed: 0, shortened: 0 });
  }

  const written = await putState(
    supabase,
    user.id,
    { ...current.state, objectives },
    current.updatedAt,
  );
  return Response.json({
    ...(written ?? current),
    removed: written ? removed : 0,
    shortened: written ? shortened : 0,
  });
}
