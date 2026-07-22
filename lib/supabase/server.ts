import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// Client Supabase côté serveur, lié aux cookies de la requête : les routes
// API agissent au nom de l'utilisateur connecté, la RLS s'applique.
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Appelé depuis un Server Component : le middleware rafraîchit déjà.
          }
        },
      },
    },
  );
}
