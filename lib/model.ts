// Choix des modèles — UNIQUE endroit où un modèle est nommé.
// Essai en cours : conversation sur Sonnet 4.6 (qualité à juger sur une
// semaine de vraies sessions contre docs/comportement.md). Pour revenir à
// Opus : CHAT_MODEL=claude-opus-4-8 dans .env.local, puis redémarrer le dev
// server. Prêt pour un tiering futur (essai/premium) sans toucher au code.
export const CHAT_MODEL = process.env.CHAT_MODEL ?? "claude-sonnet-4-6";
export const RECONCILE_MODEL =
  process.env.RECONCILE_MODEL ?? "claude-sonnet-4-6";
