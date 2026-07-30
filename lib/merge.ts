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
import { normalizeWeekPlan, type RawWeekPlan } from "./week";

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
    // Le compteur mesurable vers la cible (l'IA le pose : « candidatures », 30).
    metric?: { label: string; target: number };
    // Le CUMUL observé maintenant (« ~45 en tout ») → on le datera en snapshot.
    progressTotal?: number;
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
  // Le plan macro de la semaine, extrait quand la conversation ORGANISE les
  // prochains jours (« jeudi freelance, vendredi job… »). Cap désigné par titre.
  weekPlan?: RawWeekPlan;
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
// Ajoute un relevé cumulé daté (le concret sur l'axe temps). On ne double pas
// un même total ; un relevé du même jour est remplacé (un point par jour). Cappé.
function appendProgress(
  prev: { at: string; total: number }[] | undefined,
  total: number | undefined,
  now: string,
): { at: string; total: number }[] | undefined {
  if (total === undefined || !Number.isFinite(total) || total < 0) return prev;
  const arr = prev ?? [];
  const last = arr[arr.length - 1];
  if (last && last.total === total) return arr;
  const today = now.slice(0, 10);
  const base = last && last.at.slice(0, 10) === today ? arr.slice(0, -1) : arr;
  return [...base, { at: now, total }].slice(-60);
}

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
    const metric =
      p.metric && p.metric.label?.trim() && Number.isFinite(p.metric.target)
        ? { label: p.metric.label.trim(), target: p.metric.target }
        : undefined;
    const common = {
      ...(deadline !== undefined ? { deadline } : {}),
      ...(p.icon?.trim() ? { icon: p.icon.trim() } : {}),
      ...(p.target ? { target: p.target.trim() } : {}),
      ...(p.horizon ? { horizon: p.horizon.trim() } : {}),
      ...(p.unlocks ? { unlocks: p.unlocks.trim() } : {}),
      ...(metric ? { metric } : {}),
      ...(p.moved ? { lastMovedAt: now } : {}),
    };
    if (idx >= 0) {
      const steps = p.steps?.length
        ? mergeSteps(list[idx].steps, p.steps)
        : list[idx].steps;
      const flows = p.flows?.length
        ? mergeFlows(list[idx].flows, p.flows)
        : list[idx].flows;
      const progress = appendProgress(list[idx].progress, p.progressTotal, now);
      list[idx] = {
        ...list[idx],
        title: p.title.trim(),
        ...common,
        ...(steps ? { steps } : {}),
        ...(flows ? { flows } : {}),
        ...(progress ? { progress } : {}),
      };
    } else {
      const progress = appendProgress(undefined, p.progressTotal, now);
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
          ...(progress ? { progress } : {}),
        },
      ];
    }
  }
  return list;
}

