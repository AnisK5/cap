import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/auth";
import { getState, putState } from "@/lib/db";
import { mondayIso } from "@/lib/merge";
import { CHAT_MODEL } from "@/lib/model";
import { WEEK_INSTRUCTION, WEEK_TOOL, reconcileStateSummary } from "@/lib/prompts";
import {
  DAY_KEYS,
  DAY_NAMES,
  normalizeWeekPlan,
  todayDayIdx,
  type RawWeekPlan,
} from "@/lib/week";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bouton « Proposer la semaine » : le coach pose le plan macro (quel cap dans
// quelle demi-journée, avec le pourquoi + l'atterrissage projeté par cap), on le
// range dans l'état (blob jsonb, zéro migration) et on renvoie l'état à jour.
export async function POST() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Clé API manquante." }, { status: 500 });
  }

  const current = await getState(supabase, user.id);
  if (!current || current.state.objectives.length === 0) {
    return Response.json({ state: current?.state ?? null, updatedAt: null });
  }

  const idx = todayDayIdx();
  const now = new Date();
  const todayLabel = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);

  const userMsg = `${reconcileStateSummary(current.state)}

NOUS SOMMES ${todayLabel}. Pose la forme de ma semaine, du jour présent (${DAY_NAMES[DAY_KEYS[idx]]}) jusqu'à dimanche inclus. Ne place rien dans un jour passé. Réfléchis à l'ordre et aux dépendances, garde beaucoup de blanc, et projette où chaque cap atterrit en fin de semaine.`;

  const client = new Anthropic({ apiKey });
  let raw: RawWeekPlan;
  try {
    const res = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: 1500,
      system: [
        {
          type: "text",
          text: WEEK_INSTRUCTION,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [WEEK_TOOL],
      tool_choice: { type: "tool", name: "poser_la_semaine" },
      messages: [{ role: "user", content: userMsg }],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      return Response.json({ error: "Pas de plan généré." }, { status: 502 });
    }
    raw = block.input as RawWeekPlan;
  } catch {
    return Response.json({ error: "Génération impossible." }, { status: 502 });
  }

  // On ancre le plan à la semaine civile en cours (lundi local) : c'est la
  // référence de `weekOffset = 0`, ce qui permet au plan de se décaler tout seul
  // quand on change de semaine (cf. rollWeek).
  const weekOf = mondayIso(
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now),
  );
  const weekPlan = { ...normalizeWeekPlan(raw, current.state.objectives), weekOf };

  const written = await putState(
    supabase,
    user.id,
    { ...current.state, weekPlan },
    current.updatedAt,
  );
  return Response.json(written ?? { state: { ...current.state, weekPlan }, updatedAt: current.updatedAt });
}
