"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  markLegacyImported,
  readLegacyState,
  useCap,
} from "@/lib/store";
import { sameLocalDay } from "@/lib/merge";
import type {
  CapState,
  ContextNote,
  DayItem,
  Habit,
  Objective,
  Priority,
} from "@/lib/types";
import AuClair, { type DayRow, type LandedPayload } from "@/components/AuClair";
import Carte from "@/components/Carte";
import { capColor } from "@/components/CapTrack";
import InstallPrompt, { InstallBanner } from "@/components/InstallPrompt";

type View = "clair" | "projets" | "plan" | "today";

// Force un re-render au passage de minuit (et au retour sur l'onglet), pour que
// tout ce qui se calcule à partir de `new Date()` pendant le rendu — la date
// « aujourd'hui » du header, la ligne « maintenant » et les projections de la
// frise dans La carte — ne reste pas figé au jour où l'onglet a été ouvert.
// Le setInterval peut être gelé en arrière-plan/veille, d'où le resync au focus.
function useDayTick(): number {
  const [dayStart, setDayStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });
  useEffect(() => {
    function sync() {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      setDayStart((prev) => (prev === d.getTime() ? prev : d.getTime()));
    }
    const id = setInterval(sync, 60_000);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);
  return dayStart;
}

export default function Home() {
  const { state, ready, hasServerState, replace, save } = useCap();
  const [view, setView] = useState<View>("clair");
  const [toast, setToast] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [weekBusy, setWeekBusy] = useState(false);
  // Plus d'atterrissage : pas d'animation de « pose » d'un tour à l'autre.
  const justLanded = false;

  // Bascule de jour en direct (date du header + frise de La carte).
  useDayTick();
  const today = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  // Nettoyage IA de la carte à la demande : fusionne les doublons sans perte.
  const cleanMap = useCallback(async () => {
    if (cleaning) return;
    setCleaning(true);
    try {
      const res = await fetch("/api/clean", { method: "POST" });
      const j = await res.json();
      if (res.ok) {
        if (j.state) replace(j);
        const n = (j.removed ?? 0) as number;
        const s = (j.shortened ?? 0) as number;
        const parts: string[] = [];
        if (n > 0) parts.push(`${n} doublon${n > 1 ? "s" : ""} fusionné${n > 1 ? "s" : ""}`);
        if (s > 0) parts.push(`${s} titre${s > 1 ? "s" : ""} raccourci${s > 1 ? "s" : ""}`);
        setToast(parts.length ? parts.join(" · ") : "Rien à ranger — c'est déjà propre");
        setTimeout(() => setToast(null), 4000);
      }
    } catch {
      // silencieux : on ne casse rien, l'état reste
    } finally {
      setCleaning(false);
    }
  }, [cleaning, replace]);

  // Vue Semaine : le coach pose le plan macro (quel cap dans quelle demi-journée
  // + où ça atterrit), rangé dans l'état comme le reste.
  const generateWeek = useCallback(async () => {
    if (weekBusy) return;
    setWeekBusy(true);
    try {
      const res = await fetch("/api/week", { method: "POST" });
      const j = await res.json();
      if (res.ok && j.state) replace(j);
    } catch {
      // silencieux : on ne casse rien, l'état reste
    } finally {
      setWeekBusy(false);
    }
  }, [weekBusy, replace]);

  const openClair = useCallback(() => setView("clair"), []);

  const onDeleteCap = useCallback(
    (id: string) => {
      save({ ...state, objectives: state.objectives.filter((o) => o.id !== id) });
    },
    [state, save],
  );

  // Réordonner les caps = changer leur PRIORITÉ (ordre d'affichage). On déplace
  // dans le tableau du state ; l'ordre EST la hiérarchie.
  const onReorderCap = useCallback(
    (id: string, dir: -1 | 1) => {
      const arr = [...state.objectives];
      const i = arr.findIndex((o) => o.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      save({ ...state, objectives: arr });
    },
    [state, save],
  );

  const onDeleteNote = useCallback(
    (id: string) => {
      save({
        ...state,
        contextNotes: (state.contextNotes ?? []).filter((n) => n.id !== id),
      });
    },
    [state, save],
  );

  // Cocher une priorité : le geste-récompense. Le ✓ persiste en DB, la
  // suivante devient le héros, et le coach lira ce qui a RÉELLEMENT été fait.
  const onTogglePriority = useCallback(
    (id: string) => {
      save({
        ...state,
        priorities: state.priorities.map((p) =>
          p.id === id ? { ...p, done: !p.done } : p,
        ),
      });
    },
    [state, save],
  );

  // Cocher un créneau de la journée : une priorité se coche via SA priorité
  // (track record fiable) ; une habitude ou une contrainte se cochent sur
  // le créneau lui-même.
  const onToggleDayItem = useCallback(
    (item: DayItem) => {
      if (item.kind === "priority" && item.refId) {
        onTogglePriority(item.refId);
        return;
      }
      save({
        ...state,
        dayPlan: (state.dayPlan ?? []).map((d) =>
          d.id === item.id ? { ...d, done: !d.done } : d,
        ),
      });
    },
    [state, save, onTogglePriority],
  );

  // Cocher/décocher rétroactivement un créneau d'un jour PASSÉ : un oubli de
  // case ne doit pas figer un jour à jamais. On écrit dans l'historique, sur la
  // même liste que celle affichée (dayPlan si présent, sinon priorities).
  // Édition manuelle : toute modification d'un cap (titres, jalons cochés /
  // réordonnés / ajoutés, états de flux, cible, horizon) passe par ici.
  const onUpdateObjective = useCallback(
    (id: string, up: (o: Objective) => Objective) => {
      save({
        ...state,
        objectives: state.objectives.map((o) => (o.id === id ? up(o) : o)),
      });
    },
    [state, save],
  );

  // Édition manuelle des rituels persistants (bloc « Mes rituels » de La carte).
  const onUpdateHabits = useCallback(
    (up: (prev: Habit[]) => Habit[]) => {
      save({ ...state, habits: up(state.habits ?? []) });
    },
    [state, save],
  );

  // Invocation clavier, façon Raycast / ChatGPT macOS.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setView("clair");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Tout se commit en direct (modèle compagnon) : le serveur a déjà fusionné et
  // écrit — on remplace le miroir local + petit encart de ce qui a changé.
  const onUpdate = useCallback(
    (s: LandedPayload) => {
      replace(s);
      if (s.note?.trim()) {
        setToast(s.note.trim());
        setTimeout(() => setToast(null), 4000);
      }
    },
    [replace],
  );

  const objById = useMemo(() => {
    const map = new Map<string, Objective>();
    for (const o of state.objectives) map.set(o.id, o);
    return map;
  }, [state.objectives]);

  const stale =
    state.priorities.length > 0 &&
    state.prioritiesDate !== undefined &&
    !sameLocalDay(state.prioritiesDate);

  if (!ready) {
    return <main className="min-h-full" />;
  }

  // Numéro stable (ordre posé avec Cap) ; les non-cochées passent devant.
  const numbered = state.priorities.map((p, i) => ({ p, n: i + 1 }));
  const pending = numbered.filter(({ p }) => !p.done);
  const doneItems = numbered.filter(({ p }) => p.done);
  const hero = pending[0];
  const next = pending.slice(1);

  // La journée organisée : quand elle existe, elle DEVIENT « Aujourd'hui » —
  // une liste ordonnée (le coach a placé habitudes et contraintes autour des
  // priorités). Le « maintenant » = le premier créneau non fait, quel que soit
  // son type (un jour dur, ça peut être un rituel d'activation, pas la prio n°1).
  const dayPlan = state.dayPlan ?? [];
  const hasDay = dayPlan.length > 0;
  const dayDoneOf = (d: DayItem) =>
    d.kind === "priority" && d.refId
      ? !!state.priorities.find((p) => p.id === d.refId)?.done
      : !!d.done;
  const dayPending = dayPlan.filter((d) => !dayDoneOf(d));
  const dayDone = dayPlan.filter((d) => dayDoneOf(d));
  const dayHero = dayPending[0];
  const dayRest = dayPending.slice(1);

  // Les victoires du jour, EN DIRECT : un cerveau TDA sous-enregistre ce qu'il
  // fait — on le lui met sous les yeux, en cadrage positif, qui monte à chaque
  // coche. Série = jours passés consécutifs avec ≥1 fait, + aujourd'hui.
  const doneToday = hasDay ? dayDone.length : doneItems.length;
  const histForStreak = state.history ?? [];
  let pastStreak = 0;
  for (let i = histForStreak.length - 1; i >= 0; i--) {
    const its = histForStreak[i].dayPlan?.length
      ? histForStreak[i].dayPlan!
      : histForStreak[i].priorities;
    if (its.some((it) => it.done)) pastStreak++;
    else break;
  }
  const streakToday = pastStreak + (doneToday > 0 ? 1 : 0);
  const anyFranchised = state.objectives.some((o) =>
    (o.steps ?? []).some((s) => s.done),
  );

  // La journée pour le fil « Au clair » (bande secondaire, repliée) : le plan
  // s'il existe, sinon les priorités — état résolu (une prio se coche via elle-même).
  const chatDay: DayRow[] = hasDay
    ? dayPlan.map((d) => ({
        id: d.id,
        title: d.title,
        dueBy: d.dueBy,
        done: dayDoneOf(d),
      }))
    : state.priorities.map((p) => ({ id: p.id, title: p.title, done: !!p.done }));

  return (
    <main className="mx-auto min-h-full max-w-6xl px-6 pb-40 pt-12 sm:px-8 sm:pb-32 sm:pt-24">
      <Header view={view} onView={setView} today={today} />

      <InstallBanner />

      {!hasServerState && <ImportBanner onImport={save} />}

      {view === "today" && (
        <div className="mx-auto max-w-2xl">
          {state.priorities.length === 0 && !hasDay ? (
            <EmptyState
              first={state.objectives.length === 0}
              onOpen={openClair}
            />
          ) : (
            <>
              {/* Chaque élément porte son sens : d'où vient ce qui s'affiche,
                  et est-ce frais. */}
              <p
                className={`mb-5 text-xs uppercase tracking-[0.18em] ${
                  stale ? "text-gold" : "text-faint"
                }`}
              >
                {stale
                  ? "Posé un autre jour — un point pour rafraîchir ?"
                  : hasDay
                    ? "Ta journée, posée avec Cap"
                    : "Posées aujourd'hui avec Cap"}
              </p>

              {/* Les victoires du jour, en direct — le shot de dopamine avant
                  même de regarder ce qu'il reste. */}
              <WinsBanner done={doneToday} streak={streakToday} />

              {/* Les acquis du jour, mis en avant : la récompense d'abord,
                  avant le reste-à-faire. */}
              {hasDay
                ? dayDone.length > 0 && (
                    <DoneStrip
                      items={dayDone.map((d) => ({ id: d.id, title: d.title }))}
                      onToggle={(id) => {
                        const d = dayDone.find((x) => x.id === id);
                        if (d) onToggleDayItem(d);
                      }}
                    />
                  )
                : doneItems.length > 0 && (
                    <DoneStrip
                      items={doneItems.map(({ p }) => ({
                        id: p.id,
                        title: p.title,
                      }))}
                      onToggle={onTogglePriority}
                    />
                  )}

              {hasDay ? (
                <>
                  {dayHero ? (
                    <DayHero
                      item={dayHero}
                      priorities={state.priorities}
                      habits={state.habits}
                      objById={objById}
                      objectives={state.objectives}
                      onToggle={() => onToggleDayItem(dayHero)}
                      justLanded={justLanded}
                    />
                  ) : (
                    <AllDone />
                  )}
                  {dayRest.length > 0 && (
                    <DayTimeline
                      items={dayRest}
                      priorities={state.priorities}
                      habits={state.habits}
                      objById={objById}
                      objectives={state.objectives}
                      onToggle={onToggleDayItem}
                    />
                  )}
                </>
              ) : (
                <>
                  {hero ? (
                    <PriorityHero
                      priority={hero.p}
                      number={hero.n}
                      color={capColor(state.objectives, hero.p.objectiveId)}
                      objective={
                        hero.p.objectiveId
                          ? objById.get(hero.p.objectiveId)
                          : undefined
                      }
                      onToggle={() => onTogglePriority(hero.p.id)}
                      justLanded={justLanded}
                    />
                  ) : (
                    <AllDone />
                  )}
                  {next.length > 0 && (
                    <NextList
                      items={next}
                      objById={objById}
                      objectives={state.objectives}
                      onToggle={onTogglePriority}
                    />
                  )}
                </>
              )}

              <div className="mt-12 text-center sm:hidden">
                <button
                  onClick={openClair}
                  className="rounded-full border border-line bg-surface px-5 py-2 text-sm text-muted"
                >
                  Faire le point
                </button>
              </div>
            </>
          )}

          {state.lastNote && state.priorities.length > 0 && (
            <div className="mt-14 border-t border-line/70 pt-5">
              <p
                className={`text-sm italic leading-relaxed text-faint ${
                  justLanded ? "animate-rise" : ""
                }`}
              >
                <span className="not-italic">Cap, en fin de session :</span>{" "}
                «&nbsp;{state.lastNote}&nbsp;»
              </p>
            </div>
          )}
        </div>
      )}

      {view === "projets" && (
        <>
          <Carte
            objectives={state.objectives}
            habits={state.habits}
            onOpen={openClair}
            onDeleteCap={onDeleteCap}
            onReorderCap={onReorderCap}
            onUpdateObjective={onUpdateObjective}
            onUpdateHabits={onUpdateHabits}
            onClean={cleanMap}
            cleaning={cleaning}
            mode="chemins"
            onSeeWeeks={() => setView("plan")}
          />
          {(state.contextNotes?.length || state.understanding?.trim()) && (
            <div className="mx-auto mt-6 max-w-2xl space-y-3">
              {state.understanding?.trim() && (
                <UnderstandingSection
                  text={state.understanding.trim()}
                  onSave={(t) => save({ ...state, understanding: t })}
                />
              )}
              {state.contextNotes && state.contextNotes.length > 0 && (
                <ContextSection
                  notes={state.contextNotes}
                  onDelete={onDeleteNote}
                />
              )}
            </div>
          )}
        </>
      )}

      {view === "plan" && (
        <Carte
          objectives={state.objectives}
          habits={state.habits}
          onOpen={openClair}
          onDeleteCap={onDeleteCap}
          onReorderCap={onReorderCap}
          onUpdateObjective={onUpdateObjective}
          onUpdateHabits={onUpdateHabits}
          weekPlan={state.weekPlan}
          onGenerateWeek={generateWeek}
          generatingWeek={weekBusy}
          mode="planning"
        />
      )}

      {/* Monté en permanence pour ne PAS perdre la conversation en changeant
          d'onglet ; caché quand l'onglet n'est pas actif. */}
      <div className="mx-auto max-w-2xl">
        <AuClair
          active={view === "clair"}
          onClose={() => setView("today")}
          onUpdate={onUpdate}
          day={chatDay}
        />
      </div>

      <BottomNav view={view} onView={setView} />

      {toast && (
        <div className="animate-rise fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink shadow-md sm:bottom-6">
          <span className="mr-1.5 text-cap-ink">✓</span>
          {toast}
        </div>
      )}
    </main>
  );
}

// ── Aujourd'hui ───────────────────────────────────────────────────────────
// LA priorité du jour en héros : au moment « je re-doute », l'œil tombe
// dessus en une seconde. Pas de boîte — l'espace et l'échelle font le poids.

// Le compteur de victoires du jour, EN DIRECT. Cadrage strictement positif :
// à 0, on invite (jamais « 0 fait ») ; à ≥1, le chiffre monte et la série
// s'affiche. Contre le « j'ai rien foutu » du soir.
function WinsBanner({ done, streak }: { done: number; streak: number }) {
  return (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface/60 px-4 py-3 shadow-sm">
      {done > 0 ? (
        <p className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-semibold leading-none text-cap">
            🌟 {done}
          </span>
          <span className="text-sm text-muted">
            victoire{done > 1 ? "s" : ""} aujourd&apos;hui
          </span>
        </p>
      ) : (
        <p className="text-sm text-muted">
          Ta journée commence — la première victoire est à portée.
        </p>
      )}
      {streak >= 2 && (
        <span
          className="flex shrink-0 items-center gap-1 rounded-full bg-gold-soft px-3 py-1.5 text-sm font-semibold text-gold"
          title="jours d'affilée avec au moins une victoire"
        >
          🔥 {streak} j
        </span>
      )}
    </div>
  );
}

// Le rond à cocher : le geste-récompense, assez gros pour le pouce.
function CheckCircle({
  done,
  color,
  onToggle,
  size = "md",
}: {
  done?: boolean;
  color: string;
  onToggle: () => void;
  size?: "md" | "lg";
}) {
  const px = size === "lg" ? "h-9 w-9 text-lg" : "h-7 w-7 text-sm";
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={done ? "finalement pas faite" : "c'est fait !"}
      className={`flex shrink-0 items-center justify-center rounded-full border-2 transition-all ${px} ${
        done ? "text-canvas" : "bg-surface text-transparent hover:scale-105"
      }`}
      style={{
        borderColor: color,
        background: done ? color : undefined,
      }}
    >
      ✓
    </button>
  );
}

