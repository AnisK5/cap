"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const urlError = params.get("error");

  const send = async () => {
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email: value,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  // Connexion Google (OAuth). Nécessite que le provider Google soit activé dans
  // Supabase ; le retour passe par le même /auth/callback (échange du code).
  const google = async () => {
    setError(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 pb-24">
      <h1 className="font-display text-5xl font-semibold tracking-tight text-ink">
        Cap
      </h1>
      <p className="mt-3 font-display text-lg italic leading-snug text-muted">
        Vois où tu vas.
      </p>

      {sent ? (
        <p className="animate-rise mt-10 rounded-2xl border border-line bg-surface p-5 text-[0.95rem] leading-relaxed text-muted">
          C&apos;est envoyé — regarde ta boîte mail et ouvre le lien pour
          entrer. Tu peux fermer cet onglet.
        </p>
      ) : (
        <div className="mt-10">
          <button
            onClick={google}
            className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-sink"
          >
            <GoogleIcon />
            Continuer avec Google
          </button>

          <div className="my-5 flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-line" />
            ou par email
            <span className="h-px flex-1 bg-line" />
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-2.5 shadow-sm">
            <input
              type="email"
              value={email}
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="ton@email.com"
              className="flex-1 bg-transparent px-3 py-2 text-ink placeholder:text-faint focus:outline-none"
            />
            <button
              onClick={send}
              disabled={busy || !email.trim()}
              className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-canvas transition-opacity disabled:opacity-25"
            >
              {busy ? "…" : "Entrer"}
            </button>
          </div>
          <p className="mt-3 text-sm text-faint">
            Pas de mot de passe : tu reçois un lien par email.
          </p>
          {(error || urlError) && (
            <p className="mt-4 rounded-lg bg-gold-soft px-4 py-3 text-sm text-gold">
              {error ??
                (urlError === "forbidden"
                  ? "Ce compte n'a pas accès à Cap."
                  : "Le lien n'a pas fonctionné — réessaie.")}
            </p>
          )}
        </div>
      )}
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
