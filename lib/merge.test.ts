import { describe, expect, it } from "vitest";
import {
  applyReconciliation,
  dedupeObjectives,
  rollDay,
  type Reconciliation,
} from "./merge";
import type { CapState, Objective } from "./types";

function baseState(objectives: Objective[] = []): CapState {
  return {
    objectives,
    priorities: [
      { id: "p1", title: "ancienne prio", why: "hier" },
    ],
    understanding: "compréhension initiale",
    lastNote: "note d'hier",
    contextNotes: [{ id: "n1", text: "mémo existant" }],
  };
}

function jobCap(): Objective {
  return {
    id: "obj1",
    title: "Un job product",
    deadline: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    target: "3-4 entretiens/mois",
    steps: [
      { id: "s1", title: "Retravailler le CV", done: true },
      { id: "s2", title: "Premiers entretiens", done: false },
    ],
    flows: [
      { id: "f1", title: "Sourcing de boîtes", state: "actif" },
      { id: "f2", title: "Relances", state: "ralenti", waitingOn: "réponses" },
    ],
  };
}

describe("applyReconciliation — caps", () => {
  it("renomme via previousTitle sans créer de doublon", () => {
    const state = baseState([jobCap()]);
    const r: Reconciliation = {
      objectives: [{ title: "Job product senior", previousTitle: "Un job product" }],
    };
    const next = applyReconciliation(state, r);
    expect(next.objectives).toHaveLength(1);
    expect(next.objectives[0].id).toBe("obj1");
    expect(next.objectives[0].title).toBe("Job product senior");
  });

  it("capture le compteur (metric) + un relevé cumulé daté (progress)", () => {
    const state = baseState([jobCap()]);
    const next = applyReconciliation(state, {
      objectives: [
        { title: "Un job product", metric: { label: "candidatures", target: 30 }, progressTotal: 18 },
      ],
    });
    const o = next.objectives[0];
    expect(o.metric).toEqual({ label: "candidatures", target: 30 });
    expect(o.progress).toHaveLength(1);
    expect(o.progress![0].total).toBe(18);
    // Un nouveau cumul plus tard = un 2e relevé (pas d'écrasement si autre valeur).
    const after = applyReconciliation(next, {
      objectives: [{ title: "Un job product", progressTotal: 30 }],
    });
    const p = after.objectives[0].progress!;
    // même jour → le relevé du jour est remplacé (un point/jour), donc la valeur monte.
    expect(p[p.length - 1].total).toBe(30);
    // même total re-proposé = pas de doublon.
    const same = applyReconciliation(after, {
      objectives: [{ title: "Un job product", progressTotal: 30 }],
    });
    expect(same.objectives[0].progress).toEqual(after.objectives[0].progress);
  });

  it("matche un titre existant sans sensibilité à la casse", () => {
    const state = baseState([jobCap()]);
    const r: Reconciliation = {
      objectives: [{ title: "un job PRODUCT", horizon: "septembre" }],
    };
    const next = applyReconciliation(state, r);
    expect(next.objectives).toHaveLength(1);
    expect(next.objectives[0].horizon).toBe("septembre");
  });

  it("ne crée pas de doublon sur une variante de casse/accent/ponctuation", () => {
    const state = baseState([jobCap()]);
    // « un job PRODUCT ! » doit matcher « Un job product » (pas un doublon)
    const next = applyReconciliation(state, {
      objectives: [{ title: "un job PRODUCT !", horizon: "septembre" }],
    });
    expect(next.objectives).toHaveLength(1);
    expect(next.objectives[0].id).toBe("obj1");
    expect(next.objectives[0].horizon).toBe("septembre");
  });

  it("fusionne un flux quasi-identique au lieu de le dupliquer", () => {
    const state = baseState([jobCap()]);
    const next = applyReconciliation(state, {
      objectives: [
        {
          title: "Un job product",
          flows: [{ title: "sourcing de boites" }, { title: "Relances" }],
        },
      ],
    });
    const flows = next.objectives[0].flows!;
    expect(flows).toHaveLength(2);
    // « sourcing de boites » a retrouvé l'id de « Sourcing de boîtes »
    expect(flows.find((f) => f.id === "f1")).toBeTruthy();
  });

  it("crée un nouveau cap avec ses étapes et flux", () => {
    const state = baseState([]);
    const r: Reconciliation = {
      objectives: [
        {
          title: "App Cap v1",
          icon: "🚀",
          steps: [{ title: "MVP buildé", done: true }, { title: "Premiers testeurs" }],
          flows: [{ title: "Itérations produit", state: "actif" }],
        },
      ],
    };
    const next = applyReconciliation(state, r);
    expect(next.objectives).toHaveLength(1);
    const o = next.objectives[0];
    expect(o.icon).toBe("🚀");
    expect(o.steps?.map((s) => s.done)).toEqual([true, false]);
    expect(o.flows?.[0].title).toBe("Itérations produit");
  });
});

