import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/auth";
import { getSessionById, getState, putState } from "@/lib/db";
import {
  applyReconciliation,
  dedupeObjectives,
  type Reconciliation,
} from "@/lib/merge";
import { RECONCILE_MODEL } from "@/lib/model";
import {
  RECONCILE_INSTRUCTION,
  RECONCILE_TOOL,
  reconcileStateSummary,
} from "@/lib/prompts";
import { EMPTY_STATE } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  sessionId: string;
}

// Lit la conversation en DB, demande la réconciliation au modèle (tool-use =
// JSON garanti), puis APPLIQUE la fusion côté serveur : lecture de l'état,
// merge, écriture avec verrou optimiste (retry si une écriture concurrente
// est passée entre-temps). Le client reçoit l'état final et le remplace.
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Clé API manquante." }, { status: 500 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  const { sessionId } = body;
  if (!sessionId) {
    return Response.json({ error: "sessionId manquant." }, { status: 400 });
  }

  const session = await getSessionById(supabase, user.id, sessionId);
  if (!session || session.messages.length === 0) {
    return Response.json({ error: "Session introuvable ou vide." }, { status: 404 });
  }

  const transcript = session.messages
    .map((m) => `${m.role === "user" ? "MOI" : "CAP"} : ${m.content}`)
    .join("\n\n");

  const client = new Anthropic({ apiKey });

  try {
    const before = await getState(supabase, user.id);
    const res = await client.messages.create({
      model: RECONCILE_MODEL,
      // Marge large : la réconciliation ré-émet parfois l'état complet (caps +
      // semaine complète + journée) ; à 2000 le tool_use pouvait être tronqué
      // (JSON partiel → extraction perdue, dont la semaine). On ne paie que ce
      // qui est produit, la sortie est bornée par le schéma de l'outil.
      max_tokens: 6000,
      // Instruction + outil sont statiques → mis en cache (l'état/le transcript,
      // volatils, sont dans le message user, après le préfixe caché).
      system: [
        {
          type: "text",
          text: RECONCILE_INSTRUCTION,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [RECONCILE_TOOL],
      tool_choice: { type: "tool", name: "enregistrer" },
      messages: [
        {
          role: "user",
          content: `${reconcileStateSummary(before?.state ?? EMPTY_STATE)}\n\n=== CONVERSATION ===\n${transcript}\n\n=== FIN ===\n\nEnregistre la réconciliation.`,
        },
      ],
    });

    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new Error("Pas de sortie structurée renvoyée.");
    }
    const r = block.input as Reconciliation;

    // Fusion + écriture, avec retry si l'état a bougé pendant l'appel LLM
    // (autre réconcile encore en vol, édition manuelle…). Tout commit en direct.
    let written = null;
    for (let attempt = 0; attempt < 3 && !written; attempt++) {
      const current = await getState(supabase, user.id);
      const next = applyReconciliation(current?.state ?? EMPTY_STATE, r);
      // Auto-nettoyage : la carte se dédoublonne à chaque écriture (caps en
      // double + flux/étapes redondants), pour de vrai — pas seulement au bouton.
      const cleaned = { ...next, objectives: dedupeObjectives(next.objectives).objectives };
      written = await putState(supabase, user.id, cleaned, current?.updatedAt);
    }
    if (!written) {
      throw new Error("Écritures concurrentes répétées — réessaie.");
    }

    return Response.json({ ...written, note: r.note ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur de réconciliation.";
    return Response.json({ error: msg }, { status: 500 });
  }
}
