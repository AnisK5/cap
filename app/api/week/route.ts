import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/auth";
import { getState, putState } from "@/lib/db";
import { CHAT_MODEL } from "@/lib/model";
import { WEEK_INSTRUCTION, WEEK_TOOL, reconcileStateSummary } from "@/lib/prompts";
import type { WeekDayKey, WeekLanding, WeekPart, WeekPlan, WeekSlot } from "@/lib/types";
import { ALL_SLOTS, DAY_KEYS, DAY_NAMES, PARTS, slotKey, todayDayIdx } from "@/lib/week";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ce que le modèle renvoie via l'outil (cap désigné par son TITRE, comme la
// réconciliation) — on résout ensuite le titre → id côté serveur.
interface RawPlan {
  intro?: string;
  slots?: { day?: string; part?: string; objective?: string; why?: string }[];
  landings?: { objective?: string; label?: string }[];
}

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

  // Résolution tolérante titre → id (le modèle renvoie le titre exact du cap).
  const idByTitle = new Map<string, string>();
  for (const o of current.state.objectives) {
    idByTitle.set(o.title.trim().toLowerCase(), o.id);
  }
  const resolveId = (title?: string): string | undefined =>
    title ? idByTitle.get(title.trim().toLowerCase()) : undefined;

  const idx = todayDayIdx();
  const remainingDays = DAY_KEYS.slice(idx);
  const allowedSlots = new Set(
    remainingDays.flatMap((d) => PARTS.map((p) => slotKey(d, p))),
  );

  const now = new Date();
  const todayLabel = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);

  const userMsg = `${reconcileStateSummary(current.state)}

NOUS SOMMES ${todayLabel}. Pose la forme de ma semaine, du jour présent (${DAY_NAMES[DAY_KEYS[idx]]}) jusqu'à dimanche inclus. Ne place rien dans un jour passé. Réfléchis à l'ordre et aux dépendances, garde beaucoup de blanc, et projette où chaque cap atterrit en fin de semaine.`;

  const client = new Anthropic({ apiKey });
  let raw: RawPlan;
  try {
    const res = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: 1500,
      system: WEEK_INSTRUCTION,
      tools: [WEEK_TOOL],
      tool_choice: { type: "tool", name: "poser_la_semaine" },
      messages: [{ role: "user", content: userMsg }],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      return Response.json({ error: "Pas de plan généré." }, { status: 502 });
    }
    raw = block.input as RawPlan;
  } catch {
    return Response.json({ error: "Génération impossible." }, { status: 502 });
  }

  // On ne garde que des créneaux valides : jour non passé, part connue, cap
  // résoluble, un seul cap par créneau.
  const seen = new Set<string>();
  const slots: WeekSlot[] = [];
  for (const s of raw.slots ?? []) {
    if (!s || typeof s.day !== "string" || typeof s.part !== "string") continue;
    const key = `${s.day}-${s.part}`;
    if (!ALL_SLOTS.has(key) || !allowedSlots.has(key) || seen.has(key)) continue;
    const objectiveId = resolveId(s.objective);
    if (!objectiveId) continue;
    seen.add(key);
    slots.push({
      day: s.day as WeekDayKey,
      part: s.part as WeekPart,
      objectiveId,
      why: s.why?.trim() || undefined,
    });
  }

  // Landings : une par cap réellement placé.
  const placed = new Set(slots.map((s) => s.objectiveId));
  const landings: WeekLanding[] = [];
  const seenLanding = new Set<string>();
  for (const l of raw.landings ?? []) {
    const objectiveId = resolveId(l?.objective);
    if (!objectiveId || !placed.has(objectiveId) || seenLanding.has(objectiveId)) continue;
    if (!l?.label?.trim()) continue;
    seenLanding.add(objectiveId);
    landings.push({ objectiveId, label: l.label.trim() });
  }

  const weekPlan: WeekPlan = {
    generatedAt: new Date().toISOString(),
    intro: raw.intro?.trim() || undefined,
    slots,
    landings: landings.length ? landings : undefined,
  };

  const written = await putState(
    supabase,
    user.id,
    { ...current.state, weekPlan },
    current.updatedAt,
  );
  return Response.json(written ?? { state: { ...current.state, weekPlan }, updatedAt: current.updatedAt });
}