describe("applyReconciliation — steps & flows", () => {
  it("la liste de flux proposée REMPLACE l'existante (c'est le nettoyage)", () => {
    const state = baseState([jobCap()]);
    const r: Reconciliation = {
      objectives: [
        { title: "Un job product", flows: [{ title: "Sourcing de boîtes" }] },
      ],
    };
    const next = applyReconciliation(state, r);
    const flows = next.objectives[0].flows!;
    expect(flows).toHaveLength(1);
    expect(flows[0].id).toBe("f1"); // id préservé par match de titre
    expect(flows[0].state).toBe("actif"); // état préservé si non re-précisé
  });

  it("un cap dont les flux ne sont PAS mentionnés garde les siens", () => {
    const state = baseState([jobCap()]);
    const r: Reconciliation = {
      objectives: [{ title: "Un job product", target: "2 offres" }],
    };
    const next = applyReconciliation(state, r);
    expect(next.objectives[0].flows).toHaveLength(2);
    expect(next.objectives[0].target).toBe("2 offres");
  });

  it("préserve done et id des étapes par match de titre", () => {
    const state = baseState([jobCap()]);
    const r: Reconciliation = {
      objectives: [
        {
          title: "Un job product",
          steps: [
            { title: "retravailler le cv" }, // sans done : reporté depuis l'existant
            { title: "Premiers entretiens" },
            { title: "Offre signée" },
          ],
        },
      ],
    };
    const next = applyReconciliation(state, r);
    const steps = next.objectives[0].steps!;
    expect(steps).toHaveLength(3);
    expect(steps[0].id).toBe("s1");
    expect(steps[0].done).toBe(true);
    expect(steps[2].done).toBe(false);
  });

  it("waitingOn: null libère le flux, absent le préserve", () => {
    const state = baseState([jobCap()]);
    const cleared = applyReconciliation(state, {
      objectives: [
        {
          title: "Un job product",
          flows: [{ title: "Relances", waitingOn: null }, { title: "Sourcing de boîtes" }],
        },
      ],
    });
    expect(cleared.objectives[0].flows![0].waitingOn).toBeUndefined();

    const kept = applyReconciliation(state, {
      objectives: [
        {
          title: "Un job product",
          flows: [{ title: "Relances" }, { title: "Sourcing de boîtes" }],
        },
      ],
    });
    expect(kept.objectives[0].flows![0].waitingOn).toBe("réponses");
  });
});

