// Constantes partagées de la vue Semaine (grain lâche : demi-journées + soir).
// Utilisées côté API (/api/week) et côté UI (Carte → vue Semaine).

import type { WeekDayKey, WeekPart } from "./types";

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
