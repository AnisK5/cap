import type { DayLog } from "./types";

// AAAA-MM-JJ en heure LOCALE — même format que le rollover (en-CA), pour que les
// jours archivés et « aujourd'hui » se comparent sur la même échelle.
function localYMD(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Un jour « tenu » = au moins une victoire ce jour-là. On lit le plan s'il
// existait, sinon les priorités (même règle qu'à l'affichage du jour).
function dayHeld(h: DayLog): boolean {
  const its = h.dayPlan && h.dayPlan.length ? h.dayPlan : h.priorities;
  return (its ?? []).some((it) => it.done);
}

// La SÉRIE, de façon cohérente : le nombre de jours calendaires CONSÉCUTIFS,
// jusqu'à aujourd'hui, avec au moins une victoire. On s'appuie sur la DATE de
// chaque jour archivé — pas sur sa simple position dans la liste : un jour sauté
// (aucune entrée d'historique, ou entrée sans rien de coché) ROMPT la série,
// alors que l'ancien calcul enchaînait les entrées comme si elles se suivaient.
// Aujourd'hui vient du direct (doneTodayCount), pas de l'historique.
export function computeStreak(
  history: DayLog[],
  doneTodayCount: number,
  now: Date = new Date(),
): number {
  const heldByDay = new Map<string, boolean>();
  for (const h of history) heldByDay.set(h.day, dayHeld(h));

  const todayKey = localYMD(now);
  heldByDay.set(todayKey, doneTodayCount > 0);

  // On part d'aujourd'hui s'il est déjà tenu ; sinon de la veille, pour qu'une
  // série en cours reste visible avant la première coche du jour (sans la rompre).
  const cursor = new Date(now);
  if (!heldByDay.get(todayKey)) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  // Garde-fou : l'historique est cappé, mais on borne quand même la boucle.
  for (let guard = 0; guard < 400; guard++) {
    if (!heldByDay.get(localYMD(cursor))) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
