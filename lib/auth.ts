import type { SupabaseClient, User } from "@supabase/supabase-js";
import { supabaseServer } from "./supabase/server";

// L'app déployée consomme la clé API Anthropic du propriétaire : seuls les
// emails de l'allowlist peuvent l'utiliser, même avec un compte valide.
function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string | undefined): boolean {
  const list = allowedEmails();
  if (list.length === 0) return true; // pas d'allowlist configurée = ouvert (dev)
  return !!email && list.includes(email.toLowerCase());
}

type AuthResult =
  | { user: User; supabase: SupabaseClient; error?: undefined }
  | { user?: undefined; supabase?: undefined; error: Response };

export async function requireUser(): Promise<AuthResult> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: Response.json({ error: "Non connecté." }, { status: 401 }) };
  }
  if (!isAllowed(user.email ?? undefined)) {
    return {
      error: Response.json({ error: "Compte non autorisé." }, { status: 403 }),
    };
  }
  return { user, supabase };
}
