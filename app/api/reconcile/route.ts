import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, CapState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  messages: ChatMessage[];
  state: CapState;
}

function currentStateSummary(state: CapState): string {
  const ctx = state.contextNotes?.length
    ? `\n\nContexte en mémoire :\n${state.contextNotes.map((n) => `- ${n.text}`).join("\n")}`
    : "";
  const caps = state.objectives.length
    ? state.objectives
        .map((o) => {
          const bits = [
            o.deadline ? `échéance ${o.deadline.slice(0, 10)}` : "pas d'échéance",
            o.target ? `cible : ${o.target}` : null,
            o.horizon ? `horizon : ${o.horizon}` : null,
            o.unlocks ? `ouvre : ${o.unlocks}` : null,
          ].filter(Boolean);
          const steps = o.steps?.length
            ? "\n    étapes : " +
              o.steps.map((s) => `${s.done ? "[x]" : "[ ]"} ${s.title}`).join(" → ")
            : "";
          const flows = o.flows?.length
            ? "\n    flux : " +
              o.flows
                .map(
                  (f) =>
                    `${f.title} (${f.waitingOn ? `en attente : ${f.waitingOn}` : f.state ?? "actif"})`,
                )
                .join(", ")
            : "";
          return `- ${o.title} (${bits.join(" · ")})${steps}${flows}`;
        })
        .join("\n")
    : "(aucun)";
  return `Compréhension actuelle : ${state.understanding || "(vide)"}\n\nCaps actuels :\n${caps}${ctx}`;
}

const INSTRUCTION = `Tu es le module de réconciliation de Cap. À partir de la conversation qui vient d'avoir lieu, tu mets à jour l'état de la personne en appelant l'outil "enregistrer". Tu ne parles pas à la personne.

Règles :
- 1 à 3 priorités maximum. Si la personne est en petite forme, une seule suffit. Chaque priorité doit être concrète (on saura ce soir si c'est fait) et, si possible, reliée à un cap existant via son titre EXACT.
- N'invente pas de caps ni d'échéances qui n'ont pas été évoqués. Ne remplis "objectives" que pour les caps réellement créés/précisés pendant la conversation.
- CRUCIAL pour mettre à jour un cap EXISTANT (et NE PAS créer de doublon) : reprends son titre EXACT, mot pour mot, tel qu'il apparaît dans « Caps actuels » ci-dessus. Ne le raccourcis ni ne le reformule jamais.
- N'INVENTE PAS l'état d'un flux. Ne le marque « en attente » que si l'action est réellement bloquée (voir waitingOn). Ne suppose pas un contact déjà pris (« relance ») si ce n'est pas dit : si la personne n'a jamais écrit, c'est un « premier message », pas une relance. Ne multiplie pas les flux qui se recouvrent : un flux clair vaut mieux que trois étiquettes bancales.
- target + horizon sont PRIORITAIRES (ils permettent de situer l'écart et de calibrer). Capture-les dès que la conversation les rend disponibles. N'invente pas de chiffres non dits, mais ne les laisse pas vides par paresse.
- Ne renseigne un champ QUE si la conversation te l'a réellement appris. Ne devine jamais. Mieux vaut vide que faux.
- UN CAP ≠ UNE ACTION : un cap ne se justifie QUE si c'est un projet qui s'étale sur plusieurs semaines avec des phases distinctes (étapes + flux). Une action isolée (un email à envoyer, une réunion, un truc ponctuel comme « Hubvisory ») = PRIORITÉ seulement, jamais un cap. Si tu crées un cap de ce genre, tu génères du bruit dans la carte.
- DISTINGUE les 3 natures : ÉTAPE (steps) = un JALON, un état qu'on peut dire « atteint » ou « pas encore » (« CV retravaillé », « Premiers entretiens obtenus », « Offre signée »). PAS un comportement, PAS une performance, PAS quelque chose qui se gère dans le calendrier. « Transformer les entretiens en offres » n'est pas un jalon — c'est une qualité d'exécution qui appartient au calendrier (préparer chaque entretien). FLUX (flows) = continu, jamais fini (« sourcing », « outreach »). Ne confonds pas (« lister/contacter » est un FLUX, pas une étape). Ne suppose jamais un flux « terminé ». Quand un GOULOT de fond émerge (ex. un CV à retravailler qui conditionne la conversion), fais-le entrer comme une étape. CE QUI EST DANS LE CALENDRIER N'APPARTIENT PAS À LA CARTE : si quelque chose se gère dans l'agenda de la personne ou se produit naturellement dans le cours du projet, ne le modélise pas.
- RENOMMER UN CAP : si la conversation aboutit à un renommage, utilise "previousTitle" = le titre EXACT tel qu'il apparaît dans « Caps actuels » + "title" = le nouveau nom. Ne crée JAMAIS un cap supplémentaire pour un renommage — sinon tu génères un doublon.
- CONSOLIDE AVANT DE CRÉER : avant d'ajouter un flux ou une étape, vérifie s'il en existe déjà un qui couvre la même activité (même sens, titre légèrement différent — « Invitations LinkedIn » et « invitations LinkedIn (semer) » sont la même chose). Si oui, utilise le titre EXACT existant et enrichis-le plutôt que d'en créer un nouveau. Tu es responsable de la propreté de la carte que tu construis — les doublons sont ta faute, pas celle de la personne.
- LOGIQUE ≠ AUJOURD'HUI : une quantité datée (« 8-10 boîtes ») est une TRANCHE d'un flux → elle va dans "priorities" (avec "via"), JAMAIS dans steps/flows.
- steps : liste ORDONNÉE COMPLÈTE (3-5), "done" pour les franchies. Pas de dates ni de durées.
- PHASAGE EN SEMAINES (fromWeek/toWeek) : quand la conversation évoque le « quand » (« le CV cette semaine et la prochaine, les candidatures ensuite »), place les chantiers sur la frise en offsets de semaines depuis cette semaine (0 = cette semaine). Estimations LARGES, jamais des dates. Ne l'invente pas si le phasage n'a pas été abordé.
- VOIES : si un cap a plusieurs ROUTES distinctes vers le même but (ex. « job » vs « freelance » pour « un revenu qui nourrit les apps »), étiquette chaque chantier avec sa "voie". Sinon, omets.
- "understanding" : ne perds pas ce qui était su, enrichis-le (2-5 phrases). DISTINGUE le DÉCIDÉ/PRÉVU du FAIT (écris « prévoit d'amorcer », pas « a amorcé »). Quand la personne rapporte ce qu'elle a RÉELLEMENT fait (volumes, résultats), consigne-le : c'est son track record. Note aussi sa PENTE si elle se manifeste (préfère prendre du contexte / poser sa carte, vs foncer direct aux tâches) — ça sert à calibrer le bon niveau de questions la fois suivante.
- "note" : une phrase, jamais culpabilisante, tournée vers la décision prise.
- "contextNotes" : liste COMPLÈTE des mémos à garder (textes courts, pas des caps). Remplace la liste entière : garde ce qui reste pertinent, ajoute ce qui vient d'émerger, omets ce qui est résolu ou intégré ailleurs. Types de choses qui vont ici : tâche ponctuelle (« Hubvisory — un échange à explorer »), info en attente (« X répond en fin de semaine »), contrainte temporaire, idée à creuser plus tard.`;