describe("applyReconciliation — passe unique (tout en direct)", () => {
  const r: Reconciliation = {
    priorities: [{ title: "5-6 invitations", why: "haut du tuyau", objective: "Un job product" }],
    contextNotes: ["nouveau mémo"],
    understanding: "compréhension enrichie",
    note: "Cap sur le volume.",
    objectives: [{ title: "Un job product", horizon: "rentrée" }],
  };

  it("commit tout en une passe : structure + priorités reliées + note + mémos", () => {
    const state = baseState([jobCap()]);
    const next = applyReconciliation(state, r);
    expect(next.objectives[0].horizon).toBe("rentrée");
    expect(next.understanding).toBe("compréhension enrichie");
    expect(next.priorities).toHaveLength(1);
    expect(next.priorities[0].objectiveId).toBe("obj1");
    expect(next.lastNote).toBe("Cap sur le volume.");
    expect(next.contextNotes?.map((n) => n.text)).toEqual(["nouveau mémo"]);
    expect(next.prioritiesDate).toBeDefined();
  });

  it("les champs non fournis sont conservés (carry-forward)", () => {
    const state = baseState([jobCap()]);
    const next = applyReconciliation(state, { understanding: "x" });
    expect(next.priorities).toEqual(state.priorities);
    expect(next.contextNotes).toEqual(state.contextNotes);
    expect(next.lastNote).toBe("note d'hier");
  });

  it("limite à 3 priorités", () => {
    const state = baseState([]);
    const next = applyReconciliation(state, {
      priorities: [1, 2, 3, 4, 5].map((i) => ({ title: `p${i}`, why: "" })),
    });
    expect(next.priorities).toHaveLength(3);
  });

  it("une compréhension vide ne détruit pas l'existante", () => {
    const state = baseState([]);
    const next = applyReconciliation(state, { understanding: "  " });
    expect(next.understanding).toBe("compréhension initiale");
  });

  it("des priorités vides ne détruisent pas les existantes", () => {
    const state = baseState([]);
    const next = applyReconciliation(state, { priorities: [] });
    expect(next.priorities).toEqual(state.priorities);
    expect(next.prioritiesDate).toBe(state.prioritiesDate);
  });
});

describe("applyReconciliation — habitudes & journée", () => {
  const withHabit = (): CapState => ({
    ...baseState([jobCap()]),
    habits: [{ id: "h1", title: "Sport", cadence: "tous les 2 jours" }],
  });

  it("fusionne les habitudes par titre (id et champs préservés)", () => {
    const next = applyReconciliation(withHabit(), {
      habits: [
        { title: "sport", preferredMoment: "matin" },
        { title: "Écriture", cadence: "chaque soir" },
      ],
    });
    expect(next.habits).toHaveLength(2);
    expect(next.habits![0].id).toBe("h1");
    expect(next.habits![0].cadence).toBe("tous les 2 jours");
    expect(next.habits![0].preferredMoment).toBe("matin");
  });

  it("pas d'habits fourni = habitudes intactes", () => {
    const untouched = applyReconciliation(withHabit(), { understanding: "x" });
    expect(untouched.habits).toHaveLength(1);
  });

  it("la journée relie priorités et habitudes par titre", () => {
    const r: Reconciliation = {
      priorities: [{ title: "8-10 invitations", why: "volume", objective: "Un job product" }],
      dayPlan: [
        { title: "Sport", kind: "habit", habit: "Sport", dueBy: "avant midi" },
        { title: "8-10 invitations", kind: "priority", priority: "8-10 invitations", dueBy: "avant 16h", why: "chaque jour décale ton 1er entretien" },
        { title: "Réunion X", kind: "fixed", dueBy: "14h" },
      ],
    };
    const next = applyReconciliation(withHabit(), r);
    expect(next.dayPlan).toHaveLength(3);
    expect(next.dayPlan![0].refId).toBe("h1");
    expect(next.dayPlan![1].refId).toBe(next.priorities[0].id);
    expect(next.dayPlan![2].refId).toBeUndefined();
    expect(next.dayPlan![1].why).toContain("entretien");
  });

  it("dayPlan non fourni = conservé, même quand de nouvelles priorités arrivent", () => {
    const state: CapState = {
      ...withHabit(),
      dayPlan: [{ id: "d1", kind: "fixed", title: "vieux créneau" }],
    };
    const kept = applyReconciliation(state, { understanding: "x" });
    expect(kept.dayPlan).toHaveLength(1);
    // En modèle continu, de nouvelles priorités sans dayPlan ne l'effacent PLUS.
    const stillKept = applyReconciliation(state, {
      priorities: [{ title: "nouvelle prio", why: "" }],
    });
    expect(stillKept.dayPlan).toHaveLength(1);
  });
});

