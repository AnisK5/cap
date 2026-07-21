"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  markLegacyImported,
  readLegacyState,
  useCap,
} from "@/lib/store";
import { sameLocalDay } from "@/lib/merge";
import type { CapState, ContextNote, Objective, Priority } from "@/lib/types";
import AuClair, { type LandedPayload } from "@/components/AuClair";
import Carte from "@/components/Carte";

type View = "clair" | "today" | "carte";

export default function Home() {
  const { state, ready, hasServerState, replace, save } = useCap();
  const [view, setView] = useState<View>("today");
  const [justLanded, setJustLanded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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

  const onLanded = useCallback(
    (landed: LandedPayload) => {
      replace(landed);
      setView("today");
      setJustLanded(true);
      setTimeout(() => setJustLanded(false), 1400);
    },
    [replace],
  );

  // Mise à jour EN DIRECT pendant la conversation : le serveur a déjà fusionné
  // et écrit — on remplace le miroir local + petit encart de ce qui a changé.
  const onLive = useCallback(
    (live: LandedPayload) => {
      replace(live);
      if (live.note?.trim()) {
        setToast(live.note.trim());
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

  const [first, ...rest] = state.priorities;

  return (
    <main className="mx-auto min-h-full max-w-6xl px-6 pb-40 pt-12 sm:px-8 sm:pb-32 sm:pt-24">
      <Header view={view} onView={setView} />

      {!hasServerState && <ImportBanner onImport={save} />}

      {view === "today" && (
        <div className="mx-auto max-w-2xl">
          {state.priorities.length === 0 ? (
            <EmptyState
              first={state.objectives.length === 0}
              onOpen={openClair}
            />
          ) : (
            <>
              {/* Chaque élément porte son sens : d'où viennent ces priorités,
                  et sont-elles fraîches. */}
              <p
                className={`mb-5 text-xs uppercase tracking-[0.18em] ${
                  stale ? "text-gold" : "text-faint"
                }`}
              >
                {stale
                  ? "Posées un autre jour — un point pour les rafraîchir ?"
                  : "Posées aujourd'hui avec Cap"}
              </p>
              <PriorityHero
                priority={first}
                objective={
                  first.objectiveId ? objById.get(first.objectiveId) : undefined
                }
                justLanded={justLanded}
              />
              {rest.length > 0 && <NextList items={rest} objById={objById} />}
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
          {state.contextNotes && state.contextNotes.length > 0 && (
            <ContextSection notes={state.contextNotes} onDelete={onDeleteNote} />
          )}
        </div>
      )}

      {view === "carte" && (
        <Carte
          objectives={state.objectives}
          onOpen={openClair}
          onDeleteCap={onDeleteCap}
          onUpdateObjective={onUpdateObjective}
        />
      )}

      {/* Monté en permanence pour ne PAS perdre la conversation en changeant
          d'onglet ; caché quand l'onglet n'est pas actif. */}
      <div className="mx-auto max-w-2xl">
        <AuClair
          active={view === "clair"}
          onClose={() => setView("today")}
          onLanded={onLanded}
          onLive={onLive}
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

function PriorityHero({
  priority,
  objective,
  justLanded,
}: {
  priority: Priority;
  objective?: Objective;
  justLanded: boolean;
}) {
  return (
    <section className={justLanded ? "animate-rise" : "animate-fade"}>
      <h2 className="font-display text-3xl font-medium leading-tight tracking-tight text-ink sm:text-4xl">
        {priority.title}
      </h2>
      {priority.why && (
        <p className="mt-3 max-w-lg text-[1.02rem] leading-relaxed text-muted">
          — {priority.why}
        </p>
      )}
      {objective && (
        <p className="mt-5 text-sm text-faint">
          fait avancer&nbsp;:{" "}
          <span className="text-muted">
            {objective.icon && `${objective.icon} `}
            {objective.title}
          </span>
          {priority.via && (
            <span>
              {" "}
              · flux «&nbsp;{priority.via}&nbsp;»
            </span>
          )}
        </p>
      )}
    </section>
  );
}

function NextList({
  items,
  objById,
}: {
  items: Priority[];
  objById: Map<string, Objective>;
}) {
  return (
    <div className="mt-12">
      <p className="text-xs uppercase tracking-[0.18em] text-faint">Ensuite</p>
      <ol className="mt-3 flex flex-col gap-2.5">
        {items.map((p, i) => {
          const obj = p.objectiveId ? objById.get(p.objectiveId) : undefined;
          return (
            <li key={p.id} className="flex items-baseline gap-3">
              <span className="font-display text-sm text-faint">{i + 2}</span>
              <p className="min-w-0 leading-snug">
                <span className="text-ink">{p.title}</span>
                {obj && (
                  <span className="text-faint">
                    &nbsp;→ {obj.icon ? `${obj.icon} ` : ""}
                    {obj.title}
                  </span>
                )}
              </p>
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
      <p className="text-sm uppercase tracking-[0.18em] text-faint">{today}</p>
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
