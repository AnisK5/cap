import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/auth";
import { getState, saveSessionMessages } from "@/lib/db";
import { CHAT_MODEL } from "@/lib/model";
import { chatSystemPrompt, LANDING_CUE, OPENING_CUE } from "@/lib/prompts";
import { EMPTY_STATE, type ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  sessionId: string;
  messages: ChatMessage[]; // la conversation affichée, sans la réponse à venir
  landing?: boolean; // l'utilisateur a cliqué « C'est clair » → on atterrit
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
  const { sessionId, messages = [], landing } = body;
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
  if (landing) apiMessages.push({ role: "user", content: LANDING_CUE });

  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: 1200,
    system: chatSystemPrompt(state),
    messages: apiMessages,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
  });

  const { supabase, user } = auth;
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            full += event.delta.text;
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        // La session est sauvegardée CÔTÉ SERVEUR avant de clore le stream :
        // un refresh au milieu d'une session ne perd plus la conversation.
        await saveSessionMessages(supabase, user.id, sessionId, [
          ...messages,
          { role: "assistant", content: full },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur de génération.";
        controller.enqueue(encoder.encode(`\n\n⚠️ ${msg}`));
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
