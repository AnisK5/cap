"use client";

import { useRef, useState } from "react";
import type { Objective, Step } from "@/lib/types";
import { deadlineChip, momentumLabel } from "./CapTrack";

// ─────────────────────────────────────────────────────────────────────────
// La carte, en deux niveaux (méthodo TDAH : une question par niveau) :
//  · CHEMINS (défaut)  — « où je vais, ça avance ? » : par cap, un chemin de
//    jalons calme + les flux en continu. 3-4 objets visuels, pas de grille.
//  · SEMAINES          — « quand, quoi ? » : la frise calendaire partagée
//    (UN axe commun pour tous les caps — décision itér. 22), inchangée.
// ─────────────────────────────────────────────────────────────────────────

const LABEL_W = 210;
const WEEK_W = 52;
const ROW_H = 34;
const HEADER_H = 46;
const MONTHS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
const PALETTE = [
  "var(--color-cap)", // indigo
  "#2e6f63", // teal
  "#c4703b", // terracotta
  "#8a5cf6", // violet
  "#b0843a", // gold
];

interface CarteProps {
  objectives: Objective[];
  onOpen: () => void;
  onDeleteCap?: (id: string) => void;
  onEditCapTitle?: (id: string, title: string) => void;
  onEditFlowTitle?: (objId: string, flowId: string, title: string) => void;
}

function sortObjectives(objectives: Objective[]): Objective[] {
  return [...objectives].sort((a, b) => {
    const hasData = (o: Objective) =>
      (o.steps?.length ?? 0) + (o.flows?.length ?? 0) > 0;
    const pa = hasData(a) ? (a.lastMovedAt ? 0 : 1) : 2;
    const pb = hasData(b) ? (b.lastMovedAt ? 0 : 1) : 2;
    if (pa !== pb) return pa - pb;
    const at = a.lastMovedAt ?? a.createdAt;
    const bt = b.lastMovedAt ?? b.createdAt;
    return bt > at ? 1 : bt < at ? -1 : 0;
  });
}

