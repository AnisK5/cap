import type {
  CapState,
  ContextNote,
  DayItem,
  DayItemKind,
  Flow,
  FlowState,
  Habit,
  Objective,
  Priority,
  Step,
} from "./types";

// Fusion de la réconciliation dans l'état — fonctions PURES, exécutées côté
// serveur (source de vérité unique, pas de course avec le client).
// Comportements validés par l'usage, à préserver :
//  - match par titre exact (souple sur la casse), previousTitle pour renommer
//    sans créer de doublon ;
//  - une liste de steps/flows proposée REMPLACE l'existante (c'est ainsi que
//    l'IA nettoie), mais un cap dont les flux ne sont pas mentionnés garde
//    les siens ;
//  - les ids et l'état « done » survivent par match de titre ;
//  - en mode live (pendant la conversation) : structure + compréhension
//    seulement — priorités du jour, notes de contexte et note d'accueil sont
//    réservées à l'atterrissage.

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Vrai « même jour » dans le fuseau de CELUI QUI REGARDE : la comparaison se
// fait côté client sur des timestamps complets — jamais de minuit serveur
// (le serveur déployé vit en UTC, pas dans le fuseau de la personne).
export function sameLocalDay(aIso: string, b: Date = new Date()): boolean {
  const a = new Date(aIso);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export interface Reconciliation {
  contextNotes?: string[]; // liste COMPLÈTE des mémos à garder
  priorities?: {
    title: string;
    why: string;
    objective?: string;
    via?: string;
  }[];
  objectives?: {
    title: string;
    previousTitle?: string; // ancien titre EXACT si renommage
    icon?: string;
    deadline?: string | null;
    target?: string;
    horizon?: string;
    unlocks?: string;
    moved?: boolean;
    steps?: {
      title: string;
      done?: boolean;
      fromWeek?: number;
      toWeek?: number;
      voie?: string;
    }[];
    flows?: {
      title: string;
      state?: FlowState;
      waitingOn?: string | null; // null = redevient dispo/actif
      fromWeek?: number;
      toWeek?: number;
      voie?: string;
    }[];
  }[];
  // Habitudes persistantes : fournies seulement quand apprises/précisées.
  habits?: {
    title: string;
    icon?: string;
    cadence?: string;
    why?: string;
    preferredMoment?: string;
  }[];
  // La journée ordonnée (atterrissage seulement). priority/habit = titre
  // EXACT de l'élément référencé, pour lier sans doublon.
  dayPlan?: {
    title: string;
    kind: DayItemKind;
    priority?: string;
    habit?: string;
    dueBy?: string;
    why?: string;
    done?: boolean; // déjà fait/réglé aujourd'hui — à célébrer comme acquis
  }[];
  understanding?: string;
  note?: string;
}

type ProposedSteps = NonNullable<
  NonNullable<Reconciliation["objectives"]>[number]["steps"]
>;
type ProposedFlows = NonNullable<
  NonNullable<Reconciliation["objectives"]>[number]["flows"]
>;

// ① La liste ORDONNÉE proposée remplace l'existante ; « done » et id des
// étapes déjà connues sont reportés (match par titre).
function mergeSteps(existing: Step[] | undefined, proposed: ProposedSteps): Step[] {
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

// ② Même logique pour les flux continus.
function mergeFlows(existing: Flow[] | undefined, proposed: ProposedFlows): Flow[] {
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
  return proposed
    .filter((t) => t.trim())
    .map((t) => {
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

// Fusionne des caps proposés : match par previousTitle (renommage) puis par
// titre ; crée sinon.
function mergeObjectives(
  existing: Objective[],
  proposed: NonNullable<Reconciliation["objectives"]>,
): Objective[] {
  const now = new Date().toISOString();
  let list = [...existing];
  for (const p of proposed) {
    const key = p.title.trim().toLowerCase();
    const prevKey = p.previousTitle?.trim().toLowerCase();
    if (!key) continue;
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
        title: p.title.trim(),
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

// Relie une priorité à un cap par le titre que l'assistant a nommé.
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

// Habitudes : la liste proposée remplace, ids et champs préservés par titre.
// (Le réconcile ne la fournit que quand quelque chose a été appris/changé.)
function mergeHabits(
  existing: Habit[] | undefined,
  proposed: NonNullable<Reconciliation["habits"]>,
): Habit[] {
  return proposed
    .filter((h) => h.title?.trim())
    .map((h) => {
      const key = h.title.trim().toLowerCase();
      const prev = existing?.find((e) => e.title.trim().toLowerCase() === key);
      return {
        id: prev?.id ?? newId(),
        title: h.title.trim(),
        // `||` (pas `??`) : une chaîne vide envoyée par le LLM ne doit PAS
        // écraser la valeur déjà connue — elle se replie sur `prev`.
        ...(h.icon?.trim() || prev?.icon
          ? { icon: h.icon?.trim() || prev?.icon }
          : {}),
        ...(h.cadence?.trim() || prev?.cadence
          ? { cadence: h.cadence?.trim() || prev?.cadence }
          : {}),
        ...(h.why?.trim() || prev?.why
          ? { why: h.why?.trim() || prev?.why }
          : {}),
        ...(h.preferredMoment?.trim() || prev?.preferredMoment
          ? { preferredMoment: h.preferredMoment?.trim() || prev?.preferredMoment }
          : {}),
      };
    });
}

// La journée : relie chaque créneau à sa priorité/habitude par titre.
function linkDayPlan(
  priorities: Priority[],
  habits: Habit[] | undefined,
  proposed: NonNullable<Reconciliation["dayPlan"]>,
): DayItem[] {
  const find = <T extends { id: string; title: string }>(
    list: T[] | undefined,
    title?: string,
  ) =>
    title
      ? list?.find(
          (x) => x.title.trim().toLowerCase() === title.trim().toLowerCase(),
        )
      : undefined;
  return proposed
    .filter((d) => d.title?.trim())
    .map((d) => {
      const ref =
        d.kind === "priority"
          ? find(priorities, d.priority ?? d.title)
          : d.kind === "habit"
            ? find(habits, d.habit ?? d.title)
            : undefined;
      return {
        id: newId(),
        kind: d.kind,
        ...(ref ? { refId: ref.id } : {}),
        title: d.title.trim(),
        ...(d.dueBy?.trim() ? { dueBy: d.dueBy.trim() } : {}),
        ...(d.why?.trim() ? { why: d.why.trim() } : {}),
        done: d.done ?? false,
      };
    });
}

// Aperçu de la journée EN COURS pendant la conversation : on relie priorités
// et créneaux comme à l'atterrissage, mais SANS rien committer — c'est un
// brouillon vivant montré dans « Au clair » pour rassurer avant d'atterrir.
export function previewDay(
  objectives: Objective[],
  habits: Habit[] | undefined,
  r: Reconciliation,
): { priorities: Priority[]; dayPlan: DayItem[] } {
  const priorities = r.priorities ? linkPriorities(objectives, r.priorities) : [];
  const dayPlan = r.dayPlan ? linkDayPlan(priorities, habits, r.dayPlan) : [];
  return { priorities, dayPlan };
}

export function applyReconciliation(
  state: CapState,
  r: Reconciliation,
  opts: { live?: boolean } = {},
): CapState {
  const objectives = r.objectives?.length
    ? mergeObjectives(state.objectives, r.objectives)
    : state.objectives;

  const priorities =
    !opts.live && r.priorities?.length
      ? linkPriorities(objectives, r.priorities)
      : state.priorities;

  const contextNotes =
    !opts.live && r.contextNotes !== undefined
      ? mergeContextNotes(state.contextNotes, r.contextNotes)
      : state.contextNotes;

  // Les habitudes sont structurelles : apprises au fil de l'eau (live inclus).
  const habits =
    r.habits !== undefined ? mergeHabits(state.habits, r.habits) : state.habits;

  // La journée n'est posée qu'à l'atterrissage. De nouvelles priorités sans
  // nouveau plan invalident l'ancien (il pointait sur la journée d'avant).
  const dayPlan = opts.live
    ? state.dayPlan
    : r.dayPlan !== undefined
      ? linkDayPlan(priorities, habits, r.dayPlan)
      : r.priorities?.length
        ? undefined
        : state.dayPlan;

  return {
    ...state,
    objectives,
    priorities,
    prioritiesDate:
      !opts.live && r.priorities?.length
        ? new Date().toISOString()
        : state.prioritiesDate,
    understanding:
      r.understanding?.trim() && r.understanding.trim().length > 0
        ? r.understanding.trim()
        : state.understanding,
    lastNote: opts.live ? state.lastNote : r.note?.trim() || state.lastNote,
    contextNotes,
    habits,
    dayPlan,
  };
}
