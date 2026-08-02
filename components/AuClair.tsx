"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChatMessage } from "@/lib/types";
import type { StoredState } from "@/lib/store";

export type LandedPayload = StoredState & { note?: string | null };

// La journée à afficher en secondaire dans le fil (résolue par la page depuis
// l'état committé — le modèle est « tout en direct »).
export type DayRow = {
  id: string;
  title: string;
  why?: string;
  dueBy?: string;
  done: boolean;
};

interface Props {
  active: boolean; // l'onglet « Au clair » est-il affiché ? (on démarre à ce moment)
  onClose: () => void;
  onUpdate: (s: LandedPayload) => void; // maj en direct de l'état après chaque tour
  day?: DayRow[];
}

// Au-delà de cet écart depuis le dernier message, on déclenche un check-in de
// reprise (« il est 16h, t'en es où depuis ? ») au lieu de reprendre à froid.
const RESUME_GAP_MIN = 90;

async function streamChat(
  body: object,
  onDelta: (chunk: string) => void,
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Le fuseau du client : le serveur déployé vit en UTC, sans ça le coach
    // se trompe de jour/heure autour de minuit local.
    body: JSON.stringify({
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...body,
    }),
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

// Réconciliation : tout se commit en direct (plus de mode « atterrissage »).
async function reconcile(sessionId: string): Promise<LandedPayload> {
  const res = await fetch("/api/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  const j = (await res.json()) as LandedPayload & { error?: string };
  if (!res.ok || j.error) throw new Error(j.error || "Erreur de réconciliation.");
  return j;
}

export default function AuClair({ active, onClose, onUpdate, day }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
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
      const last = next[next.length - 1];
      next[next.length - 1] = {
        ...last, // préserve l'horodatage posé à la création de la bulle
        role: "assistant",
        content: last.content + chunk,
      };
      return next;
    });
  }, []);

  // Un tour de l'assistant seul (ouverture ou reprise) : il parle en premier.
  const assistantTurn = useCallback(
    (sid: string, convo: ChatMessage[], extra: object) => {
      setError(null);
      setMessages([
        ...convo,
        { role: "assistant", content: "", at: new Date().toISOString() },
      ]);
      setBusy(true);
      streamChat({ sessionId: sid, messages: convo, ...extra }, appendDelta)
        .then(() => reconcile(sid).then(onUpdate).catch(() => {}))
        .catch((e) => setError((e as Error).message))
        .finally(() => {
          setBusy(false);
          inputRef.current?.focus();
        });
    },
    [appendDelta, onUpdate],
  );

  // Au premier affichage de l'onglet : récupère le FIL DU JOUR (modèle compagnon).
  //  - rollover ou fil vide → ouverture à chaud ;
  //  - fil du jour repris après une vraie pause → check-in gap-aware ;
  //  - sinon → on ré-affiche le fil, sans re-parler.
  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    (async () => {
      try {
        const res = await fetch("/api/session/today", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
        const { session, rolledOver } = await res.json();
        setSessionId(session.id);

        const convo = (session.messages ?? []) as ChatMessage[];
        if (rolledOver || convo.length === 0) {
          assistantTurn(session.id, [], {});
          return;
        }

        setMessages(convo);
        const gapMin =
          (Date.now() - Date.parse(session.updatedAt)) / 60000;
        if (gapMin >= RESUME_GAP_MIN) {
          assistantTurn(session.id, convo, {
            resume: true,
            sinceMin: Math.round(gapMin),
          });
        } else {
          inputRef.current?.focus();
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [active, assistantTurn]);

  // « Recommencer » : un nouveau fil (l'état n'est pas touché).
  const reset = useCallback(async () => {
    setDraft("");
    try {
      const created = await fetch("/api/session", { method: "POST" });
      const sid = (await created.json()).session.id as string;
      setSessionId(sid);
      assistantTurn(sid, [], {});
    } catch (e) {
      setError((e as Error).message);
    }
  }, [assistantTurn]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy || !sessionId) return;
    setDraft("");
    setError(null);
    const now = new Date().toISOString();
    const convo: ChatMessage[] = [
      ...messages,
      { role: "user", content: text, at: now },
    ];
    setMessages([...convo, { role: "assistant", content: "", at: now }]);
    setBusy(true);
    try {
      await streamChat({ sessionId, messages: convo }, appendDelta);
      // Tout se commit en direct : le serveur relit le fil, fusionne (carte +
      // priorités + journée) et renvoie l'état à jour, qu'on reflète aussitôt.
      reconcile(sessionId).then(onUpdate).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [draft, busy, sessionId, messages, appendDelta, onUpdate]);

  // Échap pour revenir à « Aujourd'hui » sans rien couper (le fil reste ouvert).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (active && e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);

  return (
    <div
      className={`${active ? "flex" : "hidden"} h-[calc(100dvh-13rem)] flex-col pb-[env(safe-area-inset-bottom)] sm:h-[calc(100dvh-18rem)]`}
    >
      <div className="mb-2 flex items-center justify-between">
        {day && day.length > 0 ? <DayStrip rows={day} /> : <span />}
        <button
          onClick={reset}
          disabled={busy}
          className="shrink-0 rounded-full px-3 py-1 text-xs text-faint transition-colors hover:text-ink disabled:opacity-30"
        >
          Recommencer
        </button>
      </div>

      <div ref={scrollRef} className="w-full flex-1 overflow-y-auto pb-4">
        <div className="flex flex-col gap-6 py-4">
          {messages.map((m, i) => {
            // Séparateur temporel quand un vrai laps s'est écoulé (reprise après
            // pause, nouveau jour) : sinon la reprise du coach se confond
            // visuellement avec ce qu'il venait de dire.
            const sep = gapLabel(messages[i - 1]?.at, m.at);
            return (
              <Fragment key={i}>
                {sep && (
                  <div className="flex items-center gap-3 py-0.5 text-[0.7rem] text-faint">
                    <span className="h-px flex-1 bg-line" />
                    <span className="shrink-0">{sep}</span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                <Bubble role={m.role} content={m.content} at={m.at} busy={busy} />
              </Fragment>
            );
          })}
          {error && (
            <p className="rounded-lg bg-gold-soft px-4 py-3 text-sm text-gold">
              {error}
            </p>
          )}
        </div>
      </div>

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
      </div>
    </div>
  );
}

// « Ta journée » en SECONDAIRE : une bande discrète, repliée par défaut, qui ne
// rétrécit plus le fil. Lit l'état committé (tout est en direct désormais).
function DayStrip({ rows }: { rows: DayRow[] }) {
  const [open, setOpen] = useState(false);
  const done = rows.filter((r) => r.done).length;

  return (
    <div className="min-w-0 flex-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-cap-ink"
      >
        <span className="text-[0.7rem]">{open ? "▾" : "▸"}</span>
        Ta journée
        <span className="font-normal normal-case tracking-normal text-cap-ink/60">
          · {done}/{rows.length}
        </span>
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1.5 rounded-xl border border-cap/20 bg-cap-soft/30 px-3 py-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-baseline gap-2 text-sm leading-snug">
              <span className={r.done ? "text-cap" : "text-faint"}>
                {r.done ? "✓" : "○"}
              </span>
              <span className={r.done ? "text-faint line-through" : "text-ink"}>
                {r.title}
                {r.dueBy && (
                  <span className="ml-1.5 text-xs text-cap-ink/70">· {r.dueBy}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Un repère entre deux messages quand un vrai laps s'est écoulé : rien si moins
// d'une heure le même jour, l'heure si grand écart le même jour, le jour + heure
// si on a changé de jour. Sans horodatage (anciens messages), pas de séparateur.
function gapLabel(prevAt?: string, at?: string): string | null {
  if (!prevAt || !at) return null;
  const a = new Date(prevAt);
  const b = new Date(at);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const sameDay = a.toDateString() === b.toDateString();
  const gapMin = (b.getTime() - a.getTime()) / 60000;
  if (sameDay && gapMin < 60) return null;
  if (!sameDay) {
    const day = b.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    return `${day} · ${hhmm(at)}`;
  }
  return hhmm(at);
}

function Bubble({
  role,
  content,
  at,
  busy,
}: {
  role: "assistant" | "user";
  content: string;
  at?: string;
  busy: boolean;
}) {
  const time = at ? hhmm(at) : "";
  if (role === "user") {
    return (
      <div className="animate-rise max-w-[85%] self-end">
        <div className="rounded-2xl rounded-br-md bg-ink px-4 py-3 text-canvas">
          <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
        </div>
        {time && (
          <p className="mt-1 pr-1 text-right text-xs tabular-nums text-faint">
            {time}
          </p>
        )}
      </div>
    );
  }
  // Le coach écrit en texte brut : on le rend SCANNABLE plutôt qu'en mur —
  // paragraphes espacés, un liseré coloré pour ancrer le message, et le pas
  // concret (ligne « → … ») sorti en pastille d'action.
  const paras = content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="animate-rise max-w-[92%] self-start border-l-2 border-cap/30 pl-3.5">
      {busy && !content ? (
        <span className="animate-breathe text-lg text-faint">
          ·&nbsp;·&nbsp;·
        </span>
      ) : (
        <div className="flex flex-col gap-2.5">
          {paras.map((para, i) =>
            /^→/.test(para) ? (
              <p
                key={i}
                className="flex gap-2 rounded-xl bg-cap-soft/70 px-3.5 py-2.5 text-[1.02rem] font-medium leading-relaxed text-cap-ink"
              >
                <span aria-hidden className="text-cap">
                  →
                </span>
                <span className="whitespace-pre-wrap">
                  {para.replace(/^→\s*/, "")}
                </span>
              </p>
            ) : (
              <p
                key={i}
                className="whitespace-pre-wrap text-[1.05rem] leading-relaxed text-ink"
              >
                {para}
              </p>
            ),
          )}
        </div>
      )}
      {time && content && (
        <p className="mt-1.5 text-xs tabular-nums text-faint">{time}</p>
      )}
    </div>
  );
}
