"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  markLegacyImported,
  readLegacyState,
  useCap,
} from "@/lib/store";
import { todayISO } from "@/lib/merge";
import type { CapState, ContextNote, Objective, Priority } from "@/lib/types";
import AuClair, { type LandedPayload } from "@/components/AuClair";
import Carte from "@/components/Carte";
import { CapTrack, deadlineChip, isHard } from "@/components/CapTrack";

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

  const onEditCapTitle = useCallback(
    (id: string, title: string) => {
      if (!title.trim()) return;
      save({
        ...state,
        objectives: state.objectives.map((o) =>
          o.id === id ? { ...o, title: title.trim() } : o,
        ),
      });
    },
    [state, save],
  );

  const onEditFlowTitle = useCallback(
    (objId: string, flowId: string, title: string) => {
      if (!title.trim()) return;
      save({
        ...state,
        objectives: state.objectives.map((o) =>
          o.id === objId
            ? {
                ...o,
                flows: (o.flows ?? []).map((f) =>
                  f.id === flowId ? { ...f, title: title.trim() } : f,
                ),
              }
            : o,
        ),
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
    state.prioritiesDate !== todayISO();

  if (!ready) {
    return <main className="min-h-full" />;
  }

  return (
    <main className="mx-auto min-h-full max-w-6xl px-6 pb-32 pt-16 sm:px-8 sm:pt-24">
      <Header view={view} onView={setView} />

      {!hasServerState && <ImportBanner onImport={save} />}

      {view === "today" && (
        <div className="mx-auto max-w-2xl">
          {state.lastNote && state.priorities.length > 0 && (
            <p
              className={`mb-10 font-display text-lg italic leading-snug text-muted ${
                justLanded ? "animate-rise" : "animate-fade"
              }`}
            >
              {state.lastNote}
            </p>
          )}

          {state.priorities.length === 0 ? (
            <EmptyState
              first={state.objectives.length === 0}
              onOpen={openClair}
            />
          ) : (
            <>
              {stale && (
                <p className="mb-6 text-sm text-faint">
                  Ces priorités datent d&apos;un autre jour. Un point avec Cap
                  pour les rafraîchir&nbsp;?
                </p>
              )}
              <ol className="stagger flex flex-col gap-4">
                {state.priorities.map((p, i) => (
                  <PriorityCard
                    key={p.id}
                    index={i + 1}
                    priority={p}
                    objective={
                      p.objectiveId ? objById.get(p.objectiveId) : undefined
                    }
                  />
                ))}
              </ol>
            </>
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
          onEditCapTitle={onEditCapTitle}
          onEditFlowTitle={onEditFlowTitle}
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

      {toast && (
        <div className="animate-rise fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink shadow-md">
          <span className="mr-1.5 text-cap-ink">✓</span>
          {toast}
        </div>
      )}
    </main>
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
    <header className="mb-10">
      <p className="text-sm uppercase tracking-[0.18em] text-faint">{today}</p>
      <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
        {title}
      </h1>

      <div className="mt-6 inline-flex gap-1 rounded-full border border-line bg-surface p-1 text-sm shadow-sm">
        <Tab active={view === "clair"} onClick={() => onView("clair")}>
          <span className="flex items-center gap-1.5">
            Au clair
            <kbd className="hidden rounded bg-sink px-1 py-0.5 text-[0.65rem] text-faint sm:inline">
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

function PriorityCard({
  index,
  priority,
  objective,
}: {
  index: number;
  priority: Priority;
  objective?: Objective;
}) {
  const chip = objective ? deadlineChip(objective) : null;
  const hard = objective ? isHard(objective) : false;

  return (
    <li className="rounded-2xl border border-line bg-surface p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-sm text-faint">{index}</span>
        <h2 className="font-display text-xl font-medium leading-snug text-ink">
          {priority.title}
        </h2>
      </div>
      {priority.why && (
        <p className="mt-2 pl-7 text-[0.95rem] leading-relaxed text-muted">
          {priority.why}
        </p>
      )}
      {priority.via && (
        <p className="mt-1 pl-7 text-sm text-faint">
          une tranche de&nbsp;<span className="text-muted">{priority.via}</span>
        </p>
      )}
      {objective && (
        <div className="mt-4 pl-7">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              <span className="text-faint">vers&nbsp;</span>
              <span className="text-muted">{objective.title}</span>
            </span>
            {chip ? (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  chip.urgent ? "bg-cap-soft text-cap-ink" : "bg-sink text-muted"
                }`}
              >
                {chip.label}
              </span>
            ) : hard ? null : objective.unlocks ? (
              <span className="shrink-0 rounded-full bg-gold-soft px-2 py-0.5 text-xs font-medium text-gold">
                récompense
              </span>
            ) : null}
          </div>
          <CapTrack objective={objective} size="sm" />
        </div>
      )}
    </li>
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
    <div className="mt-10">
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