// Relie une priorité à un cap par le titre que l'assistant a nommé.
// CRUCIAL : le réconcile ne renvoie JAMAIS `done` (ni l'id) — c'est un état
// client, posé quand tu coches. Donc on REPORTE `done` ET l'id de la priorité
// existante (match par titre), sinon chaque tour de chat les efface (« ça revient
// en arrière ») et casse les refId du dayPlan qui pointaient dessus.
function linkPriorities(
  objectives: Objective[],
  proposed: NonNullable<Reconciliation["priorities"]>,
  existing: Priority[],
): Priority[] {
  return proposed
    .filter((p) => p.title?.trim())
    .slice(0, 3)
    .map((p) => {
      const key = p.objective ? normKey(p.objective) : undefined;
      const obj = key
        ? objectives.find((o) => normKey(o.title) === key)
        : undefined;
      const prev = existing.find((e) => normKey(e.title) === normKey(p.title));
      return {
        id: prev?.id ?? newId(),
        title: p.title.trim(),
        why: (p.why || "").trim() || prev?.why || "",
        objectiveId: obj?.id ?? prev?.objectiveId,
        done: prev?.done ?? false,
        ...(p.via?.trim() ? { via: p.via.trim() } : prev?.via ? { via: prev.via } : {}),
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
  existing: DayItem[] | undefined,
): DayItem[] {
  const find = <T extends { id: string; title: string }>(
    list: T[] | undefined,
    title?: string,
  ) =>
    title
      ? list?.find((x) => normKey(x.title) === normKey(title))
      : undefined;
  // Un cap/rituel ne se lie qu'à UN SEUL créneau : sinon deux créneaux partagent
  // le même refId et, une priorité se cochant via elle-même, cocher l'un coche
  // l'autre d'un coup (le bug du multi-cochage). Les créneaux en double gardent
  // leur propre `done` et deviennent indépendants.
  const usedRefs = new Set<string>();
  return proposed
    .filter((d) => d.title?.trim())
    .map((d) => {
      const match =
        d.kind === "priority"
          ? find(priorities, d.priority ?? d.title)
          : d.kind === "habit"
            ? find(habits, d.habit ?? d.title)
            : undefined;
      const ref = match && !usedRefs.has(match.id) ? match : undefined;
      if (ref) usedRefs.add(ref.id);
      // On REPORTE l'état d'un créneau habit/fixed déjà connu (match titre+kind) :
      // sinon cocher une douche/un repas, puis un tour de chat qui re-pose la
      // journée, effacerait le ✓. (Pour un créneau `priority`, le `done` vit sur
      // la priorité elle-même — déjà préservée par linkPriorities.)
      const prev = existing?.find(
        (e) => e.kind === d.kind && normKey(e.title) === normKey(d.title),
      );
      return {
        id: prev?.id ?? newId(),
        kind: d.kind,
        ...(ref ? { refId: ref.id } : {}),
        title: d.title.trim(),
        ...(d.dueBy?.trim() ? { dueBy: d.dueBy.trim() } : {}),
        ...(d.why?.trim() ? { why: d.why.trim() } : {}),
        done: d.done ?? prev?.done ?? false,
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
    ? linkPriorities(objectives, r.priorities, state.priorities)
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
      ? linkDayPlan(priorities, habits, r.dayPlan, state.dayPlan)
      : state.dayPlan;

  // Le weekPlan ne change QUE si la conversation a réellement organisé la
  // semaine (comme le dayPlan) ; un plan sans créneau valide n'écrase pas
  // l'existant, pour ne pas vider la grille par accident.
  let weekPlan = state.weekPlan;
  if (r.weekPlan !== undefined) {
    const wp = normalizeWeekPlan(r.weekPlan, objectives);
    if (wp.slots.length > 0) weekPlan = wp;
  }

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
    weekPlan,
  };
}

// Dédup déterministe des rituels (par titre normalisé), champs préservés.
export function dedupeHabits(
  habits: Habit[] | undefined,
): { habits: Habit[]; removed: number } {
  const list = habits ?? [];
  let removed = 0;
  const map = new Map<string, Habit>();
  for (const h of list) {
    const k = normKey(h.title);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, h);
      continue;
    }
    removed++;
    map.set(k, {
      ...prev,
      icon: prev.icon ?? h.icon,
      cadence: prev.cadence ?? h.cadence,
      why: prev.why ?? h.why,
      preferredMoment: prev.preferredMoment ?? h.preferredMoment,
    });
  }
  return { habits: [...map.values()], removed };
}

// Dédup déterministe des mémos (par texte normalisé), on garde le plus riche.
export function dedupeNotes(
  notes: ContextNote[] | undefined,
): { notes: ContextNote[]; removed: number } {
  const list = notes ?? [];
  let removed = 0;
  const map = new Map<string, ContextNote>();
  for (const n of list) {
    const k = normKey(n.text);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, n);
      continue;
    }
    removed++;
    if (n.text.length > prev.text.length) map.set(k, { ...prev, text: n.text });
  }
  return { notes: [...map.values()], removed };
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

  // Agrégat DURABLE par semaine (le Parcours) : on ajoute les victoires du jour
  // clôturé — leur COMPTE et leurs INTITULÉS — au seau de sa semaine (lundi).
  // Le concret survit ainsi au-delà des 14 jours d'historique détaillé.
  const doneList = (log.dayPlan?.length ? log.dayPlan : log.priorities).filter(
    (i) => i.done,
  );
  const dayWins = doneList.length;
  const dayTitles = doneList.map((i) => i.title);

  // Débit du MOTEUR par cap : on attribue chaque créneau fait à son cap (via la
  // priorité liée → objectiveId). C'est l'accumulation qui grimpe entre les
  // jalons (souvent le vrai progrès d'un cap « à moteur » : candidater, prospecter).
  const capCount = new Map<string, number>();
  if (state.dayPlan?.length) {
    for (const d of state.dayPlan) {
      if (!dayItemDone(d)) continue;
      const capId =
        d.kind === "priority" && d.refId
          ? state.priorities.find((p) => p.id === d.refId)?.objectiveId
          : undefined;
      if (capId) capCount.set(capId, (capCount.get(capId) ?? 0) + 1);
    }
  } else {
    for (const p of state.priorities) {
      if (p.done && p.objectiveId)
        capCount.set(p.objectiveId, (capCount.get(p.objectiveId) ?? 0) + 1);
    }
  }
  const dayCapWins = [...capCount.entries()].map(([capId, count]) => ({ capId, count }));
  const mergeCapWins = (
    a: { capId: string; count: number }[] | undefined,
    b: { capId: string; count: number }[],
  ) => {
    const m = new Map<string, number>();
    for (const c of a ?? []) m.set(c.capId, c.count);
    for (const c of b) m.set(c.capId, (m.get(c.capId) ?? 0) + c.count);
    return [...m.entries()].map(([capId, count]) => ({ capId, count }));
  };

  let weeklyLog = state.weeklyLog;
  if (hadContent && dayWins > 0) {
    const wk = mondayIso(dayIso);
    const prev = state.weeklyLog ?? [];
    const found = prev.find((w) => w.week === wk);
    weeklyLog = found
      ? prev.map((w) => {
          if (w.week !== wk) return w;
          const cw = mergeCapWins(w.capWins, dayCapWins);
          return {
            ...w,
            wins: w.wins + dayWins,
            items: [...(w.items ?? []), ...dayTitles],
            ...(cw.length ? { capWins: cw } : {}),
          };
        })
      : [
          ...prev,
          {
            week: wk,
            wins: dayWins,
            items: dayTitles,
            ...(dayCapWins.length ? { capWins: dayCapWins } : {}),
          },
        ].sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0));
  }

  return {
    ...state,
    priorities: [],
    dayPlan: undefined,
    prioritiesDate: undefined,
    history,
    weeklyLog,
  };
}

