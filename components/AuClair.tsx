"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChatMessage, Objective, WeekPlan } from "@/lib/types";
import type { SessionSummary } from "@/lib/db";
import type { StoredState } from "@/lib/store";
import { DAY_KEYS, DAY_SHORT } from "@/lib/week";
import { capColor } from "@/components/CapTrack";

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
  onWeekRolled?: () => void; // nouvelle semaine → reposer le plan (régénération)
  onOpenPlan?: () => void; // « voir la semaine en entier » → onglet Plan
  weekPlan?: WeekPlan; // la semaine posée (pour la mini-carte inline)
  objectives?: Objective[]; // pour les icônes/couleurs des caps dans la carte
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

export default function AuClair({
  active,
  onClose,
  onUpdate,
  onWeekRolled,
  onOpenPlan,
  weekPlan,
  objectives,
  day,
}: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Historique : `history` = liste des fils passés (null = panneau fermé) ;
  // `past` = un fil ancien ouvert en LECTURE SEULE (null = on est sur le jour).
  const [history, setHistory] = useState<SessionSummary[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [past, setPast] = useState<{ id: string; messages: ChatMessage[] } | null>(
    null,
  );
  // Mini-carte de semaine inline : quand un tour du coach vient de poser / changer
  // la semaine, on l'affiche sous CE message (index ancré) plutôt qu'un pavé.
  const [weekCard, setWeekCard] = useState<{ after: number; plan: WeekPlan } | null>(
    null,
  );
  // Signature de la semaine AVANT le tour en cours : on la fige juste avant
  // d'envoyer, et on compare après réconciliation — un changement ⇒ carte.
  const beforeWeekSig = useRef<string | null>(null);
  const msgLen = useRef(0);
  const started = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollDown = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(scrollDown, [messages, scrollDown]);

  // On garde le nombre de messages sous la main (ref) pour ancrer la mini-carte
  // sous le DERNIER message au moment où la semaine est posée.
  useEffect(() => {
    msgLen.current = messages.length;
  }, [messages]);

  // Après réconciliation : si la semaine (créneaux de cette semaine) a changé sur
  // ce tour, on affiche la mini-carte sous le dernier message — sinon rien. Puis
  // on propage l'état au parent comme d'habitude.
  const applyReconciled = useCallback(
    (payload: LandedPayload) => {
      const sig = weekSig(payload.state.weekPlan);
      if (sig && sig !== beforeWeekSig.current) {
        const plan = payload.state.weekPlan;
        if (plan) setWeekCard({ after: msgLen.current - 1, plan });
      }
      onUpdate(payload);
    },
    [onUpdate],
  );

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
      beforeWeekSig.current = weekSig(weekPlan); // état de la semaine avant ce tour
      setMessages([
        ...convo,
        { role: "assistant", content: "", at: new Date().toISOString() },
      ]);
      setBusy(true);
      streamChat({ sessionId: sid, messages: convo, ...extra }, appendDelta)
        .then(() => reconcile(sid).then(applyReconciled).catch(() => {}))
        .catch((e) => setError((e as Error).message))
        .finally(() => {
          setBusy(false);
          inputRef.current?.focus();
        });
    },
    [appendDelta, applyReconciled, weekPlan],
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
        const { session, rolledOver, state, weekRolled } = await res.json();
        // Un rollover (jour ou semaine) a pu changer le plan côté serveur : on
        // reflète tout de suite l'état renvoyé pour que la grille soit à jour.
        if (state) onUpdate(state as LandedPayload);
        // Nouvelle semaine : la grille a été vidée → on repose la semaine à
        // partir du contexte actuel (le coach régénère), plutôt que de décaler.
        if (weekRolled) onWeekRolled?.();
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
  }, [active, assistantTurn, onUpdate, onWeekRolled]);

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

  // Ouvre le panneau d'historique et charge la liste des fils passés.
  const openHistory = useCallback(async () => {
    setLoadingHistory(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions");
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Historique indisponible.");
      setHistory((j.sessions ?? []) as SessionSummary[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // Charge un fil passé en lecture seule (le fil du jour n'est pas touché).
  const openPast = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/sessions?id=${id}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Fil introuvable.");
      setPast({ id, messages: (j.session?.messages ?? []) as ChatMessage[] });
      setHistory(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const closePast = useCallback(() => setPast(null), []);

  // Fil en lecture seule → on part du haut, pas du dernier message.
  useLayoutEffect(() => {
    if (past && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [past]);

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
    beforeWeekSig.current = weekSig(weekPlan); // état de la semaine avant ce tour
    setMessages([...convo, { role: "assistant", content: "", at: now }]);
    setBusy(true);
    try {
      await streamChat({ sessionId, messages: convo }, appendDelta);
      // Tout se commit en direct : le serveur relit le fil, fusionne (carte +
      // priorités + journée) et renvoie l'état à jour, qu'on reflète aussitôt.
      reconcile(sessionId).then(applyReconciled).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [draft, busy, sessionId, messages, appendDelta, applyReconciled, weekPlan]);

  // Échap pour revenir à « Aujourd'hui » sans rien couper (le fil reste ouvert).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || e.key !== "Escape") return;
      // Échap referme d'abord ce qui est ouvert par-dessus le fil du jour.
      if (history !== null) setHistory(null);
      else if (past) setPast(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose, history, past]);

  return (
    <div
      className={`${active ? "flex" : "hidden"} h-[calc(100dvh-13rem)] flex-col pb-[env(safe-area-inset-bottom)] sm:h-[calc(100dvh-18rem)]`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        {past ? (
          <span className="min-w-0 flex-1 truncate text-xs uppercase tracking-[0.15em] text-faint">
            Un fil passé · lecture seule
          </span>
        ) : day && day.length > 0 ? (
          <DayStrip rows={day} />
        ) : (
          <span />
        )}
        {past ? (
          <button
            onClick={closePast}
            className="shrink-0 rounded-full px-3 py-1 text-xs text-cap-ink transition-colors hover:text-ink"
          >
            ← Revenir au fil du jour
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={openHistory}
              className="rounded-full px-3 py-1 text-xs text-faint transition-colors hover:text-ink"
            >
              Historique
            </button>
            <button
              onClick={reset}
              disabled={busy}
              className="rounded-full px-3 py-1 text-xs text-faint transition-colors hover:text-ink disabled:opacity-30"
            >
              Recommencer
            </button>
          </div>
        )}
      </div>

      <div ref={scrollRef} className="w-full flex-1 overflow-y-auto pb-4">
        <div className="flex flex-col gap-6 py-4">
          {(past ? past.messages : messages).map((m, i, list) => {
            // Séparateur temporel quand un vrai laps s'est écoulé (reprise après
            // pause, nouveau jour) : sinon la reprise du coach se confond
            // visuellement avec ce qu'il venait de dire.
            const sep = gapLabel(list[i - 1]?.at, m.at);
            return (
              <Fragment key={i}>
                {sep && (
                  <div className="flex items-center gap-3 py-0.5 text-[0.7rem] text-faint">
                    <span className="h-px flex-1 bg-line" />
                    <span className="shrink-0">{sep}</span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                <Bubble
                  role={m.role}
                  content={m.content}
                  at={m.at}
                  busy={past ? false : busy}
                />
                {!past && weekCard?.after === i && (
                  <WeekCardInline
                    plan={weekCard.plan}
                    objectives={objectives ?? []}
                    onOpen={onOpenPlan}
                  />
                )}
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

      {past ? (
        <div className="w-full pt-2 text-center text-xs text-faint">
          Tu relis un fil passé — reviens au fil du jour pour écrire.
        </div>
      ) : (
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
      )}

      {history !== null && (
        <HistoryPanel
          sessions={history}
          loading={loadingHistory}
          currentId={sessionId}
          onPick={openPast}
          onClose={() => setHistory(null)}
        />
      )}
    </div>
  );
}

// Panneau d'historique : la liste des fils passés, du plus récent au plus
// ancien. On clique un jour pour le relire ; le fil du jour n'est pas touché.
function HistoryPanel({
  sessions,
  loading,
  currentId,
  onPick,
  onClose,
}: {
  sessions: SessionSummary[];
  loading: boolean;
  currentId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/20 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[70dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-canvas p-4 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm uppercase tracking-[0.15em] text-faint">
            Fils passés
          </h3>
          <button
            onClick={onClose}
            className="rounded-full px-2 py-1 text-xs text-faint hover:text-ink"
          >
            Fermer
          </button>
        </div>
        {loading ? (
          <p className="py-8 text-center text-sm text-faint">…</p>
        ) : sessions.length === 0 ? (
          <p className="py-8 text-center text-sm text-faint">
            Rien encore — tes fils passés s'afficheront ici.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => onPick(s.id)}
                  className="w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-ink">
                      {dayLabel(s.startedAt)}
                      {s.id === currentId && (
                        <span className="ml-2 text-xs font-normal text-cap-ink">
                          · aujourd'hui
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-faint">
                      {s.count} msg
                    </span>
                  </div>
                  {s.preview && (
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {s.preview}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Un libellé de jour lisible pour l'historique (« lundi 28 juillet »).
function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
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

// Signature des créneaux de CETTE semaine (offset 0) : sert à détecter qu'un
// tour du coach a posé/changé la semaine. null si rien de posé cette semaine.
function weekSig(wp?: WeekPlan): string | null {
  if (!wp) return null;
  const slots = wp.slots.filter((s) => (s.weekOffset ?? 0) === 0);
  if (slots.length === 0) return null;
  return slots
    .map((s) => `${s.day}-${s.part}-${s.objectiveId}-${s.goal ?? ""}`)
    .sort()
    .join("|");
}

// La mini-carte de semaine, inline dans le chat : un aperçu visuel compact (les
// 7 jours × leurs caps placés) à la place d'un pavé de texte. Le détail complet
// vit dans l'onglet Plan — d'où le lien « voir en entier ».
const PART_ORDER: Record<string, number> = { matin: 0, aprem: 1, soir: 2 };
function WeekCardInline({
  plan,
  objectives,
  onOpen,
}: {
  plan: WeekPlan;
  objectives: Objective[];
  onOpen?: () => void;
}) {
  const objById = new Map(objectives.map((o) => [o.id, o]));
  const slots = plan.slots.filter((s) => (s.weekOffset ?? 0) === 0);
  return (
    <div className="animate-rise max-w-[92%] self-start rounded-2xl border border-line bg-surface/60 px-3 py-3 shadow-sm">
      <div className="grid grid-cols-7 gap-1 text-center">
        {DAY_KEYS.map((day) => {
          const daySlots = slots
            .filter((s) => s.day === day)
            .sort((a, b) => (PART_ORDER[a.part] ?? 0) - (PART_ORDER[b.part] ?? 0));
          return (
            <div key={day} className="min-w-0">
              <div className="text-[0.6rem] uppercase tracking-wide text-faint">
                {DAY_SHORT[day]}
              </div>
              <div className="mt-1 flex flex-col items-center gap-1">
                {daySlots.length === 0 ? (
                  <span className="text-faint/30">·</span>
                ) : (
                  daySlots.map((s, i) => {
                    const o = objById.get(s.objectiveId);
                    return (
                      <span
                        key={i}
                        title={`${o?.title ?? ""}${s.goal ? " — " + s.goal : ""}`}
                        className="text-base leading-none"
                        style={{ color: capColor(objectives, s.objectiveId) }}
                      >
                        {o?.icon ?? "•"}
                      </span>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
      {onOpen && (
        <button
          onClick={onOpen}
          className="mt-2.5 text-[0.72rem] font-medium text-cap-ink transition-colors hover:text-ink"
        >
          Voir la semaine en entier →
        </button>
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
