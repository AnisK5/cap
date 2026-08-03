import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/auth";
import { getState, saveSessionMessages } from "@/lib/db";
import { CHAT_MODEL } from "@/lib/model";
import { chatSystemPrompt, OPENING_CUE, RESUME_CUE } from "@/lib/prompts";
import { EMPTY_STATE, type ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  sessionId: string;
  messages: ChatMessage[]; // la conversation affichée, sans la réponse à venir
  resume?: boolean; // reprise après une pause → check-in gap-aware
  sinceMin?: number; // minutes depuis le dernier échange (pour la reprise)
  timeZone?: string; // fuseau IANA du client (le serveur vit en UTC)
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Clé API manquante (ANTHROPIC_API_KEY)." },
      { status: 500 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }
  const { sessionId, messages = [], resume, sinceMin, timeZone } = body;
  if (!sessionId) {
    return Response.json({ error: "sessionId manquant." }, { status: 400 });
  }

  // L'état vient de la DB, jamais du client : source de vérité unique.
  const stored = await getState(auth.supabase, auth.user.id);
  const state = stored?.state ?? EMPTY_STATE;

  const apiMessages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: OPENING_CUE },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  if (resume) apiMessages.push({ role: "user", content: RESUME_CUE });

  const client = new Anthropic({ apiKey });
  const system = chatSystemPrompt(state, timeZone, sinceMin);

  const { supabase, user } = auth;
  const encoder = new TextEncoder();
  // web_search est un outil SERVER-SIDE : quand sa boucle interne s'interrompt,
  // la réponse s'arrête avec stop_reason "pause_turn" (pas "end_turn"). Il faut
  // relancer la requête EN RENVOYANT la réponse partielle (le serveur détecte le
  // bloc server_tool_use en attente et reprend tout seul) — sinon le message est
  // tronqué en plein milieu (« Demain tu… »).
  const MAX_CONTINUATIONS = 2;
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      let convo: Anthropic.MessageParam[] = apiMessages;
      try {
        for (let turn = 0; ; turn++) {
          const stream = client.messages.stream({
            model: CHAT_MODEL,
            // Opus 5 réfléchit (thinking adaptatif) AVANT d'écrire, et ces jetons
            // de réflexion comptent dans max_tokens : à 1200, une réflexion un peu
            // fournie mangeait le budget et coupait la réponse EN PLEINE PHRASE
            // (stop_reason "max_tokens"). On donne de la marge — on ne paie que ce
            // qui est réellement produit, donc le coût courant ne bouge pas.
            max_tokens: 3000,
            system,
            messages: convo,
            tools: [
              { type: "web_search_20260209", name: "web_search", max_uses: 1 },
            ],
          });
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              full += event.delta.text;
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          const finalMsg = await stream.finalMessage();
          if (finalMsg.stop_reason === "pause_turn" && turn < MAX_CONTINUATIONS) {
            convo = [...convo, { role: "assistant", content: finalMsg.content }];
            continue; // on reprend là où le tour s'est mis en pause
          }
          break;
        }
        // La session est sauvegardée CÔTÉ SERVEUR avant de clore le stream :
        // un refresh au milieu d'une session ne perd plus la conversation.
        await saveSessionMessages(supabase, user.id, sessionId, [
          ...messages,
          { role: "assistant", content: full, at: new Date().toISOString() },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur de génération.";
        controller.enqueue(encoder.encode(`\n\n⚠️ ${msg}`));
        // Erreur mid-stream (rate-limit, 5xx, coupure) : on persiste quand même
        // le tour utilisateur (déjà dans `messages`) + le début de réponse s'il
        // existe, marqué comme interrompu — sinon un refresh perdrait le tour.
        try {
          await saveSessionMessages(supabase, user.id, sessionId, [
            ...messages,
            ...(full.trim()
              ? [
                  {
                    role: "assistant" as const,
                    content: `${full}\n\n⚠️ ${msg}`,
                    at: new Date().toISOString(),
                  },
                ]
              : []),
          ]);
        } catch {
          // On n'aggrave pas : la conversation reste au moins côté client.
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
