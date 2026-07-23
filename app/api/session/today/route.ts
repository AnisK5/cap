import { requireUser } from "@/lib/auth";
import { createSession, getLatestSession, getState, putState } from "@/lib/db";
import { rollDay } from "@/lib/merge";

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
  const latest = await getLatestSession(supabase, user.id);

  if (latest) {
    const lastDay = localDay(new Date(latest.updatedAt), tz);
    const gapMin = (now.getTime() - new Date(latest.updatedAt).getTime()) / 60000;
    const sameDay = lastDay === localDay(now, tz);

    if (sameDay || gapMin < 240) {
      // On reprend le fil du jour.
      return Response.json({
        session: {
          id: latest.id,
          messages: latest.messages,
          updatedAt: latest.updatedAt,
        },
        rolledOver: false,
      });
    }

    // Nouveau jour : on archive la veille et on remet la journée à zéro.
    const stored = await getState(supabase, user.id);
    if (stored) {
      await putState(supabase, user.id, rollDay(stored.state, lastDay));
    }
  }

  const id = await createSession(supabase, user.id);
  return Response.json({
    session: { id, messages: [], updatedAt: now.toISOString() },
    rolledOver: !!latest,
  });
}
