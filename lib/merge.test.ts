import { describe, expect, it } from "vitest";
import { applyReconciliation, type Reconciliation } from "./merge";
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

  it("matche un titre existant sans sensibilité à la casse", () => {
    const state = baseState([jobCap()]);
    const r: Reconciliation = {
      objectives: [{ title: "un job PRODUCT", horizon: "septembre" }],
    };
    const next = applyReconciliation(state, r);
    expect(next.objectives).toHaveLength(1);
    expect(next.objectives[0].horizon).toBe("septembre");
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

describe("applyReconciliation — live vs atterrissage", () => {
  const r: Reconciliation = {
    priorities: [{ title: "5-6 invitations", why: "haut du tuyau", objective: "Un job product" }],
    contextNotes: ["nouveau mémo"],
    understanding: "compréhension enrichie",
    note: "Cap sur le volume.",
    objectives: [{ title: "Un job product", horizon: "rentrée" }],
  };

  it("live : structure + compréhension seulement", () => {
    const state = baseState([jobCap()]);
    const next = applyReconciliation(state, r, { live: true });
    expect(next.objectives[0].horizon).toBe("rentrée");
    expect(next.understanding).toBe("compréhension enrichie");
    expect(next.priorities).toEqual(state.priorities);
    expect(next.contextNotes).toEqual(state.contextNotes);
    expect(next.lastNote).toBe("note d'hier");
  });

  it("atterrissage : priorités reliées au cap, note et mémos remplacés", () => {
    const state = baseState([jobCap()]);
    const next = applyReconciliation(state, r);
    expect(next.priorities).toHaveLength(1);
    expect(next.priorities[0].objectiveId).toBe("obj1");
    expect(next.lastNote).toBe("Cap sur le volume.");
    expect(next.contextNotes?.map((n) => n.text)).toEqual(["nouveau mémo"]);
    expect(next.prioritiesDate).toBeDefined();
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
});
