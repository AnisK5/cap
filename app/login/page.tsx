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

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
