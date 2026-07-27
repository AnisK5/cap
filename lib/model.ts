// Choix des modèles — UNIQUE endroit où un modèle est nommé.
// Décision (2026-07-27) : la CONVERSATION passe sur Opus 5 (claude-opus-5, sorti
// le 2026-07-24) — quasi toute l'intelligence de Fable 5 à moitié prix, et même
// tarif qu'Opus 4.8 ($5/$25). Suivi d'état + balayage stratégique, pile là où
// Opus tient mieux. (Vérifié via l'API Models : HTTP 200, thinking adaptatif.)
// Pas d'alias flottant côté API → on épingle l'ID concret et on le bumpe à la main.
// La RÉCONCILIATION reste sur Sonnet 4.6 : extraction structurée, et elle tourne à
// CHAQUE message (le live) → garder le coût bas. Override possible par env
// (CHAT_MODEL / RECONCILE_MODEL) pour un tiering futur, sans toucher au code.
export const CHAT_MODEL = process.env.CHAT_MODEL ?? "claude-opus-5";
export const RECONCILE_MODEL =
  process.env.RECONCILE_MODEL ?? "claude-sonnet-4-6";