// Régression : le chat re-propose souvent les mêmes priorités/journée à chaque
// tour. Ces re-propositions ne doivent JAMAIS effacer ce que tu as coché (« ça
// revient en arrière / on oublie les choses faites ») ni casser les refId.
describe("applyReconciliation — le done survit à une re-proposition du chat", () => {
  it("une priorité cochée garde son done ET son id quand le chat la re-propose", () => {
    const state: CapState = {
      ...baseState([jobCap()]),
      priorities: [
        { id: "p42", title: "8-10 invitations", why: "volume", done: true },
      ],
    };
    const next = applyReconciliation(state, {
      priorities: [
        { title: "8-10 invitations", why: "volume", objective: "Un job product" },
      ],
    });
    expect(next.priorities[0].id).toBe("p42"); // id stable → refId du dayPlan tient
    expect(next.priorities[0].done).toBe(true); // le ✓ survit
  });

  it("un créneau habit/fixed coché garde son done quand la journée est re-posée", () => {
    const state: CapState = {
      ...baseState([jobCap()]),
      habits: [{ id: "h1", title: "Sport", cadence: "tous les 2 jours" }],
      dayPlan: [
        { id: "d1", kind: "habit", refId: "h1", title: "Sport", done: true },
        { id: "d2", kind: "fixed", title: "Douche", done: true },
      ],
    };
    const next = applyReconciliation(state, {
      dayPlan: [
        { title: "Sport", kind: "habit", habit: "Sport" },
        { title: "Douche", kind: "fixed" },
      ],
    });
    expect(next.dayPlan![0].done).toBe(true);
    expect(next.dayPlan![1].done).toBe(true);
  });
});

describe("dedupeObjectives — nettoyage déterministe des doublons", () => {
  it("fusionne un flux dont les mots sont un sous-ensemble d'un autre", () => {
    const o: Objective = {
      id: "o1",
      title: "Job",
      deadline: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      flows: [
        { id: "f1", title: "Sourcing", state: "actif" },
        { id: "f2", title: "Sourcing de boîtes", state: "ralenti" },
        { id: "f3", title: "Relances", waitingOn: "réponses" },
      ],
    };
    const { objectives, removed } = dedupeObjectives([o]);
    expect(removed).toBe(1);
    const flows = objectives[0].flows!;
    expect(flows).toHaveLength(2);
    // le titre le plus riche est gardé
    expect(flows.find((f) => f.title === "Sourcing de boîtes")).toBeTruthy();
    expect(flows.find((f) => f.title === "Sourcing")).toBeFalsy();
    expect(flows.find((f) => f.title === "Relances")).toBeTruthy();
  });

  it("fusionne deux étapes quasi-identiques, « fait » survit par OU", () => {
    const o: Objective = {
      id: "o1",
      title: "Job",
      deadline: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      steps: [
        { id: "s1", title: "Retravailler le CV", done: true },
        { id: "s2", title: "retravailler le cv !", done: false },
      ],
    };
    const { objectives, removed } = dedupeObjectives([o]);
    expect(removed).toBe(1);
    expect(objectives[0].steps).toHaveLength(1);
    expect(objectives[0].steps![0].done).toBe(true);
  });

  it("fusionne deux CAPS de même titre (union flux/étapes, id du premier gardé)", () => {
    const a: Objective = {
      id: "cap-a",
      title: "Écart",
      deadline: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      target: "10 testeurs",
      flows: [{ id: "f1", title: "Diffusion" }],
    };
    const b: Objective = {
      id: "cap-b",
      title: "écart",
      deadline: null,
      createdAt: "2026-07-05T00:00:00.000Z",
      horizon: "septembre",
      flows: [{ id: "f2", title: "Retours testeurs" }],
    };
    const { objectives, removed } = dedupeObjectives([a, b]);
    expect(removed).toBe(1);
    expect(objectives).toHaveLength(1);
    const cap = objectives[0];
    expect(cap.id).toBe("cap-a"); // id du premier préservé
    expect(cap.target).toBe("10 testeurs"); // champs non vides fusionnés
    expect(cap.horizon).toBe("septembre");
    expect(cap.flows).toHaveLength(2); // union des flux
  });

  it("ne touche pas des flux réellement distincts", () => {
    const o: Objective = {
      id: "o1",
      title: "Job",
      deadline: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      flows: [
        { id: "f1", title: "Sourcing" },
        { id: "f2", title: "Entretiens" },
      ],
    };
    const { removed } = dedupeObjectives([o]);
    expect(removed).toBe(0);
  });
});

