"use client";

import { useCallback, useEffect, useState } from "react";
import { EMPTY_STATE, type CapState } from "./types";

// L'état vit en DB, servi par /api/state ; le client n'en garde qu'un miroir.
// Deux façons de le faire évoluer :
//  - replace() : une réponse serveur (réconciliation) fait foi, on remplace ;
//  - save()    : édition manuelle (suppression, renommage inline, import) —
//                optimiste puis PUT.

export interface StoredState {
  state: CapState;
  updatedAt: string | null;
}

export function useCap() {
  // undefined = chargement ; null = pas encore d'état côté serveur.
  const [stored, setStored] = useState<StoredState | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetch("/api/state")
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          window.location.href = "/login";
          return;
        }
        const j = (await res.json()) as StoredState & { error?: string };
        if (alive) setStored(j.state ? j : null);
      })
      .catch(() => {
        if (alive) setStored(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const replace = useCallback((s: StoredState) => {
    if (s?.state) setStored(s);
  }, []);

  const save = useCallback(async (next: CapState) => {
    setStored({ state: next, updatedAt: new Date().toISOString() });
    try {
      const res = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next }),
      });
      if (res.ok) setStored((await res.json()) as StoredState);
    } catch {
      // Optimiste conservé ; la prochaine lecture resynchronisera.
    }
  }, []);

  return {
    state: stored?.state ?? EMPTY_STATE,
    ready: stored !== undefined,
    hasServerState: !!stored,
    replace,
    save,
  };
}

// --- Migration : l'ancien état localStorage (avant la refonte serveur) ---

const LEGACY_KEY = "cap.state.v1";

export function readLegacyState(): CapState | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as CapState;
    return Array.isArray(s?.objectives) ? s : null;
  } catch {
    return null;
  }
}

// Après import réussi : on garde une copie de secours, on cesse de proposer.
export function markLegacyImported() {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (raw) {
      window.localStorage.setItem(`${LEGACY_KEY}.backup`, raw);
      window.localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    // tant pis, le banner réapparaîtra
  }
}
