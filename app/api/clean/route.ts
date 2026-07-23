import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/auth";
import { getState, putState } from "@/lib/db";
import { applyReconciliation, type Reconciliation } from "@/lib/merge";
import { RECONCILE_MODEL } from "@/lib/model";
import {
  CLEAN_INSTRUCTION,
  RECONCILE_TOOL,
  reconcileStateSummary,
} from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Passe IA de nettoyage de la carte, à la demande : fusionne les doublons de
// flux/étapes SANS perte. Réutilise la fusion de la réconciliation (les ids,
// « done » et états survivent par match de titre ; une liste de flux renvoyée
// REMPLACE l'existante → le doublon disparaît). Snapshots quotidiens = filet.
export async function POST() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Clé API manquante." }, { status: 500 });
  }

  const before = await getState(supabase, user.id);
  if (!before || before.state.objectives.length === 0) {
    return Response.json(before ?? { state: null, updatedAt: null });
  }

  const client = new Anthropic({ apiKey });
  try {
    const res = await client.messages.create({
      model: RECONCILE_MODEL,
      max_tokens: 2000,
      system: CLEAN_INSTRUCTION,
      tools: [RECONCILE_TOOL],
      tool_choice: { type: "tool", name: "enregistrer" },
      messages: [
        {
          role: "user",
          content: `${reconcileStateSummary(before.state)}\n\nNettoie la carte (fusionne les doublons de flux/étapes, sans rien perdre).`,
        },
      ],
    });

    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new Error("Pas de sortie structurée renvoyée.");
    }
    const r = block.input as Reconciliation;
    // On ne garde QUE la déduplication de la carte : rien d'autre ne doit bouger.
    const safe: Reconciliation = { objectives: r.objectives };

    let written = null;
    for (let attempt = 0; attempt < 3 && !written; attempt++) {
      const current = await getState(supabase, user.id);
      const next = applyReconciliation(current?.state ?? before.state, safe);
      written = await putState(supabase, user.id, next, current?.updatedAt);
    }
    if (!written) {
      throw new Error("Écritures concurrentes répétées — réessaie.");
    }
    return Response.json(written);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur de nettoyage.";
    return Response.json({ error: msg }, { status: 500 });
  }
}
