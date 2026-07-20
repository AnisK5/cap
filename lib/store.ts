"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EMPTY_STATE,
  type CapState,
  type ContextNote,
  type Flow,
  type FlowState,
  type Objective,
  type Priority,
  type SessionLog,
  type Step,
} from "./types";

const STATE_KEY = "cap.state.v1";
const SESSIONS_KEY = "cap.sessions.v1";
const SYNC_EVENT = "cap:sync";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: key }));
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function usePersisted<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setValue(read(key, fallback));
    setReady(true);

    const sync = () => setValue(read(key, fallback));
    const onCustom = (e: Event) => {
      if ((e as CustomEvent).detail === key) sync();
    };
    window.addEventListener(SYNC_EVENT, onCustom);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SYNC_EVENT, onCustom);
      window.removeEventListener("storage", sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T) => {
      write(key, next);
      setValue(next);
    },
    [key],
  );

  return { value, update, ready };
}

export function useCap() {
  const { value, update, ready } = usePersisted<CapState>(
    STATE_KEY,
    EMPTY_STATE,
  );
  return { state: value, update, ready };
}

export function useSessions() {
  const { value, update, ready } = usePersisted<SessionLog[]>(SESSIONS_KEY, []);
  const log = useCallback(
    (s: SessionLog) => update([s, ...value].slice(0, 40)),
    [value, update],
  );
  return { sessions: value, log, ready };
}

// --- Réconciliation : ce que l'assistant propose en fin de session ---
// Renvoyé par /api/reconcile. On l'applique d'un coup sur l'état persistant.
export interface Reconciliation {
  contextNotes?: string[]; // liste COMPLÈTE des mémos à garder (textes bruts)
  priorities?: {
    title: string;
    why: string;
    objective?: string;
    via?: string; // le flux/étape que cette tranche du jour alimente
  }[];
  objectives?: {
    title: string;
    previousTitle?: string; // ancien titre EXACT si renommage — permet le match sans doublon
    icon?: string;
    deadline?: string | null;
    target?: string; // définition chiffrée de « réussi »
    horizon?: string; // échéance visée même souple
    unlocks?: string;
    moved?: boolean; // le cap a bougé pendant la conversation → maj momentum
    steps?: {
      title: string;
      done?: boolean;
      fromWeek?: number;
      toWeek?: number;
      voie?: string;
    }[]; // ① squelette ordonné
    flows?: {
      title: string;
      state?: FlowState;
      waitingOn?: string | null; // null = redevient dispo/actif
      fromWeek?: number;
      toWeek?: number;
      voie?: string;
    }[]; // ② activités continues
  }[];
  understanding?: string;
  note?: string;
}

// ① L'IA fournit la liste ORDONNÉE des étapes quand elle (re)décompose un cap.
// On reporte l'état « fait » et l'id des étapes existantes (match par titre).
function mergeSteps(
  existing: Step[] | undefined,
  proposed: NonNullable<
    NonNullable<Reconciliation["objectives"]>[number]["steps"]
  >,
): Step[] {
  return proposed
    .filter((m) => m.title?.trim())
    .map((m) => {
      const key = m.title.trim().toLowerCase();
      const prev = existing?.find((e) => e.title.trim().toLowerCase() === key);
      return {
        id: prev?.id ?? newId(),
        title: m.title.trim(),
        done: m.done ?? prev?.done ?? false,
        fromWeek: m.fromWeek ?? prev?.fromWeek,
        toWeek: m.toWeek ?? prev?.toWeek,
        voie: m.voie?.trim() ?? prev?.voie,
      };
    });
}

// ② Flux continus — même logique que mergeSteps : la liste proposée REMPLACE
// entièrement l'existante. IDs préservés par match de titre. La garde contre
// les suppressions accidentelles : mergeObjectives n'appelle cette fonction
// que si p.flows?.length > 0 — si le réconcile ne mentionne pas les flux
// d'un cap, ils sont laissés intacts.
function mergeFlows(
  existing: Flow[] | undefined,
  proposed: NonNullable<
    NonNullable<Reconciliation["objectives"]>[number]["flows"]
  >,
): Flow[] {
  return proposed
    .filter((p) => p.title?.trim())
    .map((p) => {
      const title = p.title.trim();
      const key = title.toLowerCase();
      const prev = existing?.find((f) => f.title.trim().toLowerCase() === key);
      return {
        id: prev?.id ?? newId(),
        title,
        ...(p.state ?? prev?.state
          ? { state: (p.state ?? prev?.state) as FlowState }
          : {}),
        ...(p.waitingOn !== undefined
          ? { waitingOn: p.waitingOn ? p.waitingOn.trim() : undefined }
          : prev?.waitingOn !== undefined
            ? { waitingOn: prev.waitingOn }
            : {}),
        ...(p.fromWeek !== undefined
          ? { fromWeek: p.fromWeek }
          : prev?.fromWeek !== undefined
            ? { fromWeek: prev.fromWeek }
            : {}),
        ...(p.toWeek !== undefined
          ? { toWeek: p.toWeek }
          : prev?.toWeek !== undefined
            ? { toWeek: prev.toWeek }
            : {}),
        ...(p.voie?.trim()
          ? { voie: p.voie.trim() }
          : prev?.voie
            ? { voie: prev.voie }
            : {}),
      };
    });
}

