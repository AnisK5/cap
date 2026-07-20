"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChatMessage, CapState } from "@/lib/types";
import type { Reconciliation } from "@/lib/store";

interface Props {
  active: boolean; // l'onglet « Au clair » est-il affiché ? (on démarre à ce moment)
  state: CapState;
  onClose: () => void;
  onLanded: (r: Reconciliation) => void;
  onLive: (r: Reconciliation) => void; // maj en direct de la structure pendant la conv
}

type Phase = "talking" | "landing" | "reconciling" | "landed";

async function streamCap(
  body: object,
  onDelta: (chunk: string) => void,
): Promise<string> {
  const res = await fetch("/api/cap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.body) {
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

export default function AuClair({
  active,
  state,
  onClose,
  onLanded,
  onLive,
}: Props) {
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

  // Ouverture à chaud : l'assistant parle en premier.
  const startConversation = useCallback(() => {
    started.current = true;
    setError(null);
    setPhase("talking");
    setMessages([{ role: "assistant", content: "" }]);
    setBusy(true);
    streamCap({ messages: [], state }, (chunk) =>
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = {
          role: "assistant",
          content: next[next.length - 1].content + chunk,
        };
        return next;
      }),
    )
      .catch((e) => setError((e as Error).message))
      .finally(() => {
        setBusy(false);
        inputRef.current?.focus();
      });
  }, [state]);

  // On ne démarre que quand l'onglet devient actif (jamais au chargement).
  useEffect(() => {
    if (active && !started.current) startConversation();
  }, [active, startConversation]);

  const reset = useCallback(() => {
    started.current = false;
    setDraft("");
    startConversation();
  }, [startConversation]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setError(null);
    const base: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ];
    setMessages(base);
    setBusy(true);
    try {
      const convo = base.slice(0, -1);
      const assistantText = await streamCap({ messages: convo, state }, (chunk) =>
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = {
            role: "assistant",
            content: next[next.length - 1].content + chunk,
          };
          return next;
        }),
      );
      // Maj EN DIRECT (fire-and-forget) : la structure/carte se met à jour
      // pendant qu'on parle, sans attendre l'atterrissage.
      const full: ChatMessage[] = [
        ...convo,
        { role: "assistant", content: assistantText },
      ];
      fetch("/api/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: full, state }),
      })
        .then((res) => res.json())
        .then((r) => {
          if (r && !r.error) onLive(r);
        })
        .catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [draft, busy, messages, state, onLive]);

  // Atterrissage : message de clôture + réconciliation.
  const land = useCallback(async () => {
    if (busy || phase !== "talking") return;
    setError(null);
    setPhase("landing");
    setBusy(true);
    const withLanding: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: "" },
    ];
    setMessages(withLanding);
    try {
      const convo = messages;
      const finalMsg = await streamCap(
        { messages: convo, state, landing: true },
        (chunk) =>
          setMessages((m) => {
            const next = [...m];
            next[next.length - 1] = {
              role: "assistant",
              content: next[next.length - 1].content + chunk,
            };
            return next;
          }),
      );

      setPhase("reconciling");
      const full: ChatMessage[] = [
        ...convo,
        { role: "assistant", content: finalMsg },
      ];
      const res = await fetch("/api/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: full, state }),
      });
      const r = (await res.json()) as Reconciliation & { error?: string };
      if (r.error) throw new Error(r.error);
      setPhase("landed");
      setBusy(false);
      // Laisse voir le dernier message une seconde avant de recomposer l'accueil.
      setTimeout(() => onLanded(r), 1100);
    } catch (e) {
      // Échec d'enregistrement : ne PAS faire croire que c'est sauvé.
      setError(
        `Je n'ai pas réussi à enregistrer tes priorités (${(e as Error).message}). Ta conversation est gardée — reclique « C'est assez clair » pour réessayer.`,
      );
      setPhase("talking");
      setBusy(false);
    }
  }, [busy, phase, messages, state, onLanded]);

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
    <div className={`${active ? "flex" : "hidden"} h-[calc(100vh-13rem)] flex-col`}>
      <div className="mb-2 flex items-center justify-end">
        <button
          onClick={reset}
          disabled={busy || phase !== "talking"}
          className="rounded-full px-3 py-1 text-xs text-faint transition-colors hover:text-ink disabled:opacity-30"
        >
          Recommencer
        </button>
      </div>

      <div
        ref={scrollRef}
        className="w-full flex-1 overflow-y-auto pb-4"
      >
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
              C'est clair. Va exécuter.
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
              C'est assez clair → mes priorités du jour
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
