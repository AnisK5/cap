"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChatMessage } from "@/lib/types";
import type { StoredState } from "@/lib/store";

export type LandedPayload = StoredState & { note?: string | null };

interface Props {
  active: boolean; // l'onglet « Au clair » est-il affiché ? (on démarre à ce moment)
  onClose: () => void;
  onLanded: (s: LandedPayload) => void;
  onLive: (s: LandedPayload) => void; // maj en direct de la structure pendant la conv
}

type Phase = "talking" | "landing" | "reconciling" | "landed";

async function streamChat(
  body: object,
  onDelta: (chunk: string) => void,
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || "Pas de réponse.");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    onDelta(chunk);
  }
  return full;
}

async function reconcile(
  sessionId: string,
  live: boolean,
): Promise<LandedPayload> {
  const res = await fetch("/api/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, live }),
  });
  const j = (await res.json()) as LandedPayload & { error?: string };
  if (!res.ok || j.error) throw new Error(j.error || "Erreur de réconciliation.");
  return j;
}

export default function AuClair({ active, onClose, onLanded, onLive }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("talking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollDown = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(scrollDown, [messages, scrollDown]);

  const appendDelta = useCallback((chunk: string) => {
    setMessages((m) => {
      const next = [...m];
      next[next.length - 1] = {
        role: "assistant",
        content: next[next.length - 1].content + chunk,
      };
      return next;
    });
  }, []);

  // Ouverture à chaud : l'assistant parle en premier.
  const startConversation = useCallback(
    (sid: string) => {
      setError(null);
      setPhase("talking");
      setMessages([{ role: "assistant", content: "" }]);
      setBusy(true);
      streamChat({ sessionId: sid, messages: [] }, appendDelta)
        .catch((e) => setError((e as Error).message))
        .finally(() => {
          setBusy(false);
          inputRef.current?.focus();
        });
    },
    [appendDelta],
  );

  // Au premier affichage de l'onglet : reprend la session ouverte du jour
  // (conversation intacte après un refresh), sinon en démarre une.
  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    (async () => {
      try {
        const res = await fetch("/api/session");
        const { session } = await res.json();
        if (session && session.messages.length > 0) {
          setSessionId(session.id);
          setMessages(session.messages as ChatMessage[]);
          inputRef.current?.focus();
          return;
        }
        let sid: string | null = session?.id ?? null;
        if (!sid) {
          const created = await fetch("/api/session", { method: "POST" });
          sid = (await created.json()).session.id as string;
        }
        setSessionId(sid);
        startConversation(sid);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [active, startConversation]);

  const reset = useCallback(async () => {
    setDraft("");
    try {
      const created = await fetch("/api/session", { method: "POST" });
      const sid = (await created.json()).session.id as string;
      setSessionId(sid);
      startConversation(sid);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [startConversation]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy || !sessionId) return;
    setDraft("");
    setError(null);
    const convo: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...convo, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      await streamChat({ sessionId, messages: convo }, appendDelta);
      // Maj EN DIRECT (fire-and-forget) : le serveur relit la session en DB,
      // fusionne et écrit — l'état renvoyé fait foi.
      reconcile(sessionId, true)
        .then(onLive)
        .catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [draft, busy, sessionId, messages, appendDelta, onLive]);

  // Atterrissage : message de clôture + réconciliation (priorités du jour).
  const land = useCallback(async () => {
    if (busy || phase !== "talking" || !sessionId) return;
    setError(null);
    setPhase("landing");
    setBusy(true);
    const convo = messages;
    setMessages([...convo, { role: "assistant", content: "" }]);
    try {
      await streamChat(
        { sessionId, messages: convo, landing: true },
        appendDelta,
      );
      setPhase("reconciling");
      const landed = await reconcile(sessionId, false);
      setPhase("landed");
      setBusy(false);
      started.current = false; // la prochaine ouverture repartira sur une session neuve
      // Laisse voir le dernier message une seconde avant de recomposer l'accueil.
      setTimeout(() => onLanded(landed), 1100);
    } catch (e) {
      // Échec d'enregistrement : ne PAS faire croire que c'est sauvé.
      setError(
        `Je n'ai pas réussi à enregistrer tes priorités (${(e as Error).message}). Ta conversation est gardée — reclique « C'est assez clair » pour réessayer.`,
      );
      setPhase("talking");
      setBusy(false);
    }
  }, [busy, phase, sessionId, messages, appendDelta, onLanded]);

  // Échap pour revenir à l'accueil sans atterrir.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (active && e.key === "Escape" && phase === "talking") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose, phase]);

  const canLand = messages.some((m) => m.role === "user") && phase === "talking";

  return (
    <div
      className={`${active ? "flex" : "hidden"} h-[calc(100dvh-13rem)] flex-col pb-[env(safe-area-inset-bottom)]`}
    >
      <div className="mb-2 flex items-center justify-end">
        <button
          onClick={reset}
          disabled={busy || phase !== "talking"}
          className="rounded-full px-3 py-1 text-xs text-faint transition-colors hover:text-ink disabled:opacity-30"
        >
          Recommencer
        </button>
      </div>

      <div ref={scrollRef} className="w-full flex-1 overflow-y-auto pb-4">
        <div className="flex flex-col gap-6 py-4">
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role} content={m.content} busy={busy} />
          ))}
          {phase === "reconciling" && (
            <p className="animate-breathe text-center text-sm text-cap">
              Je mets à jour ta situation…
            </p>
          )}
          {phase === "landed" && (
            <p className="animate-fade text-center text-sm text-cap">
              C&apos;est clair. Va exécuter.
            </p>
          )}
          {error && (
            <p className="rounded-lg bg-gold-soft px-4 py-3 text-sm text-gold">
              {error}
            </p>
          )}
        </div>
      </div>

      {phase === "talking" && (
        <div className="w-full pt-2">
          <div className="flex items-end gap-3 rounded-2xl border border-line bg-surface p-2.5 shadow-sm">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Où t'en es, ce qui a bougé, ce qui te fait douter…"
              className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-ink placeholder:text-faint focus:outline-none"
            />
            <button
              onClick={send}
              disabled={busy || !draft.trim()}
              className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-canvas transition-opacity disabled:opacity-25"
            >
              Envoyer
            </button>
          </div>
          <div className="mt-3 flex justify-center">
            <button
              onClick={land}
              disabled={!canLand}
              className="rounded-full border border-cap/30 bg-cap-soft px-5 py-2 text-sm font-medium text-cap-ink transition-all hover:border-cap/60 disabled:cursor-not-allowed disabled:opacity-30"
            >
              C&apos;est assez clair → mes priorités du jour
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({
  role,
  content,
  busy,
}: {
  role: "assistant" | "user";
  content: string;
  busy: boolean;
}) {
  if (role === "user") {
    return (
      <div className="animate-rise self-end rounded-2xl rounded-br-md bg-ink px-4 py-3 text-canvas max-w-[85%]">
        <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
      </div>
    );
  }
  return (
    <div className="animate-rise max-w-[92%] self-start">
      <p className="whitespace-pre-wrap text-[1.05rem] leading-relaxed text-ink">
        {content}
        {busy && !content && (
          <span className="animate-breathe text-faint">·&nbsp;·&nbsp;·</span>
        )}
      </p>
    </div>
  );
}
