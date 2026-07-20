import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { isAllowed } from "@/lib/auth";

// Retour du lien magique : échange le code contre une session (cookies),
// refuse les comptes hors allowlist, puis renvoie à l'accueil.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (code) {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (!isAllowed(data.user?.email ?? undefined)) {
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL("/login?error=forbidden", url.origin));
      }
      return NextResponse.redirect(new URL("/", url.origin));
    }
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
