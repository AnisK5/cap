// Choix des modèles — UNIQUE endroit où un modèle est nommé.
// Décision (2026-07-21) : la CONVERSATION repasse sur Opus 4.8 — l'essai Sonnet
// a montré ses limites sur le suivi d'état (temps qui passe, ce qui est fait)
// et le balayage stratégique, pile les comportements où Opus tient mieux.
// La RÉCONCILIATION reste sur Sonnet : extraction structurée, et elle tourne à
// CHAQUE message (le live) → garder le coût bas. Override possible par env
// (CHAT_MODEL / RECONCILE_MODEL) pour un tiering futur, sans toucher au code.
export const CHAT_MODEL = process.env.CHAT_MODEL ?? "claude-opus-4-8";
export const RECONCILE_MODEL =
  process.env.RECONCILE_MODEL ?? "claude-sonnet-4-6";
