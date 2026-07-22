# Cap

Un espace de réflexion qui **élimine le doute** sur comment investir ton temps. Pas une todo-list — une conversation avec un assistant qui connaît tes projets, voit où tu en es, et te pose 1 à 3 priorités concrètes pour la journée.

Pensé pour les cerveaux TDAH : le manque n'est pas la motivation, c'est la **projection**. Cap construit et maintient ta carte à ta place.

## Ce que c'est

- **Au clair** — tu parles à un assistant (Claude Opus). Il connaît tes caps, remarque les incohérences, propose. Tu ne réponds qu'à une question à la fois.
- **La carte** — une frise Gantt par cap (projet multi-semaines). Jalons en fil de progression, activités continues en barres, éditable à la main.
- **Aujourd'hui** — 1 à 3 priorités du jour, chacune rattachée à un cap. Le coach pose ça à l'atterrissage (« C'est assez clair »).

La réconciliation (restructuration de la carte) tourne en live après chaque réponse du coach — pas besoin de cliquer pour que ça s'applique.

## Lancer en local

1. Copie la config et ajoute tes clés :
   ```bash
   cp .env.local.example .env.local
   # ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
   ```
2. Démarre :
   ```bash
   npm run dev   # port 3002
   ```
3. Ouvre http://localhost:3002

## Stack

- Next.js 16 (App Router) + React 19 + Tailwind v4
- Claude Opus 4.8 (coach en streaming) + Claude Sonnet 4.6 (réconciliation structurée)
- Supabase : auth magic link + allowlist, état persisté côté serveur avec verrou optimiste
- PWA (manifest + icônes)

## Modèle de données

- **Cap** = projet multi-semaines avec jalons (steps) et activités continues (flows)
- **Jalons** = états franchis une fois, affichés en fil de progression (« ici · »)
- **Flux** = activités continues planifiées sur la frise (Gantt)
- **Notes contexte** = mémos ponctuels (tâches isolées, infos en attente) — visibles via toggle sur Aujourd'hui, jamais sur la carte
