import { requireUser } from "@/lib/auth";
import { createSession, getLatestSession, getState, putState } from "@/lib/db";
import { mondayIso, rollDay, rollWeek } from "@/lib/merge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  tz?: string; // fuseau IANA du client (le serveur vit en UTC)
}

// Jour civil (AAAA-MM-JJ) dans le fuseau de la personne.
function localDay(d: Date, tz?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// POST : renvoie le FIL DU JOUR (modèle compagnon continu). Idempotent :
//  - même jour que la dernière session → on la reprend (fil continu) ;
//  - jour différent ET vraie pause (> 4 h) → ROLLOVER : on archive la veille
//    dans l'historique, on remet la journée à zéro, on ouvre un fil neuf.
// Le seuil de 4 h préserve le travail tard le soir qui franchit minuit.
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  let tz: string | undefined;
  try {
    tz = ((await req.json()) as Body).tz;
  } catch {
    tz = undefined;
  }

  const now = new Date();
  const currentMonday = mondayIso(localDay(now, tz));
  const latest = await getLatestSession(supabase, user.id);

  const lastDay = latest ? localDay(new Date(latest.updatedAt), tz) : null;
  const gapMin = latest
    ? (now.getTime() - new Date(latest.updatedAt).getTime()) / 60000
    : Infinity;
  const sameDay = lastDay === localDay(now, tz);
  const resume = !!latest && (sameDay || gapMin < 240);

  // Rollovers (jour + semaine) en une seule écriture. Le jour ne se remet à zéro
  // qu'à une VRAIE bascule (autre jour + pause > 4 h) ; la semaine, elle, se
  // décale dès qu'on a changé de semaine civile — même sans grande pause, même
  // si on reprend le fil du jour (cas Sun→Mon franchi vite). rollWeek est
  // idempotent : même semaine → aucun changement, aucune écriture.
  const stored = await getState(supabase, user.id);
  // L'état à renvoyer au client : si un rollover l'a modifié, on renvoie la
  // version à jour pour que la grille se décale À L'ÉCRAN tout de suite, sans
  // attendre une réconciliation (sinon le plan de la semaine passée resterait
  // affiché, avec son faux sentiment de non-fait).
  let rolled = stored;
  if (stored) {
    let next = stored.state;
    if (latest && !resume && lastDay) next = rollDay(next, lastDay);
    next = rollWeek(next, currentMonday);
    if (next !== stored.state) {
      rolled = (await putState(supabase, user.id, next)) ?? {
        state: next,
        updatedAt: stored.updatedAt,
      };
    }
  }

  if (resume) {
    // On reprend le fil du jour.
    return Response.json({
      session: {
        id: latest!.id,
        messages: latest!.messages,
        updatedAt: latest!.updatedAt,
      },
      rolledOver: false,
      state: rolled,
    });
  }

  const id = await createSession(supabase, user.id);
  return Response.json({
    session: { id, messages: [], updatedAt: now.toISOString() },
    rolledOver: !!latest,
    state: rolled,
  });
}