// Le lundi (AAAA-MM-JJ, local) de la semaine d'une date ISO « AAAA-MM-JJ ».
export function mondayIso(dayIso: string): string {
  const d = new Date(`${dayIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dayIso;
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Nettoyage DÉTERMINISTE des doublons DANS chaque cap : deux flux (ou deux
// étapes) sont fusionnés si leurs mots normalisés se recouvrent — clé identique
// (« Sourcing de boîtes » = « sourcing de boites ») OU l'un est un sous-ensemble
// de mots de l'autre (« Sourcing » ⊂ « Sourcing de boîtes »). On garde le titre
// le plus riche (le plus de mots), « fait » survit par OU, les états par priorité
// au canonique. Fiable, sans IA — c'est ce que fait le bouton « Nettoyer ».
export function dedupeObjectives(objectives: Objective[]): {
  objectives: Objective[];
  removed: number;
} {
  let removed = 0;
  const wordsOf = (t: string) => new Set(normKey(t).split(" ").filter(Boolean));
  const related = (a: Set<string>, b: Set<string>) => {
    if (a.size === 0 || b.size === 0) return a.size === b.size;
    const sub = (x: Set<string>, y: Set<string>) => [...x].every((w) => y.has(w));
    return sub(a, b) || sub(b, a);
  };

  function dedupe<T extends { title: string }>(
    items: T[],
    merge: (canon: T, dup: T) => T,
  ): T[] {
    const kept: { item: T; w: Set<string> }[] = [];
    for (const it of items) {
      const w = wordsOf(it.title);
      const hit = kept.find((k) => related(k.w, w));
      if (hit) {
        removed++;
        const canonIsNew = w.size > hit.w.size;
        const canon = canonIsNew ? it : hit.item;
        const dup = canonIsNew ? hit.item : it;
        hit.item = merge(canon, dup);
        if (canonIsNew) hit.w = w;
      } else {
        kept.push({ item: it, w });
      }
    }
    return kept.map((k) => k.item);
  }

  // 1) Fusion des CAPS en double (clé EXACTE — conservateur : même titre = même
  //    cap). On garde le premier id (les priorités/journée y pointent), le titre
  //    le plus riche, l'union des flux/étapes, et les champs non vides.
  const capMap = new Map<string, Objective>();
  for (const o of objectives) {
    const k = normKey(o.title);
    const prev = capMap.get(k);
    if (!prev) {
      capMap.set(k, o);
      continue;
    }
    removed++;
    const richerTitle =
      wordsOf(o.title).size > wordsOf(prev.title).size ? o.title : prev.title;
    const moved = [prev.lastMovedAt, o.lastMovedAt].filter(Boolean).sort();
    capMap.set(k, {
      ...prev,
      ...o,
      id: prev.id,
      title: richerTitle,
      createdAt: prev.createdAt < o.createdAt ? prev.createdAt : o.createdAt,
      deadline: prev.deadline ?? o.deadline,
      target: prev.target ?? o.target,
      horizon: prev.horizon ?? o.horizon,
      unlocks: prev.unlocks ?? o.unlocks,
      icon: prev.icon ?? o.icon,
      lastMovedAt: moved.length ? moved[moved.length - 1] : undefined,
      steps: [...(prev.steps ?? []), ...(o.steps ?? [])],
      flows: [...(prev.flows ?? []), ...(o.flows ?? [])],
    });
  }

  // 2) Dédup des flux/étapes DANS chaque cap (exact + sous-ensemble de mots).
  const out = [...capMap.values()].map((o) => {
    const steps = o.steps?.length
      ? dedupe(o.steps, (canon, dup) => ({
          ...canon,
          done: canon.done || dup.done,
        }))
      : o.steps;
    const flows = o.flows?.length
      ? dedupe(o.flows, (canon, dup) => ({
          ...canon,
          state: canon.state ?? dup.state,
          waitingOn: canon.waitingOn ?? dup.waitingOn,
          fromWeek: canon.fromWeek ?? dup.fromWeek,
          toWeek: canon.toWeek ?? dup.toWeek,
          voie: canon.voie ?? dup.voie,
        }))
      : o.flows;
    return {
      ...o,
      ...(steps ? { steps } : {}),
      ...(flows ? { flows } : {}),
    };
  });

  return { objectives: out, removed };
}