describe("rollDay — passage à un nouveau jour", () => {
  const dayState = (): CapState => ({
    ...baseState([jobCap()]),
    habits: [{ id: "h1", title: "Sport" }],
    priorities: [
      { id: "p1", title: "8-10 invitations", why: "volume", done: true },
      { id: "p2", title: "relire CV", why: "" },
    ],
    dayPlan: [
      { id: "d1", kind: "priority", refId: "p1", title: "8-10 invitations" },
      { id: "d2", kind: "habit", refId: "h1", title: "Sport", done: true },
    ],
    prioritiesDate: "2026-07-21T09:00:00.000Z",
  });

  it("archive la journée écoulée puis remet à zéro", () => {
    const next = rollDay(dayState(), "2026-07-21");
    expect(next.priorities).toEqual([]);
    expect(next.dayPlan).toBeUndefined();
    expect(next.prioritiesDate).toBeUndefined();
    expect(next.objectives).toHaveLength(1); // structure préservée
    expect(next.habits).toHaveLength(1);

    expect(next.history).toHaveLength(1);
    const log = next.history![0];
    expect(log.day).toBe("2026-07-21");
    expect(log.priorities).toEqual([
      { title: "8-10 invitations", done: true },
      { title: "relire CV", done: false },
    ]);
    // done du dayPlan : la priorité via SA priorité (p1 cochée), l'habitude via l'item
    expect(log.dayPlan).toEqual([
      { title: "8-10 invitations", done: true },
      { title: "Sport", done: true },
    ]);
  });

  it("un jour vide n'ajoute pas d'entrée d'historique", () => {
    const empty: CapState = { ...baseState([]), priorities: [], dayPlan: undefined };
    const next = rollDay(empty, "2026-07-21");
    expect(next.history).toBeUndefined();
  });

  it("agrège les victoires du jour dans le weeklyLog durable (par lundi)", () => {
    // 2026-07-21 = mardi → lundi 2026-07-20. 2 victoires (p1 + Sport), avec intitulés.
    const day1 = rollDay(dayState(), "2026-07-21");
    expect(day1.weeklyLog).toEqual([
      { week: "2026-07-20", wins: 2, items: ["8-10 invitations", "Sport"] },
    ]);
    // Un autre jour de la MÊME semaine s'ajoute au même seau (compte + intitulés).
    const day2 = rollDay({ ...dayState(), weeklyLog: day1.weeklyLog }, "2026-07-22");
    expect(day2.weeklyLog).toEqual([
      {
        week: "2026-07-20",
        wins: 4,
        items: ["8-10 invitations", "Sport", "8-10 invitations", "Sport"],
      },
    ]);
    // Un jour de la semaine suivante ouvre un nouveau seau (survit au-delà de 14 j).
    const day3 = rollDay({ ...dayState(), weeklyLog: day2.weeklyLog }, "2026-07-28");
    expect(day3.weeklyLog).toHaveLength(2);
    expect(day3.weeklyLog![1]).toEqual({
      week: "2026-07-27",
      wins: 2,
      items: ["8-10 invitations", "Sport"],
    });
  });

  it("attribue le débit du moteur au cap (capWins) via la priorité liée", () => {
    const state: CapState = {
      ...baseState([jobCap()]),
      priorities: [
        { id: "p1", title: "8-10 invitations", why: "", done: true, objectiveId: "obj1" },
      ],
      dayPlan: [
        { id: "d1", kind: "priority", refId: "p1", title: "8-10 invitations" },
      ],
    };
    const next = rollDay(state, "2026-07-21");
    expect(next.weeklyLog).toEqual([
      {
        week: "2026-07-20",
        wins: 1,
        items: ["8-10 invitations"],
        capWins: [{ capId: "obj1", count: 1 }],
      },
    ]);
  });
});