function NumberBadge({
  n,
  color,
  size = "md",
}: {
  n: number;
  color: string;
  size?: "md" | "lg";
}) {
  const px = size === "lg" ? "h-8 w-8 text-base" : "h-6 w-6 text-xs";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-display font-semibold text-canvas ${px}`}
      style={{ background: color }}
    >
      {n}
    </span>
  );
}

function PriorityHero({
  priority,
  number,
  color,
  objective,
  onToggle,
  justLanded,
}: {
  priority: Priority;
  number: number;
  color: string;
  objective?: Objective;
  onToggle: () => void;
  justLanded: boolean;
}) {
  return (
    <section
      className={`relative overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-sm ${
        justLanded ? "animate-rise" : "animate-fade"
      }`}
      style={{ borderLeft: `5px solid ${color}` }}
    >
      {/* L'icône du cap, en grand filigrane : l'identité visuelle du cap. */}
      {objective?.icon && (
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-4 -right-2 select-none text-[6.5rem] opacity-[0.09]"
        >
          {objective.icon}
        </span>
      )}

      <div className="flex items-start gap-4">
        <NumberBadge n={number} color={color} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-medium leading-tight tracking-tight text-ink sm:text-3xl">
            {priority.title}
          </h2>
          {priority.why && (
            <p className="mt-2.5 max-w-lg text-[1.02rem] leading-relaxed text-muted">
              — {priority.why}
            </p>
          )}
          {objective && (
            <p className="mt-4 text-sm text-faint">
              fait avancer&nbsp;:{" "}
              <span className="font-medium" style={{ color }}>
                {objective.icon && `${objective.icon} `}
                {objective.title}
              </span>
              {priority.via && <span> · flux «&nbsp;{priority.via}&nbsp;»</span>}
            </p>
          )}
        </div>
        <CheckCircle done={false} color={color} onToggle={onToggle} size="lg" />
      </div>
    </section>
  );
}

function NextList({
  items,
  objById,
  objectives,
  onToggle,
}: {
  items: { p: Priority; n: number }[];
  objById: Map<string, Objective>;
  objectives: Objective[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="mt-10">
      <p className="text-xs uppercase tracking-[0.18em] text-faint">Ensuite</p>
      <ol className="mt-3 flex flex-col gap-2">
        {items.map(({ p, n }) => {
          const obj = p.objectiveId ? objById.get(p.objectiveId) : undefined;
          const color = capColor(objectives, p.objectiveId);
          return (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-xl border border-line/70 bg-surface/60 px-4 py-3"
            >
              <NumberBadge n={n} color={color} />
              <p className="min-w-0 flex-1 leading-snug">
                <span className="text-ink">{p.title}</span>
                {obj?.icon && (
                  <span className="ml-1.5" title={obj.title}>
                    {obj.icon}
                  </span>
                )}
              </p>
              <CheckCircle done={false} color={color} onToggle={() => onToggle(p.id)} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Les acquis du jour, CÉLÉBRÉS (pas un cimetière barré en bas de page) : une
// bande positive tout en haut, la récompense d'abord. Toucher un item le
// dé-coche (au cas où).
function DoneStrip({
  items,
  onToggle,
}: {
  items: { id: string; title: string }[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="animate-rise mb-6 rounded-2xl border border-cap/25 bg-cap-soft/50 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-cap-ink">
        Déjà dans la poche · {items.length}
      </p>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2">
        {items.map((it) => (
          <li key={it.id}>
            <button
              onClick={() => onToggle(it.id)}
              title="finalement pas fait"
              className="flex items-center gap-2 text-left text-[0.95rem] text-ink"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cap text-xs text-canvas">
                ✓
              </span>
              {it.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Tout est coché : le moment de récompense — court, chaleureux, refermable.
function AllDone() {
  return (
    <section className="animate-rise rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
      <p className="text-3xl">★</p>
      <p className="mt-3 font-display text-2xl font-medium text-ink">
        Tout est fait.
      </p>
      <p className="mx-auto mt-2 max-w-sm text-muted">
        Journée pleine — chaque case cochée a fait avancer un cap. Tu peux
        fermer Cap.
      </p>
    </section>
  );
}

// ── Ta journée ────────────────────────────────────────────────────────────
// Quand le coach a organisé la journée, « Aujourd'hui » devient une liste
// ORDONNÉE : priorités, habitudes et contraintes placées dans le bon ordre.
// Ce qui fait avancer un cap porte SA couleur ; rituels et contraintes restent
// en teinte neutre (la couleur = « ça compte pour un cap »).

const NEUTRAL = "var(--color-muted)";

function resolveDay(
  item: DayItem,
  priorities: Priority[],
  habits: Habit[] | undefined,
  objById: Map<string, Objective>,
  objectives: Objective[],
) {
  const prio =
    item.kind === "priority" && item.refId
      ? priorities.find((p) => p.id === item.refId)
      : undefined;
  const habit =
    item.kind === "habit" && item.refId
      ? habits?.find((h) => h.id === item.refId)
      : undefined;
  const objective = prio?.objectiveId ? objById.get(prio.objectiveId) : undefined;
  const color = prio ? capColor(objectives, prio.objectiveId) : NEUTRAL;
  const icon = objective?.icon ?? habit?.icon;
  return { prio, objective, icon, color, isCap: !!prio };
}

// Le moment de journée d'un créneau, déduit de son ancre `dueBy` (texte libre
// posé par le coach : « avant midi », « 14h », « ce soir »…). Sert à découper la
// journée en îlots — on n'affronte que le bloc en cours, pas la montagne.
type Moment = "matin" | "midi" | "aprem" | "soir" | "flottant";

const MOMENTS: { key: Moment; label: string }[] = [
  { key: "matin", label: "Matin" },
  { key: "midi", label: "Midi · déjeuner" },
  { key: "aprem", label: "Après-midi" },
  { key: "soir", label: "Soir" },
  { key: "flottant", label: "À caser quand tu peux" },
];

function momentOf(dueBy?: string): Moment {
  if (!dueBy) return "flottant";
  const s = dueBy.toLowerCase();
  // Mots-clés d'abord — « avant midi » doit tomber en matin, donc testé avant midi.
  if (/matin|matinée|avant midi/.test(s)) return "matin";
  if (/déjeuner|midi/.test(s)) return "midi";
  if (/après-?midi|aprem/.test(s)) return "aprem";
  if (/soir|soirée|avant de dormir|nuit/.test(s)) return "soir";
  // Heure explicite : « 14h », « 9h30 », « avant 16h », « vers 19h ».
  const m = s.match(/\b(\d{1,2})\s*h/);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h < 12) return "matin";
    if (h < 14) return "midi";
    if (h < 18) return "aprem";
    return "soir";
  }
  return "flottant";
}

// La deadline du jour : une ancre douce (« avant midi »), pas un compte à rebours.
function DueChip({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium"
      style={{
        borderColor: color ?? "var(--color-line)",
        color: color ?? "var(--color-muted)",
      }}
    >
      {label}
    </span>
  );
}

function DayHero({
  item,
  priorities,
  habits,
  objById,
  objectives,
  onToggle,
  justLanded,
}: {
  item: DayItem;
  priorities: Priority[];
  habits: Habit[] | undefined;
  objById: Map<string, Objective>;
  objectives: Objective[];
  onToggle: () => void;
  justLanded: boolean;
}) {
  const { objective, icon, color, isCap } = resolveDay(
    item,
    priorities,
    habits,
    objById,
    objectives,
  );
  return (
    <section
      className={`relative overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-sm ${
        justLanded ? "animate-rise" : "animate-fade"
      }`}
      style={{ borderLeft: `5px solid ${color}` }}
    >
      {icon && (
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-4 -right-2 select-none text-[6.5rem] opacity-[0.09]"
        >
          {icon}
        </span>
      )}

      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs uppercase tracking-[0.15em] text-faint">
              Maintenant
            </span>
            {item.dueBy && <DueChip label={item.dueBy} />}
          </div>
          <h2 className="font-display text-2xl font-medium leading-tight tracking-tight text-ink sm:text-3xl">
            {item.title}
          </h2>
          {item.why && (
            <p className="mt-2.5 max-w-lg text-[1.02rem] leading-relaxed text-muted">
              — {item.why}
            </p>
          )}
          {isCap && objective ? (
            <p className="mt-4 text-sm text-faint">
              fait avancer&nbsp;:{" "}
              <span className="font-medium" style={{ color }}>
                {objective.icon && `${objective.icon} `}
                {objective.title}
              </span>
            </p>
          ) : (
            <p className="mt-4 text-sm text-faint">
              {item.kind === "habit" ? "ton rituel du jour" : "un rendez-vous à tenir"}
            </p>
          )}
        </div>
        <CheckCircle done={false} color={color} onToggle={onToggle} size="lg" />
      </div>
    </section>
  );
}

function DayTimeline({
  items,
  priorities,
  habits,
  objById,
  objectives,
  onToggle,
}: {
  items: DayItem[];
  priorities: Priority[];
  habits: Habit[] | undefined;
  objById: Map<string, Objective>;
  objectives: Objective[];
  onToggle: (item: DayItem) => void;
}) {
  // On regroupe la suite de la journée par MOMENT (matin · déjeuner · aprem ·
  // soir), pour chunker le mur en îlots time-ancrés. L'ordre du coach est
  // conservé À L'INTÉRIEUR d'un moment.
  const byMoment = new Map<Moment, DayItem[]>();
  for (const d of items) {
    const key = momentOf(d.dueBy);
    (byMoment.get(key) ?? byMoment.set(key, []).get(key)!).push(d);
  }
  const groups = MOMENTS.filter((m) => byMoment.get(m.key)?.length);

  return (
    <div className="mt-10 flex flex-col gap-6">
      {groups.map((m) => (
        <div key={m.key}>
          {/* Séparateur de moment : discret, il fait office de coupure (le
              « Midi · déjeuner » scinde naturellement matin et après-midi). */}
          <p className="border-t border-line/60 pt-3 text-xs uppercase tracking-[0.18em] text-faint">
            {m.label}
          </p>
          <ol className="mt-3 flex flex-col gap-2">
            {byMoment.get(m.key)!.map((d) => {
              const { icon, color, isCap } = resolveDay(
                d,
                priorities,
                habits,
                objById,
                objectives,
              );
              return isCap ? (
                // Projet : proéminent — c'est ce qui fait avancer un cap.
                <li
                  key={d.id}
                  className="flex items-start gap-3 rounded-xl border border-line/70 bg-surface/60 px-4 py-3"
                >
                  <span
                    className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 leading-snug text-ink">
                        {icon && <span className="mr-1">{icon}</span>}
                        {d.title}
                      </p>
                      {d.dueBy && <DueChip label={d.dueBy} color={color} />}
                    </div>
                    {d.why && (
                      <p className="mt-1 text-sm leading-snug text-faint">{d.why}</p>
                    )}
                  </div>
                  <CheckCircle done={false} color={color} onToggle={() => onToggle(d)} />
                </li>
              ) : (
                // Rituel / random : TRÈS discret — inline léger, sans carte, il
                // s'efface en fond pour que les projets dominent l'œil.
                <li key={d.id} className="flex items-center gap-2.5 px-1.5 py-1">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
                  <p className="min-w-0 flex-1 truncate text-sm text-muted">
                    {icon && <span className="mr-1 opacity-70">{icon}</span>}
                    {d.title}
                    {d.dueBy && (
                      <span className="ml-2 text-xs text-faint">· {d.dueBy}</span>
                    )}
                  </p>
                  <CheckCircle done={false} color={NEUTRAL} onToggle={() => onToggle(d)} />
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

// Migration depuis l'ère localStorage : proposé une seule fois, quand le
// serveur n'a encore rien et qu'un ancien état local existe.
function ImportBanner({ onImport }: { onImport: (s: CapState) => void }) {
  const [legacy, setLegacy] = useState<CapState | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setLegacy(readLegacyState());
  }, []);

  if (!legacy || done) return null;

  return (
    <div className="animate-rise mx-auto mb-8 max-w-2xl rounded-2xl border border-cap/30 bg-cap-soft/60 p-5">
      <p className="text-[0.95rem] leading-relaxed text-cap-ink">
        J&apos;ai retrouvé tes données d&apos;avant (caps, compréhension,
        priorités) dans ce navigateur. On les importe dans ton compte&nbsp;?
      </p>
      <button
        onClick={() => {
          onImport(legacy);
          markLegacyImported();
          setDone(true);
        }}
        className="mt-3 rounded-full bg-ink px-5 py-2 text-sm font-medium text-canvas"
      >
        Importer mes données
      </button>
    </div>
  );
}

function Header({
  view,
  onView,
  today,
}: {
  view: View;
  onView: (v: View) => void;
  today: string;
}) {
  const title =
    view === "today"
      ? "Aujourd'hui"
      : view === "projets"
        ? "Projets"
        : view === "plan"
          ? "Plan"
          : "Au clair";
  return (
    <header className="mb-8 sm:mb-10">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm uppercase tracking-[0.18em] text-faint">{today}</p>
        <InstallPrompt />
      </div>
      <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
        {title}
      </h1>

      {/* Onglets : desktop seulement — sur mobile, la barre du bas prend le relais. */}
      <div className="mt-6 hidden gap-1 rounded-full border border-line bg-surface p-1 text-sm shadow-sm sm:inline-flex">
        <Tab active={view === "clair"} onClick={() => onView("clair")}>
          <span className="flex items-center gap-1.5">
            Au clair
            <kbd className="rounded bg-sink px-1 py-0.5 text-[0.65rem] text-faint">
              ⌘K
            </kbd>
          </span>
        </Tab>
        <Tab active={view === "projets"} onClick={() => onView("projets")}>
          Projets
        </Tab>
        <Tab active={view === "plan"} onClick={() => onView("plan")}>
          Plan
        </Tab>
        <Tab active={view === "today"} onClick={() => onView("today")}>
          Aujourd&apos;hui
        </Tab>
      </div>
    </header>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 transition-colors ${
        active ? "bg-ink text-canvas" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

// Navigation mobile : les vues au pouce, comme une app installée.
function BottomNav({
  view,
  onView,
}: {
  view: View;
  onView: (v: View) => void;
}) {
  const items: { v: View; label: string }[] = [
    { v: "clair", label: "Au clair" },
    { v: "projets", label: "Projets" },
    { v: "plan", label: "Plan" },
    { v: "today", label: "Aujourd'hui" },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      <div className="mx-auto flex max-w-md">
        {items.map(({ v, label }) => {
          const active = view === v;
          return (
            <button
              key={v}
              onClick={() => onView(v)}
              className="relative flex-1 py-3.5 text-[0.8rem] transition-colors"
            >
              {active && (
                <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-cap" />
              )}
              <span
                className={
                  active ? "font-medium text-cap-ink" : "text-muted"
                }
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function ContextSection({
  notes,
  onDelete,
}: {
  notes: ContextNote[];
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="animate-rise overflow-hidden rounded-2xl border border-line bg-surface/60 shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-canvas/30"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-lg">
          📌
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs uppercase tracking-[0.15em] text-faint">
            Contexte en mémoire
          </span>
          <span className="mt-0.5 block text-sm text-muted">
            {notes.length} note{notes.length > 1 ? "s" : ""}
          </span>
        </span>
        <span className="shrink-0 text-xs text-faint">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="space-y-1.5 border-t border-line/60 p-4">
          {notes.map((n) => (
            <li
              key={n.id}
              className="group/note flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-canvas/40"
            >
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
              <span className="flex-1 text-muted">{n.text}</span>
              <button
                onClick={() => onDelete(n.id)}
                className="shrink-0 text-faint transition-colors hover:text-red-400 sm:opacity-0 sm:group-hover/note:opacity-100"
                title="Supprimer"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Ce que Cap a retenu de toi (goûts, leviers, ce qui te booste / à éviter,
// rythmes) : miroir de `understanding`, ÉDITABLE — tu corriges ou effaces ce qui
// est faux ou gênant, et le coach s'en tiendra à ta version.
function UnderstandingSection({
  text,
  onSave,
}: {
  text: string;
  onSave: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  return (
    <section className="animate-rise overflow-hidden rounded-2xl border border-line bg-surface/60 shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-canvas/30"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cap-soft text-lg">
          🧠
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs uppercase tracking-[0.15em] text-faint">
            Ce que Cap sait de toi
          </span>
          {!open && (
            <span className="mt-0.5 block truncate text-sm text-muted">{text}</span>
          )}
        </span>
        <span className="shrink-0 text-xs text-faint">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-line/60 p-4">
          {editing ? (
            <>
              <textarea
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                rows={7}
                className="w-full resize-y rounded-xl border border-line bg-canvas/40 p-3 text-sm leading-relaxed text-ink focus:outline-none focus:ring-1 focus:ring-cap/40"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => {
                    onSave(draft.trim());
                    setEditing(false);
                  }}
                  className="rounded-full bg-ink px-4 py-1.5 text-xs font-medium text-canvas"
                >
                  Enregistrer
                </button>
                <button
                  onClick={() => {
                    setDraft(text);
                    setEditing(false);
                  }}
                  className="rounded-full px-3 py-1.5 text-xs text-faint hover:text-ink"
                >
                  Annuler
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
                {text}
              </p>
              <button
                onClick={() => {
                  setDraft(text);
                  setEditing(true);
                }}
                className="mt-2.5 text-xs text-faint underline decoration-dotted transition-colors hover:text-cap-ink"
              >
                Modifier ce que Cap retient
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function EmptyState({ first, onOpen }: { first: boolean; onOpen: () => void }) {
  return (
    <div className="animate-rise rounded-2xl border border-dashed border-line bg-surface/50 px-6 py-14 text-center">
      <p className="mx-auto max-w-md font-display text-xl italic leading-relaxed text-muted">
        {first
          ? "On ne s'est pas encore parlé. Dis-moi ce sur quoi tu bosses en ce moment, et je t'aide à voir où tu vas."
          : "Pas de priorités posées pour aujourd'hui. Un point rapide pour lever le doute ?"}
      </p>
      <button
        onClick={onOpen}
        className="mt-7 rounded-full bg-ink px-6 py-3 text-sm font-medium text-canvas transition-transform hover:scale-[1.02]"
      >
        {first ? "Commencer" : "Faire le point"}
      </button>
    </div>
  );
}