export default function Carte(props: CarteProps) {
  const [mode, setMode] = useState<"chemins" | "semaines">("chemins");

  if (props.objectives.length === 0) {
    return (
      <div className="animate-rise rounded-2xl border border-dashed border-line bg-surface/50 px-6 py-14 text-center">
        <p className="mx-auto max-w-md font-display text-xl italic leading-relaxed text-muted">
          Aucun cap pour l&apos;instant. Dis-moi sur quoi tu bosses, et je dessine
          où tu en es.
        </p>
        <button
          onClick={props.onOpen}
          className="mt-7 rounded-full bg-ink px-6 py-3 text-sm font-medium text-canvas transition-transform hover:scale-[1.02]"
        >
          En parler
        </button>
      </div>
    );
  }

  const sorted = sortObjectives(props.objectives);

  return (
    <div>
      <div className="mb-5 flex items-center justify-end">
        <div className="inline-flex gap-0.5 rounded-full border border-line bg-surface p-0.5 text-xs shadow-sm">
          <ModeTab active={mode === "chemins"} onClick={() => setMode("chemins")}>
            Chemins
          </ModeTab>
          <ModeTab active={mode === "semaines"} onClick={() => setMode("semaines")}>
            Semaines
          </ModeTab>
        </div>
      </div>
      {mode === "chemins" ? (
        <PathsView
          {...props}
          objectives={sorted}
          onSeeWeeks={() => setMode("semaines")}
        />
      ) : (
        <TimelineView {...props} objectives={sorted} />
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 transition-colors ${
        active ? "bg-ink text-canvas" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

// ═════════════════════════ NIVEAU 1 : CHEMINS ════════════════════════════

function PathsView({
  objectives,
  onOpen,
  onDeleteCap,
  onEditCapTitle,
  onEditFlowTitle,
  onSeeWeeks,
}: CarteProps & { onSeeWeeks: () => void }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mx-auto max-w-2xl">
      {objectives.map((o, i) => (
        <CapPath
          key={o.id}
          o={o}
          color={PALETTE[i % PALETTE.length]}
          open={openIds.has(o.id)}
          onToggle={() => toggle(o.id)}
          onOpen={onOpen}
          onDelete={onDeleteCap ? () => onDeleteCap(o.id) : undefined}
          onEditTitle={
            onEditCapTitle ? (t: string) => onEditCapTitle(o.id, t) : undefined
          }
          onEditFlow={
            onEditFlowTitle
              ? (fid: string, t: string) => onEditFlowTitle(o.id, fid, t)
              : undefined
          }
          onSeeWeeks={onSeeWeeks}
        />
      ))}
    </div>
  );
}

// Replié = 2 lignes : le cap, et où j'en suis sur le chemin. Tout le reste
// (jalons complets, flux, cible, momentum) n'existe qu'une fois déplié —
// c'est la seule façon de tenir le test des 3 secondes avec de vraies données.
function CapPath({
  o,
  color,
  open,
  onToggle,
  onOpen,
  onDelete,
  onEditTitle,
  onEditFlow,
  onSeeWeeks,
}: {
  o: Objective;
  color: string;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete?: () => void;
  onEditTitle?: (title: string) => void;
  onEditFlow?: (flowId: string, title: string) => void;
  onSeeWeeks: () => void;
}) {
  const chip = deadlineChip(o);
  const momentum = momentumLabel(o);
  const asleep = momentum?.startsWith("dort");
  const steps = o.steps ?? [];
  const flows = o.flows ?? [];
  const active = flows.filter((f) => !f.waitingOn && f.state !== "pause");
  const waiting = flows.filter((f) => !!f.waitingOn);
  const hasData = steps.length + flows.length > 0;
  const hasTiming = [...steps, ...flows].some((t) => t.fromWeek !== undefined);

  return (
    <section className="group animate-rise border-t border-line/70 py-5 first:border-t-0 first:pt-1">
      {/* Ligne 1 : le cap et son enjeu. Clic = déplier. */}
      <div
        className="flex cursor-pointer items-center gap-2.5"
        onClick={onToggle}
      >
        {o.icon && <span className="text-lg leading-none">{o.icon}</span>}
        <InlineEdit
          value={o.title}
          onChange={onEditTitle}
          className="min-w-0 truncate font-display text-xl font-medium text-ink"
          inputClassName="font-display text-xl font-medium text-ink border-b border-cap/40 w-64"
        />
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {chip ? (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                chip.urgent ? "bg-cap-soft text-cap-ink" : "bg-sink text-muted"
              }`}
            >
              {chip.label}
            </span>
          ) : o.horizon ? (
            <span
              className="max-w-[9rem] truncate rounded-full bg-sink px-2 py-0.5 text-xs text-muted"
              title={o.horizon}
            >
              ⏱ {o.horizon}
            </span>
          ) : o.unlocks ? (
            <span className="text-xs text-gold" title={o.unlocks}>
              ★
            </span>
          ) : null}
          <span className="text-xs text-faint">{open ? "▾" : "▸"}</span>
        </span>
      </div>

      {/* Ligne 2 : le chemin en pastilles — seule l'étape courante est nommée. */}
      {hasData ? (
        <CompactTrail steps={steps} color={color} hasReward={!!o.unlocks} />
      ) : (
        <p className="mt-2 text-sm italic text-faint">
          à cartographier —{" "}
          <button
            onClick={onOpen}
            className="underline decoration-dotted hover:text-cap-ink"
          >
            parles-en avec Cap
          </button>
        </p>
      )}

      {/* Déplié : le détail, une info par ligne. */}
      {open && hasData && (
        <div className="animate-fade mt-4 flex flex-col gap-2.5 pl-1 text-sm">
          {steps.length > 0 && (
            <ol className="flex flex-col gap-1.5">
              {steps.map((s) => {
                const isCurrent =
                  steps.find((x) => !x.done)?.id === s.id;
                return (
                  <li key={s.id} className="flex items-baseline gap-2">
                    <span
                      className={isCurrent ? "font-semibold" : "text-faint"}
                      style={isCurrent ? { color } : undefined}
                    >
                      {s.done ? "✓" : isCurrent ? "◉" : "○"}
                    </span>
                    <span
                      className={
                        s.done
                          ? "text-faint line-through"
                          : isCurrent
                            ? "text-ink"
                            : "text-muted"
                      }
                    >
                      {s.title}
                    </span>
                  </li>
                );
              })}
              {o.unlocks && (
                <li className="flex items-baseline gap-2 text-gold">
                  <span>★</span>
                  <span>{o.unlocks}</span>
                </li>
              )}
            </ol>
          )}

          {active.length > 0 && (
            <p className="leading-relaxed text-muted">
              <span className="text-faint">en continu&nbsp;: </span>
              {active.map((f, i) => (
                <span key={f.id}>
                  <InlineEdit
                    value={f.title}
                    onChange={
                      onEditFlow ? (t: string) => onEditFlow(f.id, t) : undefined
                    }
                    className="text-muted"
                    inputClassName="text-sm text-ink border-b border-cap/40 bg-transparent focus:outline-none"
                  />
                  {f.state === "ralenti" && (
                    <span className="text-faint"> (ralenti)</span>
                  )}
                  {i < active.length - 1 && (
                    <span className="text-faint"> · </span>
                  )}
                </span>
              ))}
            </p>
          )}

          {waiting.length > 0 && (
            <p className="text-faint">
              en attente&nbsp;:{" "}
              {waiting.map((f) => `${f.title} (${f.waitingOn})`).join(", ")}
            </p>
          )}

          {o.target && (
            <p className="text-faint" title={o.target}>
              cible&nbsp;: <span className="text-muted">{o.target}</span>
            </p>
          )}

          {/* Momentum : jamais une dette — une invitation. */}
          {asleep && (
            <p className="text-gold">
              {momentum} — un petit bloc pour le réveiller&nbsp;?
            </p>
          )}

          <p className="mt-1 flex items-center gap-4">
            {hasTiming && (
              <button
                onClick={onSeeWeeks}
                className="text-xs text-faint underline decoration-dotted transition-colors hover:text-cap-ink"
              >
                ▸ voir les semaines
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="text-xs text-faint transition-colors hover:text-red-400"
              >
                supprimer ce cap
              </button>
            )}
          </p>
        </div>
      )}
    </section>
  );
}

// ●─●─◉ Étape courante ─○─★ : le chemin d'un coup d'œil, un seul libellé.
function CompactTrail({
  steps,
  color,
  hasReward,
}: {
  steps: Step[];
  color: string;
  hasReward: boolean;
}) {
  const currentIdx = steps.findIndex((s) => !s.done);
  const parts: React.ReactNode[] = [];

  steps.forEach((s, i) => {
    if (i > 0) parts.push(<Dash key={`d${i}`} />);
    if (i === currentIdx) {
      parts.push(
        <span
          key={s.id}
          className="flex min-w-0 items-center gap-1.5 font-medium"
          style={{ color }}
        >
          <span>◉</span>
          <span className="truncate">{s.title}</span>
        </span>,
      );
    } else {
      parts.push(
        <span key={s.id} className={s.done ? "" : "text-faint"} style={s.done ? { color, opacity: 0.55 } : undefined} title={s.title}>
          {s.done ? "●" : "○"}
        </span>,
      );
    }
  });
  if (hasReward) {
    if (steps.length > 0) parts.push(<Dash key="dr" />);
    parts.push(
      <span key="r" className="text-gold">
        ★
      </span>,
    );
  }
  if (parts.length === 0) return null;

  return (
    <div className="mt-2 flex items-center gap-1.5 pl-0.5 text-[0.95rem]">
      {parts}
    </div>
  );
}

function Dash() {
  return <span className="select-none text-faint/40">─</span>;
}

// ═════════════════════ NIVEAU 2 : SEMAINES (frise) ═══════════════════════
// La frise calendaire partagée — un seul axe commun pour tous les caps.

interface Bar {
  id: string;
  title: string;
  fromWeek: number;
  toWeek: number;
  placed: boolean;
  waiting: boolean;
  voie?: string;
}

function collectBars(o: Objective): Bar[] {
  return (o.flows ?? []).map((f) => {
    const from = f.fromWeek ?? 0;
    return {
      id: f.id, title: f.title,
      fromWeek: from, toWeek: f.toWeek ?? from,
      placed: f.fromWeek !== undefined,
      waiting: !!f.waitingOn, voie: f.voie,
    };
  });
}

function mondayOfThisWeek(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

function TimelineView({
  objectives,
  onOpen,
  onDeleteCap,
  onEditCapTitle,
  onEditFlowTitle,
}: CarteProps) {
  const groups = objectives.map((o, i) => ({
    o,
    color: PALETTE[i % PALETTE.length],
    bars: collectBars(o),
  }));

  const allBars = groups.flatMap((g) => g.bars);
  const maxTo = Math.max(4, ...allBars.map((b) => b.toWeek));
  const N = Math.min(16, Math.max(10, maxTo + 2));

  const monday = mondayOfThisWeek();
  const weeks = Array.from({ length: N }, (_, i) => {
    const ws = new Date(monday);
    ws.setDate(monday.getDate() + i * 7);
    return { i, month: ws.getMonth(), som: Math.floor((ws.getDate() - 1) / 7) + 1 };
  });
  const monthGroups: { month: number; start: number; span: number }[] = [];
  for (const w of weeks) {
    const last = monthGroups[monthGroups.length - 1];
    if (last && last.month === w.month) last.span++;
    else monthGroups.push({ month: w.month, start: w.i, span: 1 });
  }
  const trackW = N * WEEK_W;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <div className="-mx-1 overflow-x-auto pb-2">
        <div className="relative" style={{ minWidth: LABEL_W + trackW }}>
          {/* Lignes verticales de mois */}
          {monthGroups.map((g, i) =>
            i === 0 ? null : (
              <div
                key={`gl${i}`}
                className="pointer-events-none absolute"
                style={{
                  left: LABEL_W + g.start * WEEK_W,
                  top: HEADER_H,
                  bottom: 4,
                  width: 1,
                  background: "var(--color-line)",
                }}
              />
            ),
          )}
          {/* Bande « cette semaine » */}
          <div
            className="pointer-events-none absolute rounded-md"
            style={{
              left: LABEL_W, width: WEEK_W, top: HEADER_H, bottom: 4,
              background: "var(--color-cap-soft)", opacity: 0.35,
            }}
          />

          {/* En-tête mois + semaines */}
          <div className="flex" style={{ height: HEADER_H }}>
            <div
              className="flex items-end pb-1.5 text-[0.7rem] uppercase tracking-[0.15em] text-faint"
              style={{ width: LABEL_W }}
            >
              Ta carte
            </div>
            <div className="flex-1">
              <div className="flex" style={{ height: 22 }}>
                {monthGroups.map((g, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-center border-l border-line text-xs font-medium text-muted"
                    style={{ width: g.span * WEEK_W }}
                  >
                    {MONTHS[g.month]}
                  </div>
                ))}
              </div>
              <div className="flex">
                {weeks.map((w) => (
                  <div
                    key={w.i}
                    className={`border-l text-center text-[0.62rem] ${
                      w.i === 0 ? "border-line font-semibold text-cap-ink" : "border-line/50 text-faint"
                    }`}
                    style={{ width: WEEK_W }}
                  >
                    S{w.som}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Un groupe par objectif */}
          {groups.map(({ o, color, bars }) => (
            <ObjectiveGroup
              key={o.id}
              o={o}
              color={color}
              bars={bars}
              N={N}
              onOpen={onOpen}
              onDelete={onDeleteCap ? () => onDeleteCap(o.id) : undefined}
              onEditTitle={onEditCapTitle ? (t) => onEditCapTitle(o.id, t) : undefined}
              onEditFlow={
                onEditFlowTitle
                  ? (flowId, t) => onEditFlowTitle(o.id, flowId, t)
                  : undefined
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ObjectiveGroup({
  o,
  color,
  bars,
  N,
  onOpen,
  onDelete,
  onEditTitle,
  onEditFlow,
}: {
  o: Objective;
  color: string;
  bars: Bar[];
  N: number;
  onOpen: () => void;
  onDelete?: () => void;
  onEditTitle?: (title: string) => void;
  onEditFlow?: (flowId: string, title: string) => void;
}) {
  const chip = deadlineChip(o);
  const momentum = momentumLabel(o);
  const asleep = momentum?.startsWith("dort");

  const ganttBars = bars.filter((b) => b.placed && !b.waiting);

  // Indicateur de durée globale du cap (span de tous les flows placés)
  const capFrom = ganttBars.length ? Math.min(...ganttBars.map((b) => b.fromWeek)) : undefined;
  const capTo = ganttBars.length ? Math.max(...ganttBars.map((b) => b.toWeek)) : undefined;

  const voies: string[] = [];
  for (const b of ganttBars) {
    const k = b.voie ?? "";
    if (!voies.includes(k)) voies.push(k);
  }
  const multiVoie = voies.filter((v) => v).length > 1;

  return (
    <div className="group mt-5 border-t border-line/70 pt-3 first:mt-2 first:border-t-0">
      {/* En-tête de l'objectif — posé AU-DESSUS des lignes de mois (z-10 +
          fond), sinon target/horizon flottent sur la timeline. */}
      <div className="relative z-10 mb-1.5 flex items-center gap-2.5 bg-surface">
        <span className="text-base leading-none">{o.icon ?? "◆"}</span>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <InlineEdit
          value={o.title}
          onChange={onEditTitle}
          className="font-display text-base font-medium text-ink"
          inputClassName="font-display text-base font-medium text-ink border-b border-cap/40 w-64"
        />
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {asleep ? (
            <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[0.68rem] text-gold">
              {momentum}
            </span>
          ) : chip ? (
            <span
              className={`rounded-full px-2 py-0.5 text-[0.68rem] font-medium ${
                chip.urgent ? "bg-cap-soft text-cap-ink" : "bg-sink text-muted"
              }`}
            >
              {chip.label}
            </span>
          ) : !o.target ? (
            <button
              onClick={onOpen}
              className="text-[0.68rem] text-faint underline decoration-dotted hover:text-cap-ink"
            >
              cible à définir
            </button>
          ) : null}
          {onDelete && (
            <button
              onClick={onDelete}
              className="opacity-0 transition-opacity group-hover:opacity-100 rounded px-1 text-base leading-none text-faint hover:text-red-400"
              title="Supprimer ce cap"
            >
              ×
            </button>
          )}
        </span>
      </div>

      {/* Indicateur de durée globale du cap sur la frise */}
      {capFrom !== undefined && (
        <div className="flex" style={{ height: 6 }}>
          <div style={{ width: LABEL_W }} />
          <div className="relative" style={{ width: N * WEEK_W }}>
            <div
              className="absolute rounded-full"
              style={{
                left: capFrom * WEEK_W + 3,
                width: (capTo! - capFrom + 1) * WEEK_W - 6,
                height: 3,
                top: 1,
                background: color,
                opacity: 0.15,
              }}
            />
          </div>
        </div>
      )}

      {/* Activités : Gantt flows actifs */}
      {bars.length === 0 && !o.steps?.length ? (
        <p className="pl-1 text-xs italic text-faint">
          à cartographier — parles-en avec Cap
        </p>
      ) : (
        <>
          {ganttBars.length > 0 &&
            voies.map((voie) => {
              const rows = ganttBars.filter((b) => (b.voie ?? "") === voie);
              if (rows.length === 0) return null;
              return (
                <div key={voie || "_"}>
                  {multiVoie && voie && (
                    <p className="pb-0.5 pl-1 pt-1 text-[0.68rem] font-medium uppercase tracking-wide text-faint">
                      {voie}
                    </p>
                  )}
                  {rows.map((b) => (
                    <BarRow
                      key={b.id}
                      bar={b}
                      N={N}
                      color={color}
                      onEdit={onEditFlow ? (t) => onEditFlow(b.id, t) : undefined}
                    />
                  ))}
                </div>
              );
            })}
          {/* Flows en attente → dans "Contexte en mémoire" sur Aujourd'hui */}
        </>
      )}
    </div>
  );
}

function BarRow({
  bar,
  N,
  color,
  onEdit,
}: {
  bar: Bar;
  N: number;
  color: string;
  onEdit?: (title: string) => void;
}) {
  const left = bar.fromWeek * WEEK_W;
  const width = Math.max(WEEK_W, (bar.toWeek - bar.fromWeek + 1) * WEEK_W) - 6;

  return (
    <div className="flex items-center" style={{ height: ROW_H }}>
      <div
        className="truncate pl-1 pr-3 text-xs"
        style={{ width: LABEL_W }}
        title={bar.title}
      >
        <InlineEdit
          value={bar.title}
          onChange={onEdit}
          className="text-muted"
          inputClassName="text-xs text-ink border-b border-cap/40 w-full bg-transparent focus:outline-none"
        />
      </div>
      <div className="relative" style={{ width: N * WEEK_W, height: "100%" }}>
        <div
          className="absolute top-1/2 rounded-full"
          style={{
            left: left + 3,
            width,
            height: 10,
            transform: "translateY(-50%)",
            background: bar.placed ? color : "transparent",
            opacity: 0.45,
            border: !bar.placed ? "1.5px dashed var(--color-line)" : "none",
          }}
        />
      </div>
    </div>
  );
}

// ── Édition inline ────────────────────────────────────────────────────────
function InlineEdit({
  value,
  onChange,
  className,
  inputClassName,
}: {
  value: string;
  onChange?: (v: string) => void;
  className?: string;
  inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  if (!onChange) return <span className={className}>{value}</span>;

  if (editing) {
    return (
      <input
        ref={ref}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim()) onChange(draft.trim());
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (draft.trim()) onChange(draft.trim());
            setEditing(false);
          }
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={`bg-transparent focus:outline-none ${inputClassName ?? className ?? ""}`}
      />
    );
  }

  return (
    <span
      className={`cursor-text ${className ?? ""}`}
      onDoubleClick={() => { setDraft(value); setEditing(true); }}
      title="Double-clic pour modifier"
    >
      {value}
    </span>
  );
}
