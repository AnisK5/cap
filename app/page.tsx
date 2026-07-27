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
  DayLog,
  Habit,
  Objective,
  Priority,
} from "@/lib/types";
import AuClair, { type DayRow, type LandedPayload } from "@/components/AuClair";
import Carte from "@/components/Carte";
import { capColor } from "@/components/CapTrack";
import InstallPrompt, { InstallBanner } from "@/components/InstallPrompt";

type View = "clair" | "today" | "carte";

export default function Home() {
  const { state, ready, hasServerState, replace, save } = useCap();
  const [view, setView] = useState<View>("clair");
  const [toast, setToast] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  // Plus d'atterrissage : pas d'animation de « pose » d'un tour à l'autre.
  const justLanded = false;

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

  const openClair = useCallback(() => setView("clair"), []);

  const onDeleteCap = useCallback(
    (id: string) => {
      save({ ...state, objectives: state.objectives.filter((o) => o.id !== id) });
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
      <Header view={view} onView={setView} />

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

      {view === "carte" && (
        <>
          <Carte
            objectives={state.objectives}
            habits={state.habits}
            onOpen={openClair}
            onDeleteCap={onDeleteCap}
            onUpdateObjective={onUpdateObjective}
            onUpdateHabits={onUpdateHabits}
            onClean={cleanMap}
            cleaning={cleaning}
          />
          {(state.contextNotes?.length ||
            state.history?.length ||
            state.understanding?.trim()) && (
            <div className="mx-auto mt-4 max-w-2xl border-t border-line/70 pt-2">
              {state.contextNotes && state.contextNotes.length > 0 && (
                <ContextSection
                  notes={state.contextNotes}
                  onDelete={onDeleteNote}
                />
              )}
              {state.understanding?.trim() && (
                <UnderstandingSection
                  text={state.understanding.trim()}
                  onSave={(t) => save({ ...state, understanding: t })}
                />
              )}
              {state.history && state.history.length > 0 && (
                <HistorySection history={state.history} />
              )}
            </div>
          )}
        </>
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
  return (
    <div className="mt-10">
      <p className="text-xs uppercase tracking-[0.18em] text-faint">
        La suite de ta journée
      </p>
      <ol className="mt-3 flex flex-col gap-2">
        {items.map((d) => {
          const { icon, color } = resolveDay(
            d,
            priorities,
            habits,
            objById,
            objectives,
          );
          return (
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
                  {d.dueBy && <DueChip label={d.dueBy} />}
                </div>
                {d.why && (
                  <p className="mt-1 text-sm leading-snug text-faint">{d.why}</p>
                )}
              </div>
              <CheckCircle
                done={false}
                color={color}
                onToggle={() => onToggle(d)}
              />
            </li>
          );
        })}
      </ol>
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
}: {
  view: View;
  onView: (v: View) => void;
}) {
  const today = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  const title =
    view === "today" ? "Aujourd'hui" : view === "carte" ? "La carte" : "Au clair";
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
        <Tab active={view === "carte"} onClick={() => onView("carte")}>
          La carte
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

// Navigation mobile : les 3 vues au pouce, comme une app installée.
function BottomNav({
  view,
  onView,
}: {
  view: View;
  onView: (v: View) => void;
}) {
  const items: { v: View; label: string }[] = [
    { v: "clair", label: "Au clair" },
    { v: "today", label: "Aujourd'hui" },
    { v: "carte", label: "La carte" },
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
    <div className="mt-12">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-faint transition-colors hover:text-muted"
      >
        <span className="text-[0.7rem]">{open ? "▾" : "▸"}</span>
        Contexte en mémoire ({notes.length})
      </button>
      {open && (
        <ul className="mt-3 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 text-faint">·</span>
              <span className="flex-1 text-muted">{n.text}</span>
              <button
                onClick={() => onDelete(n.id)}
                className="shrink-0 text-faint transition-colors hover:text-red-400"
                title="Supprimer"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Historique léger : les jours passés (prévu vs fait), archivés au rollover.
// Replié par défaut — c'est un rappel, pas le centre de l'écran.
function HistorySection({ history }: { history: DayLog[] }) {
  const [open, setOpen] = useState(false);
  const fmt = (day: string) => {
    const d = new Date(`${day}T00:00:00`);
    return Number.isNaN(d.getTime())
      ? day
      : new Intl.DateTimeFormat("fr-FR", {
          weekday: "short",
          day: "numeric",
          month: "short",
        }).format(d);
  };
  return (
    <div className="mt-8">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-faint transition-colors hover:text-muted"
      >
        <span className="text-[0.7rem]">{open ? "▾" : "▸"}</span>
        Jours passés ({history.length})
      </button>
      {open && (
        <ul className="mt-3 space-y-4">
          {[...history].reverse().map((log) => {
            const items = log.dayPlan?.length ? log.dayPlan : log.priorities;
            const done = items.filter((i) => i.done).length;
            return (
              <li key={log.day}>
                <p className="text-sm font-medium text-muted">
                  {fmt(log.day)}
                  <span className="ml-2 font-normal text-faint">
                    {done}/{items.length} fait
                  </span>
                </p>
                <ul className="mt-1.5 space-y-1">
                  {items.map((it, i) => (
                    <li
                      key={i}
                      className="flex items-baseline gap-2 text-sm leading-snug"
                    >
                      <span className={it.done ? "text-cap" : "text-faint"}>
                        {it.done ? "✓" : "○"}
                      </span>
                      <span
                        className={it.done ? "text-faint" : "text-muted"}
                      >
                        {it.title}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
    <div className="mt-8">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-faint transition-colors hover:text-muted"
      >
        <span className="text-[0.7rem]">{open ? "▾" : "▸"}</span>
        Ce que Cap sait de toi
      </button>
      {open &&
        (editing ? (
          <div className="mt-3">
            <textarea
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              rows={7}
              className="w-full resize-y rounded-xl border border-line bg-surface p-3 text-sm leading-relaxed text-ink focus:outline-none focus:ring-1 focus:ring-cap/40"
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
          </div>
        ) : (
          <div className="mt-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
              {text}
            </p>
            <button
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
              className="mt-2 text-xs text-faint underline decoration-dotted transition-colors hover:text-cap-ink"
            >
              Modifier ce que Cap retient
            </button>
          </div>
        ))}
    </div>
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