function mergeContextNotes(
  existing: ContextNote[] | undefined,
  proposed: string[],
): ContextNote[] {
  return proposed.filter((t) => t.trim()).map((t) => {
    const text = t.trim();
    const prev = existing?.find((n) => n.text === text);
    return { id: prev?.id ?? newId(), text };
  });
}

function normalizeDate(d?: string | null): string | null | undefined {
  if (d === null) return null;
  if (!d) return undefined;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

// Fusionne des caps proposés : match par titre (souple), crée sinon.
function mergeObjectives(
  existing: Objective[],
  proposed: NonNullable<Reconciliation["objectives"]>,
  opts: { live?: boolean } = {},
): Objective[] {
  const now = new Date().toISOString();
  let list = [...existing];
  for (const p of proposed) {
    const key = p.title.trim().toLowerCase();
    const prevKey = p.previousTitle?.trim().toLowerCase();
    if (!key) continue;
    // Match by previousTitle first (rename case), then by current title
    const idx = list.findIndex((o) => {
      const t = o.title.trim().toLowerCase();
      return (prevKey && t === prevKey) || t === key;
    });
    const deadline = normalizeDate(p.deadline);
    const common = {
      ...(deadline !== undefined ? { deadline } : {}),
      ...(p.icon?.trim() ? { icon: p.icon.trim() } : {}),
      ...(p.target ? { target: p.target.trim() } : {}),
      ...(p.horizon ? { horizon: p.horizon.trim() } : {}),
      ...(p.unlocks ? { unlocks: p.unlocks.trim() } : {}),
      ...(p.moved ? { lastMovedAt: now } : {}),
    };
    if (idx >= 0) {
      const steps = p.steps?.length
        ? mergeSteps(list[idx].steps, p.steps)
        : list[idx].steps;
      const flows = p.flows?.length
        ? mergeFlows(list[idx].flows, p.flows)
        : list[idx].flows;
      list[idx] = {
        ...list[idx],
        title: p.title.trim(), // applique le renommage si previousTitle était différent
        ...common,
        ...(steps ? { steps } : {}),
        ...(flows ? { flows } : {}),
      };
    } else {
      list = [
        ...list,
        {
          id: newId(),
          title: p.title.trim(),
          deadline: deadline ?? null,
          createdAt: now,
          ...common,
          ...(p.steps?.length ? { steps: mergeSteps(undefined, p.steps) } : {}),
          ...(p.flows?.length ? { flows: mergeFlows(undefined, p.flows) } : {}),
        },
      ];
    }
  }
  return list;
}

// Relie une priorité à un cap par son titre (celui que l'assistant a nommé).
function linkPriorities(
  objectives: Objective[],
  proposed: NonNullable<Reconciliation["priorities"]>,
): Priority[] {
  return proposed
    .filter((p) => p.title?.trim())
    .slice(0, 3)
    .map((p) => {
      const key = p.objective?.trim().toLowerCase();
      const obj = key
        ? objectives.find((o) => o.title.trim().toLowerCase() === key)
        : undefined;
      return {
        id: newId(),
        title: p.title.trim(),
        why: (p.why || "").trim(),
        objectiveId: obj?.id,
        ...(p.via?.trim() ? { via: p.via.trim() } : {}),
      };
    });
}

export function applyReconciliation(
  state: CapState,
  r: Reconciliation,
  opts: { live?: boolean } = {},
): CapState {
  const objectives = r.objectives?.length
    ? mergeObjectives(state.objectives, r.objectives, opts)
    : state.objectives;

  // En mode « live » (pendant la conversation) on met à jour la STRUCTURE et la
  // compréhension au fil de l'eau, mais pas les priorités du jour ni la note
  // d'accueil : ça, c'est réservé à l'atterrissage (« C'est assez clair »).
  const priorities =
    !opts.live && r.priorities
      ? linkPriorities(objectives, r.priorities)
      : state.priorities;

  const contextNotes =
    !opts.live && r.contextNotes !== undefined
      ? mergeContextNotes(state.contextNotes, r.contextNotes)
      : state.contextNotes;

  return {
    ...state,
    objectives,
    priorities,
    prioritiesDate:
      !opts.live && r.priorities ? todayISO() : state.prioritiesDate,
    understanding:
      r.understanding?.trim() && r.understanding.trim().length > 0
        ? r.understanding.trim()
        : state.understanding,
    lastNote: opts.live ? state.lastNote : r.note?.trim() || state.lastNote,
    contextNotes,
  };
}
