import type {
  CapState,
  ContextNote,
  DayItem,
  DayItemKind,
  DayLog,
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

// Clé de rapprochement tolérante : on fusionne les quasi-identiques (casse,
// accents, ponctuation, espaces) au lieu d'en faire des doublons — SANS aller
// jusqu'au flou (« Sourcing » ≠ « Sourcing de boîtes » restent distincts).
// « Sourcing de boîtes » et « sourcing de boites » deviennent la même clé.
export function normKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // enlève les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ") // ponctuation → espace
    .trim()
    .replace(/\s+/g, " ");
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
      const key = normKey(m.title);
      const prev = existing?.find((e) => normKey(e.title) === key);
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
      const key = normKey(title);
      const prev = existing?.find((f) => normKey(f.title) === key);
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
    const key = normKey(p.title);
    const prevKey = p.previousTitle ? normKey(p.previousTitle) : undefined;
    if (!key) continue;
    const idx = list.findIndex((o) => {
      const t = normKey(o.title);
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
      const key = p.objective ? normKey(p.objective) : undefined;
      const obj = key
        ? objectives.find((o) => normKey(o.title) === key)
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
      const key = normKey(h.title);
      const prev = existing?.find((e) => normKey(e.title) === key);
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
      ? list?.find((x) => normKey(x.title) === normKey(title))
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

// Passe UNIQUE : tout se commit en direct (modèle compagnon continu). Chaque
// champ n'est touché que s'il est réellement fourni ; sinon carry-forward.
// La remise à zéro du jour n'est JAMAIS faite ici — c'est le rôle de rollDay.
export function applyReconciliation(state: CapState, r: Reconciliation): CapState {
  const objectives = r.objectives?.length
    ? mergeObjectives(state.objectives, r.objectives)
    : state.objectives;

  const priorities = r.priorities?.length
    ? linkPriorities(objectives, r.priorities)
    : state.priorities;

  const contextNotes =
    r.contextNotes !== undefined
      ? mergeContextNotes(state.contextNotes, r.contextNotes)
      : state.contextNotes;

  const habits =
    r.habits !== undefined ? mergeHabits(state.habits, r.habits) : state.habits;

  // Le dayPlan ne change QUE s'il est explicitement re-fourni ; sinon conservé
  // (sans ça, chaque message re-dérivant des priorités effacerait la journée).
  const dayPlan =
    r.dayPlan !== undefined
      ? linkDayPlan(priorities, habits, r.dayPlan)
      : state.dayPlan;

  return {
    ...state,
    objectives,
    priorities,
    prioritiesDate: r.priorities?.length
      ? new Date().toISOString()
      : state.prioritiesDate,
    understanding:
      r.understanding?.trim() && r.understanding.trim().length > 0
        ? r.understanding.trim()
        : state.understanding,
    lastNote: r.note?.trim() || state.lastNote,
    contextNotes,
    habits,
    dayPlan,
  };
}

const HISTORY_CAP = 14;

// Passage à un nouveau jour : archive la journée écoulée (priorités + plan, avec
// leur état « fait ») dans l'historique, puis remet à zéro pour repartir propre.
// Garde objectives / habits / understanding / contextNotes. Fonction PURE — la
// détection du nouveau jour vit ailleurs (endpoint session). `dayIso` = le jour
// qu'on archive.
export function rollDay(state: CapState, dayIso: string): CapState {
  const dayItemDone = (d: DayItem): boolean =>
    d.kind === "priority" && d.refId
      ? !!state.priorities.find((p) => p.id === d.refId)?.done
      : !!d.done;

  const log: DayLog = {
    day: dayIso,
    priorities: state.priorities.map((p) => ({ title: p.title, done: !!p.done })),
    ...(state.dayPlan?.length
      ? {
          dayPlan: state.dayPlan.map((d) => ({
            title: d.title,
            done: dayItemDone(d),
          })),
        }
      : {}),
    ...(state.lastNote ? { note: state.lastNote } : {}),
  };

  // On n'archive que si la journée portait quelque chose (pas de log vide).
  const hadContent =
    state.priorities.length > 0 || (state.dayPlan?.length ?? 0) > 0;
  const history = hadContent
    ? [...(state.history ?? []), log].slice(-HISTORY_CAP)
    : state.history;

  return {
    ...state,
    priorities: [],
    dayPlan: undefined,
    prioritiesDate: undefined,
    history,
  };
}
