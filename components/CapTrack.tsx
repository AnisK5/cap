"use client";

import type { Objective } from "@/lib/types";

// Fraction d'avancée = étapes franchies / total. Honnête (discret, pas un %
// inventé) : si pas d'étapes, on ne feint rien (piste en pointillé).
function stepFrac(o: Objective): number | null {
  if (!o.steps?.length) return null;
  const done = o.steps.filter((s) => s.done).length;
  // On place le marqueur « après la dernière franchie » : done/total.
  return done / o.steps.length;
}

export function dayDiff(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

// Le cap porte-t-il un enjeu « dur » (échéance) ? sinon « mou » (récompense).
export function isHard(o: Objective): boolean {
  return !!o.deadline;
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

// Le chemin : une piste, une portion remplie jusqu'au marqueur (l'avancée),
// et un halo sur le jalon d'arrivée. Couleur = indigo (dur) / or (mou).
export function CapTrack({
  objective,
  size = "sm",
}: {
  objective: Objective;
  size?: "sm" | "lg";
}) {
  const hard = isHard(objective);
  const color = hard ? "var(--color-cap)" : "var(--color-gold)";
  const frac = stepFrac(objective);
  const lg = size === "lg";
  const h = lg ? 8 : 6;

  return (
    <div className="w-full">
      <div
        className="relative w-full rounded-full"
        style={{ height: h, background: "var(--color-sink)" }}
      >
        {frac !== null ? (
          <>
            <div
              className="absolute left-0 top-0 h-full rounded-full transition-all duration-700"
              style={{ width: `${frac * 100}%`, background: color, opacity: 0.35 }}
            />
            <div
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-700"
              style={{
                left: `${frac * 100}%`,
                width: lg ? 12 : 9,
                height: lg ? 12 : 9,
                background: color,
                boxShadow: `0 0 0 ${lg ? 4 : 3}px var(--color-canvas)`,
              }}
            />
          </>
        ) : (
          // Avancée inconnue : piste en pointillé discret, pas de faux marqueur.
          <div
            className="absolute inset-0 rounded-full border border-dashed"
            style={{ borderColor: "var(--color-line)" }}
          />
        )}
        {/* jalon d'arrivée */}
        <div
          className="absolute top-1/2 right-0 -translate-y-1/2 rounded-full"
          style={{ width: lg ? 6 : 5, height: lg ? 6 : 5, background: color, opacity: 0.5 }}
        />
      </div>
    </div>
  );
}
