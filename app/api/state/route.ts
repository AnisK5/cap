import { requireUser } from "@/lib/auth";
import { getState, putState } from "@/lib/db";
import type { CapState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const stored = await getState(auth.supabase, auth.user.id);
  return Response.json(stored ?? { state: null, updatedAt: null });
}

// PUT : remplace l'état entier. Sert à l'import initial (localStorage → DB)
// et aux éditions manuelles (suppression d'un cap, renommage inline).
export async function PUT(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let body: { state?: CapState };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  if (!body.state || !Array.isArray(body.state.objectives)) {
    return Response.json({ error: "État invalide." }, { status: 400 });
  }

  const stored = await putState(auth.supabase, auth.user.id, body.state);
  return Response.json(stored);
}
