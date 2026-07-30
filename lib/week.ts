// Constantes partagées de la vue Semaine (grain lâche : demi-journées + soir).
// Utilisées côté API (/api/week) et côté UI (Carte → vue Semaine).

import type {
  WeekDayKey,
  WeekLanding,
  WeekPart,
  WeekPlan,
  WeekSlot,
} from "./types";

export const DAY_KEYS: WeekDayKey[] = [
  "lun",
  "mar",
  "mer",
  "jeu",
  "ven",
  "sam",
  "dim",
];

export const DAY_SHORT: Record<WeekDayKey, string> = {
  lun: "Lun",
  mar: "Mar",
  mer: "Mer",
  jeu: "Jeu",
  ven: "Ven",
  sam: "Sam",
  dim: "Dim",
};

export const DAY_NAMES: Record<WeekDayKey, string> = {
  lun: "lundi",
  mar: "mardi",
  mer: "mercredi",
  jeu: "jeudi",
  ven: "vendredi",
  sam: "samedi",
  dim: "dimanche",
};

export const PARTS: WeekPart[] = ["matin", "aprem", "soir"];

export const PART_SHORT: Record<WeekPart, string> = {
  matin: "Matin",
  aprem: "Aprèm",
  soir: "Soir",
};

export const ALL_SLOTS = new Set<string>(
  DAY_KEYS.flatMap((d) => PARTS.map((p) => `${d}-${p}`)),
);

// Index du jour courant dans DAY_KEYS (lundi = 0).
export function todayDayIdx(): number {
  return (new Date().getDay() + 6) % 7;
}

export const slotKey = (day: WeekDayKey, part: WeekPart) => `${day}-${part}`;

// Ce que le modèle produit (le coach désigne les caps par TITRE, comme la
// réconciliation). Utilisé par /api/week ET par la réconciliation.
export interface RawWeekPlan {
  intro?: string;
  slots?: { day?: string; part?: string; objective?: string; why?: string }[];
  landings?: { objective?: string; label?: string }[];
}

// Résout titre→id (tolérant), ne garde que des créneaux valides (jour non passé,
// un seul cap par case) et les landings des caps réellement placés.
export function normalizeWeekPlan(
  raw: RawWeekPlan,
  objectives: { id: string; title: string }[],
): WeekPlan {
  const idByTitle = new Map(
    objectives.map((o) => [o.title.trim().toLowerCase(), o.id]),
  );
  const resolveId = (t?: string): string | undefined =>
    t ? idByTitle.get(t.trim().toLowerCase()) : undefined;

  const idx = todayDayIdx();
  const allowed = new Set(
    DAY_KEYS.slice(idx).flatMap((d) => PARTS.map((p) => slotKey(d, p))),
  );

  const seen = new Set<string>();
  const slots: WeekSlot[] = [];
  for (const s of raw.slots ?? []) {
    if (!s || typeof s.day !== "string" || typeof s.part !== "string") continue;
    const key = `${s.day}-${s.part}`;
    if (!ALL_SLOTS.has(key) || !allowed.has(key) || seen.has(key)) continue;
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

  const placed = new Set(slots.map((s) => s.objectiveId));
  const seenLanding = new Set<string>();
  const landings: WeekLanding[] = [];
  for (const l of raw.landings ?? []) {
    const objectiveId = resolveId(l?.objective);
    if (
      !objectiveId ||
      !placed.has(objectiveId) ||
      seenLanding.has(objectiveId) ||
      !l?.label?.trim()
    )
      continue;
    seenLanding.add(objectiveId);
    landings.push({ objectiveId, label: l.label.trim() });
  }

  return {
    generatedAt: new Date().toISOString(),
    intro: raw.intro?.trim() || undefined,
    slots,
    landings: landings.length ? landings : undefined,
  };
}
