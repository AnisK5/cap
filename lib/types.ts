// Cap — modèle de données.
// L'unité n'est pas la tâche : c'est le CAP (où tu vas) et l'ARBITRAGE (ce que
// tu choisis d'en faire aujourd'hui). L'exécution vit ailleurs (calendrier +
// chronos) ; ici on élimine le doute, on décide, on projette.
//
// UN CAP SE DÉCOMPOSE EN 3 NATURES DE CHOSES (distinction : continu vs séquentiel) :
//   ① Étape (Step)  — se franchit UNE fois, dans l'ordre. « fait/pas fait » a du
//                     sens. C'est le squelette (le diagramme).
//   ② Flux (Flow)   — activité CONTINUE, un débit, jamais « fini ». « à quel
//                     rythme ? » a du sens. État : actif / ralenti / pause.
//   ③ Attente       — dépendance binaire : dispo maintenant vs en attente de X.
//                     Modélisée comme un état sur un flux (`waitingOn`).
//
// Règle : LOGIQUE ≠ AUJOURD'HUI. La logique (étapes/flux/attentes/récompense)
// est intemporelle. Une quantité datée (« 8-10 boîtes ») est une TRANCHE d'un
// flux, elle vit dans les priorités du jour, jamais dans la logique.

// Placement temporel GROSSIER sur la frise : en semaines, en offset depuis
// CETTE semaine (0 = cette semaine, 1 = la semaine prochaine…). Jamais de dates
// exactes — c'est une intention de focus, pas un engagement. `voie` regroupe les
// chantiers d'une même branche (ex. « job » vs « freelance »).
export interface Timed {
  fromWeek?: number; // début (offset semaines depuis cette semaine)
  toWeek?: number; // fin incluse
  voie?: string; // la branche à laquelle ce chantier appartient
}

// ① Une étape séquentielle : franchie une fois, puis on passe à la suivante.
export interface Step extends Timed {
  id: string;
  title: string;
  done?: boolean;
}

// ② Un flux : une activité continue qui produit un débit (sourcing, outreach…).
// Ne se « termine » pas — elle a un rythme/état. `waitingOn` = ce qu'elle attend
// pour être actionnable (③ l'attente) ; absent = dispo/active maintenant.
export type FlowState = "actif" | "ralenti" | "pause";

export interface Flow extends Timed {
  id: string;
  title: string;
  state?: FlowState;
  waitingOn?: string;
}

// Un cap : une direction vers laquelle tu avances. Il porte l'enjeu.
// - deadline présente  → échéance externe dure : l'ETA porte l'enjeu.
// - deadline absente   → projet « mou » : c'est la récompense (`unlocks`) qui
//                        porte l'enjeu (ce que ça t'ouvre).
// steps + flows sont maintenus par l'IA depuis la conversation ; corrigeables.
export interface Objective {
  id: string;
  title: string;
  icon?: string; // un emoji qui représente le cap (choisi par l'IA), pour la lisibilité
  deadline?: string | null; // ISO date dure, ou null/absent = mou
  target?: string; // définition CHIFFRÉE de « réussi » (ex. « job signé », « ~30 candidatures + entretiens en cours »)
  horizon?: string; // l'échéance VISÉE même souple (ex. « rentrée / septembre ») — permet le back-calcul du rythme
  unlocks?: string; // la récompense : ce que ce cap débloque (le bout du chemin)
  steps?: Step[]; // ① le squelette séquentiel, dans l'ordre
  flows?: Flow[]; // ② les activités continues qui te poussent le long du squelette
  lastMovedAt?: string; // ISO : dernière fois que le cap a bougé (→ momentum)
  createdAt: string;
}

// Une priorité du jour : un arbitrage explicite. Ce que tu fais AUJOURD'HUI,
// pourquoi c'est prioritaire, vers quel cap, et — si pertinent — quelle TRANCHE
// de quel flux/étape elle représente (le lien entre aujourd'hui et la logique).
export interface Priority {
  id: string;
  title: string; // le pas concret et quantifié du jour (ex. « 8-10 boîtes »)
  why: string; // pourquoi elle passe devant aujourd'hui
  objectiveId?: string; // le cap qu'elle fait avancer
  via?: string; // le flux/étape qu'elle alimente (ex. « sourcing »)
  done?: boolean; // cochée par la personne → track record fiable
}

export type Role = "assistant" | "user";

export interface ChatMessage {
  role: Role;
  content: string;
}

// Une note de contexte : info mémo capturée par l'IA, qui ne mérite pas d'être
// un cap mais vaut la peine d'être retenue (tâche ponctuelle, truc en attente,
// idée, contexte utile). Affichée en toggle dans Aujourd'hui.
export interface ContextNote {
  id: string;
  text: string;
}

// L'état complet, persistant. `understanding` = ce que l'assistant a compris de
// toi (objectifs, contraintes, décisions passées) — le moat, mis à jour à
// chaque fin de session. `lastNote` = la phrase élégante « voilà ce qui a
// changé » montrée sur l'accueil.
export interface CapState {
  objectives: Objective[];
  priorities: Priority[];
  prioritiesDate?: string; // jour (ISO) pour lequel les priorités valent
  understanding: string;
  lastNote?: string;
  name?: string;
  contextNotes?: ContextNote[]; // mémos libres, pas des caps
}

export const EMPTY_STATE: CapState = {
  objectives: [],
  priorities: [],
  understanding: "",
};