const RECONCILE_TOOL: Anthropic.Tool = {
  name: "enregistrer",
  description:
    "Enregistre la mise à jour de l'état de la personne après la session (priorités du jour, caps, compréhension, note).",
  input_schema: {
    type: "object",
    properties: {
      priorities: {
        type: "array",
        description: "1 à 3 priorités du jour.",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "le pas concret et quantifié du jour (ex. « 5-6 invitations »)",
            },
            why: { type: "string", description: "pourquoi elle passe devant aujourd'hui" },
            objective: {
              type: "string",
              description: "titre EXACT du cap qu'elle fait avancer, ou omis",
            },
            via: {
              type: "string",
              description: "le flux ou l'étape que cette tranche alimente (ex. « sourcing »)",
            },
          },
          required: ["title"],
        },
      },
      objectives: {
        type: "array",
        description: "Caps créés ou précisés pendant la conversation uniquement.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            previousTitle: {
              type: "string",
              description: "Titre EXACT du cap à renommer (tel qu'il apparaît dans « Caps actuels »). Fournis ce champ + le nouveau title pour renommer sans créer de doublon.",
            },
            icon: {
              type: "string",
              description:
                "UN emoji simple qui représente le cap (ex. 💼 job, 🚀 app). Pose-le dès la création d'un cap.",
            },
            deadline: {
              type: ["string", "null"],
              description: "YYYY-MM-DD si échéance DURE, sinon null",
            },
            target: {
              type: "string",
              description: "définition chiffrée de « réussi » (ex. « 3-4 entretiens »)",
            },
            horizon: {
              type: "string",
              description: "échéance visée même souple (ex. « dans le mois »)",
            },
            unlocks: { type: "string", description: "la récompense au bout" },
            moved: {
              type: "boolean",
              description: "true si le cap a concrètement avancé pendant la conversation",
            },
            steps: {
              type: "array",
              description: "① étapes séquentielles, DANS L'ORDRE (3-5 max)",
              items: {
                type: "object",
                properties: {
                  title: {
                    type: "string",
                    description:
                      "titre COURT, 2-5 mots, lisible d'un coup d'œil (ex. « Retravailler le CV », « Premiers entretiens ») — JAMAIS une phrase ; le détail va dans understanding",
                  },
                  done: { type: "boolean" },
                  fromWeek: {
                    type: "number",
                    description:
                      "semaine de DÉBUT en offset depuis CETTE semaine (0 = cette semaine, 1 = la prochaine…). Estimation LARGE, jamais une date. Renseigne dès que le phasage a été évoqué.",
                  },
                  toWeek: {
                    type: "number",
                    description: "semaine de FIN incluse (même offset). Si le chantier est bref, = fromWeek.",
                  },
                  voie: {
                    type: "string",
                    description:
                      "la branche à laquelle ce chantier appartient quand un cap a plusieurs routes (ex. « job », « freelance »). Omets si le cap est mono-voie.",
                  },
                },
                required: ["title"],
              },
            },
            flows: {
              type: "array",
              description: "② flux continus. LISTE COMPLÈTE : les flux non listés seront SUPPRIMÉS. Si la conversation a abouti à une simplification (ex. 4 flux au lieu de 13), ne liste que les 4 propres — c'est ainsi que tu nettoies.",
              items: {
                type: "object",
                properties: {
                  title: {
                    type: "string",
                    description: "titre COURT, 2-4 mots (ex. « Sourcing de boîtes », « Relances ») — jamais une phrase",
                  },
                  state: { type: "string", enum: ["actif", "ralenti", "pause"] },
                  fromWeek: {
                    type: "number",
                    description: "semaine de début (offset depuis cette semaine, 0 = cette semaine) où tu pousses ce flux — estimation large",
                  },
                  toWeek: {
                    type: "number",
                    description: "semaine de fin incluse de la période où tu pousses ce flux",
                  },
                  voie: {
                    type: "string",
                    description: "la branche (« job », « freelance »…) si le cap a plusieurs routes",
                  },
                  waitingOn: {
                    type: ["string", "null"],
                    description:
                      "UNIQUEMENT si l'ACTION elle-même est bloquée (ex. « le pote est indispo »). ATTENTION : un flux qu'on PEUT faire maintenant mais dont les FRUITS mûrissent plus tard (envoyer des invitations → les gens acceptent après) est ACTIF, PAS en attente. N'utilise ce champ que si on ne peut pas agir ; sinon null.",
                  },
                },
                required: ["title"],
              },
            },
          },
          required: ["title"],
        },
      },
      contextNotes: {
        type: "array",
        description:
          "Liste COMPLÈTE des mémos à mémoriser : infos ponctuelles qui ne méritent pas un cap (tâches isolées, idées, trucs en attente, contexte utile). Remplace la liste entière à chaque fois.",
        items: { type: "string" },
      },
      understanding: {
        type: "string",
        description: "compréhension mise à jour de la personne (2-5 phrases denses)",
      },
      note: {
        type: "string",
        description: "une phrase élégante résumant ce qui a changé aujourd'hui",
      },
    },
  },
};

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Clé API manquante." }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }

  const { messages = [], state } = body;

  const transcript = messages
    .map((m) => `${m.role === "user" ? "MOI" : "CAP"} : ${m.content}`)
    .join("\n\n");

  const client = new Anthropic({ apiKey });

  try {
    const res = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: INSTRUCTION,
      tools: [RECONCILE_TOOL],
      tool_choice: { type: "tool", name: "enregistrer" },
      messages: [
        {
          role: "user",
          content: `${currentStateSummary(state)}\n\n=== CONVERSATION ===\n${transcript}\n\n=== FIN ===\n\nEnregistre la réconciliation.`,
        },
      ],
    });

    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new Error("Pas de sortie structurée renvoyée.");
    }
    // `input` est un JSON déjà validé par l'API — plus de JSON.parse fragile.
    return Response.json(block.input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur de réconciliation.";
    return Response.json({ error: msg }, { status: 500 });
  }
}
