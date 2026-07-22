import type { Objective } from "@/lib/types";

// Utilitaires visuels partagés des caps : couleur stable, puce d'échéance,
// libellé de momentum. (Rendus consommés par app/page.tsx et Carte.tsx.)

// L'identité VISUELLE d'un cap : une couleur stable (ordre de création),
// partagée par toutes les vues — l'œil apprend « indigo = job ».
export const CAP_PALETTE = [
  "var(--color-cap)", // indigo
  "#2e6f63", // teal
  "#c4703b", // terracotta
  "#8a5cf6", // violet
  "#b0843a", // gold
];

export function capColor(objectives: Objective[], id?: string): string {
  const i = id ? objectives.findIndex((o) => o.id === id) : -1;
  return i >= 0 ? CAP_PALETTE[i % CAP_PALETTE.length] : "var(--color-cap)";
}

export function dayDiff(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export function momentumLabel(o: Objective): string | null {
  if (!o.lastMovedAt) return null;
  const n = -dayDiff(o.lastMovedAt);
  if (n <= 1) return "avance";
  return `dort depuis ${n}j`;
}

export function deadlineChip(o: Objective): { label: string; urgent: boolean } | null {
  if (!o.deadline) return null;
  const n = dayDiff(o.deadline);
  if (n < 0) return { label: "échéance passée", urgent: true };
  if (n === 0) return { label: "échéance aujourd'hui", urgent: true };
  if (n === 1) return { label: "J−1", urgent: true };
  return { label: `J−${n}`, urgent: n <= 7 };
}
