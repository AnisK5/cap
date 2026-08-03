"use client";

import { useRef, useState } from "react";
import type { Flow, FlowState, Habit, Objective, Step, WeekPlan } from "@/lib/types";
import { newId } from "@/lib/merge";
import {
  DAY_KEYS,
  DAY_SHORT,
  PART_SHORT,
  PARTS,
  slotKey,
  todayDayIdx,
} from "@/lib/week";
import { capColor, deadlineChip, momentumLabel } from "./CapTrack";

// ─────────────────────────────────────────────────────────────────────────
// La carte, en deux niveaux (méthodo TDAH : une question par niveau) :
//  · CHEMINS (défaut) — « où je vais, ça avance ? » : par cap, le MOTEUR
//    d'abord (les flux : c'est eux qui produisent la conversion), puis le
//    prochain jalon en toutes lettres. Tout le détail — éditable à la main —
//    n'existe qu'une fois déplié.
//  · SEMAINES — « quand, quoi ? » : la frise calendaire partagée (UN axe
//    commun pour tous les caps — décision itér. 22).
// ─────────────────────────────────────────────────────────────────────────

const MONTHS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
type UpdateObjective = (id: string, up: (o: Objective) => Objective) => void;
type UpdateHabits = (up: (prev: Habit[]) => Habit[]) => void;

interface CarteProps {
  objectives: Objective[];
  habits?: Habit[];
  onOpen: () => void;
  onDeleteCap?: (id: string) => void;
  onReorderCap?: (id: string, dir: -1 | 1) => void;
  onUpdateObjective?: UpdateObjective;
  onUpdateHabits?: UpdateHabits;
  onClean?: () => void;
  cleaning?: boolean;
  weekPlan?: WeekPlan;
  onGenerateWeek?: () => void;
  generatingWeek?: boolean;
  // Le mode est piloté par l'onglet de la page (« Projets » / « Plan »), plus
  // par un sous-toggle interne.
  mode?: "chemins" | "semaines" | "planning";
  onSeeWeeks?: () => void;
  onMoveSlot?: (
    fromDay: string,
    fromPart: string,
    toDay: string,
    toPart: string,
    weekOffset: number,
  ) => void;
}

export default function Carte(props: CarteProps) {
  const mode = props.mode ?? "chemins";

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

  // On affiche les caps dans l'ordre TEL QUEL du state = l'ordre de PRIORITÉ
  // (réordonnable à la main). Plus de tri par momentum : l'ordre porte le sens,
  // le plus important en haut — ça allège la lecture.
  const sorted = props.objectives;

  return (
    <div>
      {/* Le bouton « Nettoyer » ne concerne que la carte des projets. */}
      {mode === "chemins" && props.onClean && (
        <div className="mb-5">
          <button
            onClick={props.onClean}
            disabled={props.cleaning}
            title="L'IA range la carte : fusionne les doublons et raccourcit les titres à rallonge, sans rien perdre"
            className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted shadow-sm transition-colors hover:text-ink disabled:opacity-40"
          >
            {props.cleaning ? "Nettoyage…" : "✨ Nettoyer"}
          </button>
        </div>
      )}
      {mode === "chemins" ? (
        <PathsView
          {...props}
          objectives={sorted}
          onSeeWeeks={props.onSeeWeeks ?? (() => {})}
          colorOf={(id) => capColor(props.objectives, id)}
          onReorderCap={props.onReorderCap}
        />
      ) : mode === "planning" ? (
        <WeekView
          weekPlan={props.weekPlan}
          objectives={sorted}
          colorOf={(id) => capColor(props.objectives, id)}
          onGenerate={props.onGenerateWeek}
          generating={props.generatingWeek}
          onMove={props.onMoveSlot}
        />
      ) : (
        <TimelineView
          {...props}
          objectives={sorted}
          colorOf={(id) => capColor(props.objectives, id)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// VUE SEMAINE — le plan macro, 7 jours × 3 demi-journées. Chaque case remplie
// = un cap (couleur + icône) avec le pourquoi de l'ordre ; les cases vides sont
// des plages libres assumées. En bas, où chaque cap atterrit à ce rythme (la
// projection, qui reprend le rôle de la frise). Lecture seule, généré par le
// coach, re-dérivable — jamais une grille qu'on remplit.
// ─────────────────────────────────────────────────────────────────────────
function WeekView({
  weekPlan,
  objectives,
  colorOf,
  onGenerate,
  generating,
  onMove,
}: {
  weekPlan?: WeekPlan;
  objectives: Objective[];
  colorOf: (id: string) => string;
  onGenerate?: () => void;
  generating?: boolean;
  onMove?: (
    fromDay: string,
    fromPart: string,
    toDay: string,
    toPart: string,
    weekOffset: number,
  ) => void;
}) {
  const [weekView, setWeekView] = useState<0 | 1>(0);
  const [dragFrom, setDragFrom] = useState<{ day: string; part: string } | null>(
    null,
  );
  // Poser les handlers de glisser-déposer sur une case (cible), et rendre une
  // case pleine déplaçable. Déplacer = changer jour/moment (échange si occupé).
  const dropProps = (day: string, part: string) =>
    onMove
      ? {
          onDragOver: (e: React.DragEvent) => e.preventDefault(),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            if (dragFrom) onMove(dragFrom.day, dragFrom.part, day, part, weekView);
            setDragFrom(null);
          },
        }
      : {};
  const objById = new Map(objectives.map((o) => [o.id, o]));
  const idx = todayDayIdx();
  // La semaine affichée : cette semaine (aujourd'hui + jours passés grisés) ou la
  // prochaine (les 7 jours, sans « aujourd'hui » ni jour passé).
  const activeIdx = weekView === 0 ? idx : -1;
  const allSlots = weekPlan?.slots ?? [];
  const viewSlots = allSlots.filter((s) => (s.weekOffset ?? 0) === weekView);
  const slotByKey = new Map(viewSlots.map((s) => [slotKey(s.day, s.part), s]));
  const hasPlan = allSlots.length > 0;
  const hasThisView = viewSlots.length > 0;

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-[0.95rem] leading-relaxed text-muted">
          {weekPlan?.intro ??
            "La forme de tes prochains jours : quel cap avancer quand, et où ça te mène. Le coach la propose — tu ne la remplis pas."}
        </p>
        {onGenerate && (
          <button
            onClick={onGenerate}
            disabled={generating}
            className="shrink-0 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted shadow-sm transition-colors hover:text-ink disabled:opacity-40"
          >
            {generating ? "…" : hasPlan ? "Régénérer" : "Proposer la semaine"}
          </button>
        )}
      </div>

      {!hasPlan ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface/50 px-6 py-12 text-center">
          <p className="mx-auto max-w-md text-muted">
            {generating
              ? "Le coach pose ta semaine…"
              : "Pas encore de semaine posée. Demande au coach de proposer un ordre pour tes prochains jours."}
          </p>
        </div>
      ) : (
        <>
          <div className="mb-3 inline-flex gap-0.5 rounded-full border border-line bg-surface p-0.5 text-xs shadow-sm">
            <button
              onClick={() => setWeekView(0)}
              className={`rounded-full px-3 py-1 transition-colors ${
                weekView === 0 ? "bg-ink text-canvas" : "text-muted hover:text-ink"
              }`}
            >
              Cette semaine
            </button>
            <button
              onClick={() => setWeekView(1)}
              className={`rounded-full px-3 py-1 transition-colors ${
                weekView === 1 ? "bg-ink text-canvas" : "text-muted hover:text-ink"
              }`}
            >
              Semaine prochaine
            </button>
            {onMove && (
              <span className="hidden items-center px-2 text-[0.7rem] text-faint sm:inline-flex">
                Glisse une case pour la déplacer
              </span>
            )}
          </div>

          {!hasThisView ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface/50 px-6 py-10 text-center">
              <p className="mx-auto max-w-md text-muted">
                {weekView === 1
                  ? "Pas encore de semaine prochaine posée. Demande au coach de la préparer — surtout utile en fin de semaine."
                  : "Rien de posé cette semaine pour l'instant."}
              </p>
            </div>
          ) : (
            <>
          <div className="overflow-x-auto pb-1">
            <div className="min-w-[64rem]">
              {/* En-tête des jours */}
              <div className="grid grid-cols-[2.8rem_repeat(7,minmax(9.5rem,1fr))] gap-1.5">
                <div />
                {DAY_KEYS.map((d, i) => (
                  <div
                    key={d}
                    className={`text-center text-xs font-semibold uppercase tracking-wide ${
                      i === activeIdx
                        ? "text-cap-ink"
                        : i < activeIdx
                          ? "text-faint/50"
                          : "text-faint"
                    }`}
                  >
                    {DAY_SHORT[d]}
                    {i === activeIdx && (
                      <span className="ml-1 font-normal normal-case text-cap">
                        · auj.
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Une ligne par demi-journée */}
              {PARTS.map((part) => (
                <div
                  key={part}
                  className="mt-1.5 grid grid-cols-[2.8rem_repeat(7,minmax(9.5rem,1fr))] gap-1.5"
                >
                  <div className="flex items-center text-xs font-medium text-faint">
                    {PART_SHORT[part]}
                  </div>
                  {DAY_KEYS.map((d, i) => {
                    const s = slotByKey.get(slotKey(d, part));
                    const past = i < activeIdx;
                    const isToday = i === activeIdx;
                    if (!s) {
                      return (
                        <div
                          key={d}
                          {...dropProps(d, part)}
                          className={`min-h-[6.5rem] rounded-xl border border-dashed ${
                            isToday ? "border-cap/30 bg-cap-soft/20" : "border-line/50"
                          } ${past ? "opacity-40" : ""}`}
                        />
                      );
                    }
                    const o = objById.get(s.objectiveId);
                    const color = colorOf(s.objectiveId);
                    return (
                      <div
                        key={d}
                        draggable={!!onMove}
                        onDragStart={
                          onMove ? () => setDragFrom({ day: d, part }) : undefined
                        }
                        onDragEnd={() => setDragFrom(null)}
                        {...dropProps(d, part)}
                        className={`min-h-[6.5rem] overflow-hidden rounded-xl border-l-4 border border-line bg-surface px-2.5 py-2 shadow-sm ${
                          onMove ? "cursor-grab active:cursor-grabbing" : ""
                        } ${
                          dragFrom?.day === d && dragFrom?.part === part
                            ? "opacity-40 ring-2 ring-cap/40"
                            : ""
                        } ${past ? "opacity-45" : ""}`}
                        style={{ borderLeftColor: color }}
                      >
                        {/* Le cap, bien visible : icône + nom coloré */}
                        <div className="flex items-center gap-1.5">
                          {o?.icon && <span className="text-sm">{o.icon}</span>}
                          <span
                            className="text-[0.8rem] font-semibold leading-tight"
                            style={{ color }}
                          >
                            {o?.title ?? "?"}
                          </span>
                        </div>

                        {/* Le mini-objectif de la demi-journée, en évidence */}
                        {s.goal && (
                          <p className="mt-1 flex gap-1 text-[0.78rem] font-medium leading-snug text-ink">
                            <span aria-hidden>🎯</span>
                            <span>{s.goal}</span>
                          </p>
                        )}

                        {/* Le découpage concret en sous-créneaux */}
                        {s.blocks && s.blocks.length > 0 && (
                          <ul className="mt-1.5 flex flex-col gap-1">
                            {s.blocks.map((b, bi) => (
                              <li
                                key={bi}
                                className="rounded-md bg-canvas/60 px-1.5 py-1 text-[0.72rem] leading-snug"
                              >
                                <span className="font-medium text-ink">
                                  {b.label}
                                </span>
                                {b.goal && (
                                  <span className="text-muted"> · {b.goal}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Le pourquoi de l'ordre, en appui, entier */}
                        {s.why && (
                          <p className="mt-1.5 text-[0.7rem] italic leading-snug text-faint">
                            {s.why}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <p className="mt-2.5 text-[0.7rem] text-faint">
            Les cases pointillées sont des plages libres, laissées exprès. Rien à
            y caser.
          </p>

          {weekView === 0 && weekPlan?.landings && weekPlan.landings.length > 0 && (
            <div className="mt-7">
              <p className="text-xs uppercase tracking-[0.18em] text-faint">
                Où ça te mène, à ce rythme
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {weekPlan.landings.map((l) => {
                  const o = objById.get(l.objectiveId);
                  const color = colorOf(l.objectiveId);
                  return (
                    <li
                      key={l.objectiveId}
                      className="flex items-baseline gap-2.5 text-sm"
                    >
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ background: color }}
                      />
                      <span className="text-ink">
                        {o?.icon && `${o.icon} `}
                        {o?.title}
                      </span>
                      <span className="text-faint">→</span>
                      <span className="text-muted">{l.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// Le chemin en miniature : un plot par jalon, reliés par un trait. Les jalons
// franchis sont pleins (couleur du cap), le courant est un anneau qui respire
// (animate-ping), les suivants sont creux. On ne LIT plus l'avancée — on la VOIT,
// et on voit le parcours entier d'un coup d'œil. (C'est ça, « Chemins ».)
function Stepper({ steps, color }: { steps: Step[]; color: string }) {
  if (steps.length === 0) return null;
  const currentId = steps.find((s) => !s.done)?.id;
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="flex items-center gap-2.5" title={`${done}/${steps.length} jalons franchis`}>
      <div className="flex items-center">
        {steps.map((s, i) => {
          const isCurrent = s.id === currentId;
          return (
            <div key={s.id} className="flex items-center">
              {i > 0 && (
                <span
                  className="h-[2px] w-4 sm:w-6"
                  style={{
                    background: steps[i - 1].done ? color : "var(--color-line)",
                  }}
                />
              )}
              {s.done ? (
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ background: color }}
                  title={s.title}
                />
              ) : isCurrent ? (
                <span className="relative flex h-3.5 w-3.5 items-center justify-center" title={s.title}>
                  <span
                    className="absolute inline-flex h-full w-full rounded-full opacity-40 motion-safe:animate-ping"
                    style={{ background: color }}
                  />
                  <span
                    className="relative h-3.5 w-3.5 rounded-full border-2 bg-surface"
                    style={{ borderColor: color }}
                  />
                </span>
              ) : (
                <span className="h-2 w-2 rounded-full bg-line" title={s.title} />
              )}
            </div>
          );
        })}
      </div>
      <span className="text-xs font-semibold" style={{ color }}>
        {done}/{steps.length}
      </span>
    </div>
  );
}

// LE point focal de la carte : la prochaine action, en callout coloré avec une
// pastille-flèche. C'est la seule chose qui doit crier — l'œil tombe dessus et
// sait quoi faire, sans lire le reste. (Répond à « c'est quoi ma prio ? ».)
function PriorityCallout({
  label,
  title,
  icon,
  color,
  done,
}: {
  label: string;
  title: string;
  icon: string;
  color: string;
  done?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-2.5"
      style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base font-semibold text-canvas"
        style={{ background: color }}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span
          className="block text-[0.62rem] font-semibold uppercase tracking-[0.12em]"
          style={{ color }}
        >
          {label}
        </span>
        <span
          className={`block text-base font-semibold leading-snug ${done ? "" : "text-ink"}`}
          style={done ? { color } : undefined}
        >
          {title}
        </span>
      </span>
    </div>
  );
}

// Le moteur en pastille compacte (contexte, pas focal) : un point qui pulse +
// les flux actifs. Se pose À CÔTÉ de la progression, pas en dessous.
function MoteurChip({ flows, color }: { flows: Flow[]; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
      style={{ borderColor: `color-mix(in srgb, ${color} 30%, var(--color-line))` }}
      title="le moteur qui tourne"
    >
      <span className="relative flex h-2 w-2 items-center justify-center">
        <span
          className="absolute inline-flex h-2 w-2 rounded-full opacity-50 motion-safe:animate-ping"
          style={{ background: color }}
        />
        <span className="relative h-2 w-2 rounded-full" style={{ background: color }} />
      </span>
      <span className="font-semibold" style={{ color }}>
        Moteur
      </span>
      <span className="text-muted">{flows.map((f) => f.title).join(" · ")}</span>
    </span>
  );
}

// Une pastille de contexte discrète (l'« autre » chose : le prochain jalon quand
// le moteur est focal, ou l'inverse). Juste une icône + un titre tronqué.
function ContextChip({
  icon,
  title,
  color,
}: {
  icon: string;
  title: string;
  color: string;
}) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
      style={{ borderColor: `color-mix(in srgb, ${color} 30%, var(--color-line))` }}
    >
      <span className="shrink-0 font-semibold" style={{ color }}>
        {icon}
      </span>
      <span className="truncate text-muted">{title}</span>
    </span>
  );
}

// Le nudge « ce cap dort » en pastille colorée plutôt qu'en texte perdu.
function NudgePill({ momentum }: { momentum: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-gold-soft px-2.5 py-1 text-xs font-medium text-gold">
      😴 {momentum} — un petit bloc pour le réveiller&nbsp;?
    </span>
  );
}

// ═════════════════════════ NIVEAU 1 : CHEMINS ════════════════════════════

function PathsView({
  objectives,
  habits,
  onOpen,
  onDeleteCap,
  onReorderCap,
  onUpdateObjective,
  onUpdateHabits,
  onSeeWeeks,
  colorOf,
}: CarteProps & { onSeeWeeks: () => void; colorOf: (id: string) => string }) {
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
          color={colorOf(o.id)}
          open={openIds.has(o.id)}
          onToggle={() => toggle(o.id)}
          onOpen={onOpen}
          onDelete={onDeleteCap ? () => onDeleteCap(o.id) : undefined}
          onMove={onReorderCap ? (dir) => onReorderCap(o.id, dir) : undefined}
          isFirst={i === 0}
          isLast={i === objectives.length - 1}
          onUpdate={onUpdateObjective}
          onSeeWeeks={onSeeWeeks}
        />
      ))}

      {/* Le rythme de la vie, à côté de « où je vais » — les rituels ne sont
          pas des destinations : pas de frise, juste un bloc de référence. */}
      <HabitsBlock habits={habits ?? []} onUpdate={onUpdateHabits} />
    </div>
  );
}

// ── Mes rituels : les habitudes persistantes, éditables à la main. Le coach
// les apprend en conversation ; ici on les voit et on les ajuste.
function HabitsBlock({
  habits,
  onUpdate,
}: {
  habits: Habit[];
  onUpdate?: UpdateHabits;
}) {
  if (habits.length === 0 && !onUpdate) return null;
  const patch = (id: string, fn: (h: Habit) => Habit) =>
    onUpdate?.((prev) => prev.map((h) => (h.id === id ? fn(h) : h)));

  return (
    <div className="mt-8 border-t border-line/70 pt-5">
      <p className="mb-2.5 text-xs uppercase tracking-[0.15em] text-faint">
        Mes rituels
      </p>
      {habits.length === 0 ? (
        <p className="text-sm italic text-faint">
          Aucun rituel encore — le coach les apprend quand tu en parles, ou
          ajoute-en un ici.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {habits.map((h) => (
            <li key={h.id} className="group/hab flex items-baseline gap-2">
              <InlineEdit
                value={h.icon || "•"}
                onChange={
                  onUpdate ? (t) => patch(h.id, (x) => ({ ...x, icon: t })) : undefined
                }
                className="shrink-0 text-base leading-none"
                inputClassName="text-base w-10 border-b border-cap/40 bg-transparent focus:outline-none"
              />
              <div className="min-w-0 flex-1">
                <InlineEdit
                  value={h.title}
                  onChange={
                    onUpdate
                      ? (t) => patch(h.id, (x) => ({ ...x, title: t }))
                      : undefined
                  }
                  className="font-medium text-ink"
                  inputClassName="text-sm text-ink border-b border-cap/40 w-full bg-transparent focus:outline-none"
                />
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-faint">
                  <HabitField
                    value={h.cadence}
                    placeholder="cadence"
                    onChange={
                      onUpdate
                        ? (v) => patch(h.id, (x) => ({ ...x, cadence: v }))
                        : undefined
                    }
                  />
                  <HabitField
                    value={h.preferredMoment}
                    placeholder="moment"
                    onChange={
                      onUpdate
                        ? (v) => patch(h.id, (x) => ({ ...x, preferredMoment: v }))
                        : undefined
                    }
                  />
                  <HabitField
                    value={h.why}
                    placeholder="ce que ça nourrit"
                    onChange={
                      onUpdate
                        ? (v) => patch(h.id, (x) => ({ ...x, why: v }))
                        : undefined
                    }
                  />
                </p>
              </div>
              {onUpdate && (
                <button
                  onClick={() =>
                    onUpdate((prev) => prev.filter((x) => x.id !== h.id))
                  }
                  title="supprimer ce rituel"
                  className="shrink-0 px-0.5 text-faint hover:text-red-400 sm:opacity-0 sm:transition-opacity sm:group-hover/hab:opacity-100"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {onUpdate && (
        <AddInline
          label="ajouter un rituel"
          onAdd={(t) => onUpdate((prev) => [...prev, { id: newId(), title: t }])}
        />
      )}
    </div>
  );
}

// Un attribut d'habitude (cadence, moment, sens) : valeur éditable, ou une
// invite discrète « + préciser » quand il est vide.
function HabitField({
  value,
  placeholder,
  onChange,
}: {
  value?: string;
  placeholder: string;
  onChange?: (v: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  if (!value && !onChange) return null;
  if (!value) {
    return adding ? (
      <AutoInput
        onCommit={(v) => {
          if (v.trim()) onChange?.(v.trim());
          setAdding(false);
        }}
      />
    ) : (
      <button
        onClick={() => setAdding(true)}
        className="underline decoration-dotted hover:text-cap-ink"
      >
        + {placeholder}
      </button>
    );
  }
  return (
    <InlineEdit
      value={value}
      onChange={onChange}
      className="text-muted"
      inputClassName="text-xs text-ink border-b border-cap/40 bg-transparent focus:outline-none"
    />
  );
}

// Replié = 3 lignes en toutes lettres, zéro glyphe à décoder :
//   le cap · son horizon
//   en continu : le MOTEUR (les flux, ce qui produit la conversion)
//   prochain jalon : la prochaine marque franchissable
function CapPath({
  o,
  color,
  open,
  onToggle,
  onOpen,
  onDelete,
  onMove,
  isFirst,
  isLast,
  onUpdate,
  onSeeWeeks,
}: {
  o: Objective;
  color: string;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete?: () => void;
  onMove?: (dir: -1 | 1) => void;
  isFirst?: boolean;
  isLast?: boolean;
  onUpdate?: UpdateObjective;
  onSeeWeeks: () => void;
}) {
  const chip = deadlineChip(o);
  const momentum = momentumLabel(o);
  const asleep = momentum?.startsWith("dort");
  const steps = o.steps ?? [];
  const flows = o.flows ?? [];
  const active = flows.filter((f) => !f.waitingOn && f.state !== "pause");
  // Un flux ACTIF (vs ralenti/pause/en attente) = le moteur qu'on alimente
  // maintenant. S'il y en a un, c'est LUI la prio (postuler, prospecter…),
  // pas le jalon de setup. Sinon, la prio = le prochain jalon.
  const liveFlows = active.filter((f) => (f.state ?? "actif") === "actif");
  const moteurDriven = liveFlows.length > 0;
  const hasData = steps.length + flows.length > 0;
  const hasTiming = [...steps, ...flows].some((t) => t.fromWeek !== undefined);
  const nextStep = steps.find((s) => !s.done);
  const remaining = steps.filter((s) => !s.done).length;

  const up = onUpdate
    ? (fn: (prev: Objective) => Objective) => onUpdate(o.id, fn)
    : undefined;

  return (
    <section className="group/cap animate-rise mb-3">
      <div
        className="overflow-hidden rounded-2xl border border-line shadow-sm transition-shadow hover:shadow-md"
        style={{
          borderLeft: `4px solid ${color}`,
          background: `color-mix(in srgb, ${color} 5%, var(--color-surface))`,
        }}
      >
        <div className="p-4">
          {/* En-tête : l'icône en tuile colorée, le cap, son échéance. Clic = déplier. */}
          <div
            className="flex cursor-pointer items-center gap-3"
            onClick={onToggle}
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg leading-none"
              style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}
            >
              {o.icon ?? "◆"}
            </span>
            <InlineEdit
              value={o.title}
              onChange={up ? (t) => up((p) => ({ ...p, title: t })) : undefined}
              className="min-w-0 truncate font-display text-xl font-medium text-ink"
              inputClassName="font-display text-xl font-medium text-ink border-b border-cap/40 w-64"
            />
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {onMove && (
                <span className="flex items-center text-faint sm:opacity-0 sm:transition-opacity sm:group-hover/cap:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onMove(-1);
                    }}
                    disabled={isFirst}
                    title="plus prioritaire (monter)"
                    className="px-0.5 hover:text-ink disabled:opacity-25"
                  >
                    ↑
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onMove(1);
                    }}
                    disabled={isLast}
                    title="moins prioritaire (descendre)"
                    className="px-0.5 hover:text-ink disabled:opacity-25"
                  >
                    ↓
                  </button>
                </span>
              )}
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
              ) : null}
              <span className="text-xs text-faint">{open ? "▾" : "▸"}</span>
            </span>
          </div>

          {!hasData ? (
            <p className="mt-3 pl-12 text-sm italic text-faint">
              à cartographier —{" "}
              <button
                onClick={onOpen}
                className="underline decoration-dotted hover:text-cap-ink"
              >
                parles-en avec Cap
              </button>
            </p>
          ) : open ? (
            /* Déplié : le détail ÉDITABLE — cocher, réordonner, ajouter, changer
               l'état d'un flux, cible/horizon/récompense. */
            <div className="animate-fade mt-4 flex flex-col gap-4 border-t border-line/60 pt-4 text-sm">
              {moteurDriven ? (
                <PriorityCallout
                  label="Le moteur — maintenant"
                  title={liveFlows.map((f) => f.title).join(" · ")}
                  icon="⚙"
                  color={color}
                />
              ) : nextStep ? (
                <PriorityCallout
                  label="Prochaine étape"
                  title={nextStep.title}
                  icon="→"
                  color={color}
                />
              ) : null}
              <StepsEditor o={o} up={up} color={color} />
              <FlowsEditor o={o} up={up} color={color} />

              {/* Repère minimal, en ligne : cible + horizon. La récompense n'est
                  plus dupliquée ici — c'est le ★ au bout du chemin ; on ne
                  propose de la définir que si elle manque. */}
              <div className="flex flex-wrap gap-x-6 gap-y-1.5 rounded-xl border border-line/60 bg-canvas/40 px-3.5 py-2.5">
                <EditableMetaLine
                  label="cible"
                  hint="ce qui dira « réussi », en chiffres"
                  value={o.target}
                  onChange={up ? (v) => up((p) => ({ ...p, target: v })) : undefined}
                />
                <EditableMetaLine
                  label="horizon"
                  hint="l'échéance visée, même souple"
                  value={o.horizon}
                  onChange={up ? (v) => up((p) => ({ ...p, horizon: v })) : undefined}
                />
                {!o.unlocks && (
                  <EditableMetaLine
                    label="récompense"
                    hint="ce que ce cap débloque"
                    value={o.unlocks}
                    onChange={up ? (v) => up((p) => ({ ...p, unlocks: v })) : undefined}
                  />
                )}
              </div>

              {asleep && momentum && <NudgePill momentum={momentum} />}

              <p className="flex items-center gap-4 border-t border-line/60 pt-3">
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
                    className="ml-auto text-xs text-faint transition-colors hover:text-red-400"
                  >
                    supprimer ce cap
                  </button>
                )}
              </p>
            </div>
          ) : (
            /* Replié : UN point focal (la prochaine action), puis le contexte
               démoté — progression + moteur côte à côte, pas empilés. */
            <div className="mt-3 flex flex-col gap-2.5 pl-12">
              {moteurDriven ? (
                <PriorityCallout
                  label="Le moteur — maintenant"
                  title={liveFlows.map((f) => f.title).join(" · ")}
                  icon="⚙"
                  color={color}
                />
              ) : nextStep ? (
                <PriorityCallout
                  label="Prochaine étape"
                  title={nextStep.title}
                  icon="→"
                  color={color}
                />
              ) : steps.length > 0 ? (
                <PriorityCallout
                  label="Cap tenu"
                  title="Tous les jalons franchis"
                  icon="✓"
                  color={color}
                  done
                />
              ) : null}

              {/* Contexte, sur UNE ligne horizontale : progression + l'AUTRE
                  chose (le jalon si moteur-focal, le moteur si jalon-focal). */}
              {(steps.length > 0 ||
                (moteurDriven && nextStep) ||
                (!moteurDriven && active.length > 0)) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {steps.length > 0 && <Stepper steps={steps} color={color} />}
                  {moteurDriven && nextStep ? (
                    <ContextChip icon="→" title={nextStep.title} color={color} />
                  ) : !moteurDriven && active.length > 0 ? (
                    <MoteurChip flows={active} color={color} />
                  ) : null}
                </div>
              )}

              {asleep && momentum && <NudgePill momentum={momentum} />}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Jalons : cocher, renommer (double-clic), réordonner, supprimer, ajouter.
function StepsEditor({
  o,
  up,
  color,
}: {
  o: Objective;
  up?: (fn: (prev: Objective) => Objective) => void;
  color: string;
}) {
  const steps = o.steps ?? [];
  const currentId = steps.find((s) => !s.done)?.id;

  const patchSteps = (fn: (steps: Step[]) => Step[]) =>
    up?.((p) => ({ ...p, steps: fn(p.steps ?? []) }));

  const move = (i: number, dir: -1 | 1) =>
    patchSteps((s) => {
      const next = [...s];
      const j = i + dir;
      if (j < 0 || j >= next.length) return s;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <div>
      <p className="mb-1.5 text-xs uppercase tracking-[0.15em] text-faint">
        Le chemin
      </p>
      {steps.length === 0 && (
        <p className="text-faint">aucun jalon posé pour l&apos;instant</p>
      )}
      {/* Le chemin, à la verticale : une épine relie les jalons, node par node.
          Franchi = plein, courant = anneau qui respire, à venir = creux. La
          récompense (★) est la destination, au bout du fil. */}
      <ol className="flex flex-col">
        {steps.map((s, i) => {
          const isCurrent = s.id === currentId;
          const hasBelow = i < steps.length - 1 || !!o.unlocks;
          return (
            <li
              key={s.id}
              className={`group/step flex items-stretch gap-2 rounded-lg ${
                isCurrent ? "-mx-1.5 px-1.5" : ""
              }`}
              style={
                isCurrent
                  ? { background: `color-mix(in srgb, ${color} 9%, transparent)` }
                  : undefined
              }
            >
              {/* épine + node */}
              <div className="relative flex w-4 shrink-0 items-center justify-center">
                {i > 0 && (
                  <span
                    className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2"
                    style={{ background: steps[i - 1].done ? color : "var(--color-line)" }}
                  />
                )}
                {hasBelow && (
                  <span
                    className="absolute bottom-0 left-1/2 h-1/2 w-px -translate-x-1/2"
                    style={{ background: s.done ? color : "var(--color-line)" }}
                  />
                )}
                <button
                  onClick={() =>
                    patchSteps((st) =>
                      st.map((x) =>
                        x.id === s.id
                          ? {
                              ...x,
                              done: !x.done,
                              // On DATE le franchissement (récit Parcours), on
                              // efface la date si on décoche.
                              doneAt: !x.done ? new Date().toISOString() : undefined,
                            }
                          : x,
                      ),
                    )
                  }
                  title={s.done ? "marquer non fait" : "marquer fait"}
                  className="relative z-10 flex h-4 w-4 items-center justify-center"
                >
                  {s.done ? (
                    <span
                      className="flex h-4 w-4 items-center justify-center rounded-full text-[0.6rem] font-bold text-canvas"
                      style={{ background: color }}
                    >
                      ✓
                    </span>
                  ) : isCurrent ? (
                    <>
                      <span
                        className="absolute inline-flex h-4 w-4 rounded-full opacity-40 motion-safe:animate-ping"
                        style={{ background: color }}
                      />
                      <span
                        className="relative h-3.5 w-3.5 rounded-full border-2 bg-surface"
                        style={{ borderColor: color }}
                      />
                    </>
                  ) : (
                    <span className="h-3 w-3 rounded-full border border-line bg-surface" />
                  )}
                </button>
              </div>
              <div className="flex flex-1 items-center gap-2 py-1.5">
                <InlineEdit
                  value={s.title}
                  onChange={(t) =>
                    patchSteps((st) =>
                      st.map((x) => (x.id === s.id ? { ...x, title: t } : x)),
                    )
                  }
                  className={
                    s.done
                      ? "text-muted"
                      : isCurrent
                        ? "font-medium text-ink"
                        : "text-muted"
                  }
                  inputClassName="text-sm text-ink border-b border-cap/40 w-full bg-transparent focus:outline-none"
                />
                {up && (
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-faint sm:opacity-0 sm:transition-opacity sm:group-hover/step:opacity-100">
                    <button onClick={() => move(i, -1)} title="monter" className="px-0.5 hover:text-ink">↑</button>
                    <button onClick={() => move(i, 1)} title="descendre" className="px-0.5 hover:text-ink">↓</button>
                    <button
                      onClick={() => patchSteps((st) => st.filter((x) => x.id !== s.id))}
                      title="supprimer ce jalon"
                      className="px-0.5 hover:text-red-400"
                    >
                      ×
                    </button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
        {o.unlocks && (
          <li className="flex items-stretch gap-2">
            <div className="relative flex w-4 shrink-0 items-center justify-center">
              <span
                className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2"
                style={{
                  background:
                    steps.length > 0 && steps.every((s) => s.done)
                      ? "var(--color-gold)"
                      : "var(--color-line)",
                }}
              />
              <span className="relative z-10 text-sm text-gold">★</span>
            </div>
            <span className="flex flex-1 items-center py-1.5 text-gold">{o.unlocks}</span>
          </li>
        )}
      </ol>
      {up && (
        <AddInline
          label="ajouter un jalon"
          onAdd={(t) =>
            patchSteps((st) => [...st, { id: newId(), title: t, done: false }])
          }
        />
      )}
    </div>
  );
}

// ── Flux : renommer, changer l'état (clic), libérer une attente, supprimer.
function FlowsEditor({
  o,
  up,
  color,
}: {
  o: Objective;
  up?: (fn: (prev: Objective) => Objective) => void;
  color: string;
}) {
  const flows = o.flows ?? [];
  const patchFlows = (fn: (flows: Flow[]) => Flow[]) =>
    up?.((p) => ({ ...p, flows: fn(p.flows ?? []) }));

  const cycle = (st?: FlowState): FlowState =>
    st === "actif" || st === undefined ? "ralenti" : st === "ralenti" ? "pause" : "actif";

  // Le moteur mérite un panneau à part, VIVANT : c'est souvent le vrai sujet
  // (candidater, prospecter…), pas les jalons de setup. Fond teinté, point
  // d'état qui pulse pour l'actif — l'œil ne le saute plus.
  return (
    <div
      className="rounded-xl border p-3"
      style={{
        background: `color-mix(in srgb, ${color} 6%, var(--color-surface))`,
        borderColor: `color-mix(in srgb, ${color} 25%, var(--color-line))`,
      }}
    >
      <p className="mb-2 text-sm font-semibold" style={{ color }}>
        ⚙ Le moteur
      </p>
      {flows.length === 0 && (
        <p className="text-sm text-faint">
          aucun flux — ce cap n&apos;a pas encore de moteur qui tourne
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {flows.map((f) => {
          const blocked = !!f.waitingOn;
          const st = f.state ?? "actif";
          const live = st === "actif" && !blocked;
          return (
            <li key={f.id} className="group/flow flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                {live && (
                  <span
                    className="absolute inline-flex h-2.5 w-2.5 rounded-full opacity-50 motion-safe:animate-ping"
                    style={{ background: color }}
                  />
                )}
                <span
                  className="relative h-2.5 w-2.5 rounded-full"
                  style={{
                    background: blocked
                      ? "var(--color-gold)"
                      : st === "pause"
                        ? "var(--color-line)"
                        : st === "ralenti"
                          ? "var(--color-gold)"
                          : color,
                    opacity: st === "pause" ? 0.7 : 1,
                  }}
                />
              </span>
              <InlineEdit
                value={f.title}
                onChange={(t) =>
                  patchFlows((fl) =>
                    fl.map((x) => (x.id === f.id ? { ...x, title: t } : x)),
                  )
                }
                className={st === "pause" ? "text-faint" : "font-medium text-ink"}
                inputClassName="text-sm text-ink border-b border-cap/40 w-full bg-transparent focus:outline-none"
              />
              {up ? (
                <button
                  onClick={() =>
                    patchFlows((fl) =>
                      fl.map((x) =>
                        x.id === f.id ? { ...x, state: cycle(x.state) } : x,
                      ),
                    )
                  }
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-medium ${
                    st === "pause"
                      ? "bg-sink text-faint"
                      : st === "ralenti"
                        ? "bg-gold-soft text-gold"
                        : ""
                  }`}
                  style={
                    st === "actif"
                      ? {
                          background: `color-mix(in srgb, ${color} 18%, transparent)`,
                          color,
                        }
                      : undefined
                  }
                  title="cliquer : actif → ralenti → pause"
                >
                  {st}
                </button>
              ) : (
                <span className="text-xs text-faint">{st}</span>
              )}
              {f.waitingOn && (
                <span className="shrink-0 text-xs text-gold">
                  en attente&nbsp;: {f.waitingOn}
                  {up && (
                    <button
                      onClick={() =>
                        patchFlows((fl) =>
                          fl.map((x) =>
                            x.id === f.id ? { ...x, waitingOn: undefined } : x,
                          ),
                        )
                      }
                      className="ml-1 underline decoration-dotted hover:text-cap-ink"
                      title="ce n'est plus bloqué"
                    >
                      libérer
                    </button>
                  )}
                </span>
              )}
              {up && (
                <button
                  onClick={() => patchFlows((fl) => fl.filter((x) => x.id !== f.id))}
                  title="supprimer ce flux"
                  className="ml-auto shrink-0 px-0.5 text-faint hover:text-red-400 sm:opacity-0 sm:transition-opacity sm:group-hover/flow:opacity-100"
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {up && (
        <AddInline
          label="ajouter un flux"
          onAdd={(t) =>
            patchFlows((fl) => [...fl, { id: newId(), title: t, state: "actif" }])
          }
        />
      )}
    </div>
  );
}

// Une ligne « label : valeur » éditable au double-clic, avec son sens en hint.
function EditableMetaLine({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  if (!value && !onChange) return null;
  if (!value) {
    return adding ? (
      <p className="text-faint">
        <span>{label}&nbsp;: </span>
        <AutoInput
          onCommit={(v) => {
            if (v.trim()) onChange?.(v.trim());
            setAdding(false);
          }}
        />
      </p>
    ) : (
      <p className="text-faint">
        {label}&nbsp;:{" "}
        <button
          onClick={() => setAdding(true)}
          className="underline decoration-dotted hover:text-cap-ink"
          title={hint}
        >
          + définir ({hint})
        </button>
      </p>
    );
  }
  return (
    <p className="text-faint" title={hint}>
      {label}&nbsp;:{" "}
      <InlineEdit
        value={value}
        onChange={onChange}
        className="text-muted"
        inputClassName="text-sm text-ink border-b border-cap/40 w-full bg-transparent focus:outline-none"
      />
    </p>
  );
}

function AddInline({
  label,
  onAdd,
}: {
  label: string;
  onAdd: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="mt-1.5 text-xs text-faint transition-colors hover:text-cap-ink"
      >
        + {label}
      </button>
    );
  }
  return (
    <div className="mt-1.5">
      <AutoInput
        onCommit={(v) => {
          if (v.trim()) onAdd(v.trim());
          setEditing(false);
        }}
      />
    </div>
  );
}

function AutoInput({ onCommit }: { onCommit: (v: string) => void }) {
  const [v, setV] = useState("");
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(v);
        if (e.key === "Escape") onCommit("");
      }}
      className="w-full max-w-xs border-b border-cap/40 bg-transparent text-sm text-ink focus:outline-none"
    />
  );
}

// ═════════════ NIVEAU 2 : LA FRISE (passé ← maintenant → futur) ════════════
// Une LIGNE par cap à travers le temps : à gauche le fait (plein ●, daté quand
// on l'a), une ligne « maintenant », à droite les jalons restants (○, pointillé)
// vers la cible (☆) posée à l'horizon. On se SITUE et on se PROJETTE d'un coup.
// On assume l'estimation (l'app sert à FAIRE AVANCER), cadrée « défi » et jamais
// dette : à droite = intentions, si ça glisse on recale.

function activeFlowTitles(o: Objective): string[] {
  return (o.flows ?? [])
    .filter((f) => !f.waitingOn && f.state !== "pause")
    .map((f) => f.title);
}

function mondayOfThisWeek(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// Offset en semaines (signé) entre le lundi d'une date et cette semaine.
function weekOffset(dateIso: string, monday: Date): number {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return 0;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Math.round((d.getTime() - monday.getTime()) / (7 * 86_400_000));
}

type Mark = {
  id: string;
  title: string;
  kind: "done" | "next" | "todo";
  offset: number;
};

// La TRAJECTOIRE chiffrée d'un cap (quand il a un compteur + des relevés) :
// les points réels (30, 60 posés à leur date), la cible, et la PROJECTION au
// rythme réel → date estimée d'atteinte. C'est le concret d'Anis.
interface Traj {
  points: { offset: number; total: number }[]; // réels, triés dans le temps
  target: number;
  label: string;
  ratePerWeek: number | null; // le rythme mesuré (null si < 2 points)
  projTargetOffset: number | null; // offset projeté d'atteinte de la cible
  reached: boolean;
  etaLabel: string | null; // date estimée d'atteinte (« ~14 août »)
  current: number; // le cumul actuel
}

interface Lane {
  o: Objective;
  color: string;
  marks: Mark[];
  targetOffset: number;
  targetLabel: string;
  flows: string[];
  done: number;
  total: number;
  traj?: Traj;
}

function buildTraj(o: Objective, monday: Date): Traj | undefined {
  if (!o.metric || !o.progress?.length) return undefined;
  const pts = o.progress
    .map((p) => ({ offset: weekOffset(p.at, monday), total: p.total }))
    .sort((a, b) => a.offset - b.offset);
  const target = o.metric.target;
  const last = pts[pts.length - 1];
  const first = pts[0];
  let ratePerWeek: number | null = null;
  if (pts.length >= 2 && last.offset > first.offset) {
    ratePerWeek = (last.total - first.total) / (last.offset - first.offset);
  }
  const reached = last.total >= target;
  let projTargetOffset: number | null = null;
  if (reached) projTargetOffset = last.offset;
  else if (ratePerWeek && ratePerWeek > 0)
    projTargetOffset = last.offset + (target - last.total) / ratePerWeek;
  else if (o.deadline) projTargetOffset = weekOffset(o.deadline, monday);
  let etaLabel: string | null = null;
  if (projTargetOffset != null && !reached) {
    const d = new Date(monday);
    d.setDate(d.getDate() + Math.round(projTargetOffset * 7));
    etaLabel = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(d);
  }
  return {
    points: pts,
    target,
    label: o.metric.label,
    ratePerWeek,
    projTargetOffset,
    reached,
    etaLabel,
    current: last.total,
  };
}

function buildLane(o: Objective, color: string, monday: Date): Lane {
  const steps = o.steps ?? [];
  const doneSteps = steps.filter((s) => s.done);
  const undone = steps.filter((s) => !s.done);
  const marks: Mark[] = [];

  // Passé : daté si on a doneAt, sinon rangé juste derrière « maintenant ».
  doneSteps.forEach((s, i) => {
    const offset = s.doneAt
      ? Math.min(-1, weekOffset(s.doneAt, monday))
      : -(doneSteps.length - i);
    marks.push({ id: s.id, title: s.title, kind: "done", offset });
  });

  // Futur : phasage explicite si posé, sinon ~1 semaine chacune depuis maintenant.
  let cursor = 0;
  undone.forEach((s, i) => {
    const offset = s.fromWeek ?? cursor;
    cursor = Math.max(offset, s.toWeek ?? offset) + 1;
    marks.push({ id: s.id, title: s.title, kind: i === 0 ? "next" : "todo", offset });
  });

  // La cible : à l'horizon daté si dispo, sinon juste après le dernier jalon.
  const futureOffs = marks.filter((m) => m.kind !== "done").map((m) => m.offset);
  const lastFuture = futureOffs.length ? Math.max(...futureOffs) : 0;
  const targetOffset = o.deadline
    ? Math.max(lastFuture + 1, weekOffset(o.deadline, monday))
    : lastFuture + 1;
  const targetLabel = o.horizon || o.target || o.unlocks || "ta cible";

  return {
    o,
    color,
    marks,
    targetOffset,
    targetLabel,
    flows: activeFlowTitles(o),
    done: doneSteps.length,
    total: steps.length,
    traj: buildTraj(o, monday),
  };
}

// Géométrie de la frise : px par semaine (selon le zoom), marge intérieure et
// hauteurs partagées. Toutes les cartes lisent le MÊME x() → un seul axe temps.
const FRISE_UNIT = { jour: 150, semaine: 76, mois: 30 } as const;
const GUTTER = 30;
const RULER_H = 38;
const TRACK_H = 70;
const LINE_Y = 34;

function TimelineView({
  objectives,
  onOpen,
  onDeleteCap,
  onUpdateObjective,
  colorOf,
}: CarteProps & { colorOf: (id: string) => string }) {
  const [zoom, setZoom] = useState<"jour" | "semaine" | "mois">("semaine");
  const unit = FRISE_UNIT[zoom];

  const monday = mondayOfThisWeek();
  const lanes = objectives.map((o) => buildLane(o, colorOf(o.id), monday));

  // L'étendue de l'axe = l'union de TOUS les caps → une seule règle partagée.
  const offs = lanes.flatMap((l) => [
    ...l.marks.map((m) => m.offset),
    l.targetOffset,
    ...(l.traj ? l.traj.points.map((p) => p.offset) : []),
    ...(l.traj?.projTargetOffset != null ? [l.traj.projTargetOffset] : []),
  ]);
  const minOff = Math.min(0, ...offs) - 1;
  const maxOff = Math.max(Math.max(2, ...offs) + 1, minOff + 8);
  const N = maxOff - minOff;
  const x = (offset: number) => GUTTER + (offset - minOff) * unit;
  const trackW = GUTTER * 2 + N * unit;

  // Les semaines regroupées par mois → les bandeaux de la règle.
  const weeks = Array.from({ length: N + 1 }, (_, i) => {
    const ws = new Date(monday);
    ws.setDate(monday.getDate() + (minOff + i) * 7);
    return { i, month: ws.getMonth() };
  });
  const monthGroups: { month: number; start: number; span: number }[] = [];
  for (const w of weeks) {
    const last = monthGroups[monthGroups.length - 1];
    if (last && last.month === w.month) last.span++;
    else monthGroups.push({ month: w.month, start: w.i, span: 1 });
  }

  return (
    <div className="animate-rise rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <p className="text-xs uppercase tracking-[0.15em] text-faint">
          Tes caps dans le temps
        </p>
        <div className="inline-flex gap-0.5 rounded-full border border-line bg-surface p-0.5 text-xs shadow-sm">
          {(["jour", "semaine", "mois"] as const).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`rounded-full px-2.5 py-0.5 transition-colors ${
                zoom === z ? "bg-ink text-canvas" : "text-muted hover:text-ink"
              }`}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      <div className="-mx-1 overflow-x-auto px-1 pb-2">
        <div className="relative" style={{ minWidth: trackW }}>
          {/* La règle des mois — l'axe temps commun, posé une fois en haut. */}
          <div className="relative" style={{ height: RULER_H }}>
            {monthGroups.map((g, i) => (
              <div
                key={i}
                className="absolute bottom-0 flex items-end border-l border-line pb-1 pl-2 text-xs font-medium text-muted"
                style={{ left: x(minOff + g.start), height: RULER_H - 4 }}
              >
                {MONTHS[g.month]}
              </div>
            ))}
            <div
              className="absolute top-0 -translate-x-1/2 rounded-full px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-wide text-cap-ink"
              style={{ left: x(0), background: "var(--color-cap-soft)" }}
            >
              maintenant
            </div>
          </div>

          {/* La ligne « maintenant » traverse toute la pile : c'est elle qu'on
              ressent comme l'axe partagé entre les cartes. */}
          <div
            className="pointer-events-none absolute z-20"
            style={{ left: x(0) - 1, top: RULER_H, bottom: 0, width: 2, background: "var(--color-cap)", opacity: 0.25 }}
          />

          {/* Une carte par cap — qualité Chemins — toutes calées sur le même x(). */}
          <div className="flex flex-col gap-2.5">
            {lanes.map((l) => (
              <FriseCard
                key={l.o.id}
                lane={l}
                x={x}
                trackW={trackW}
                onOpen={onOpen}
                onDelete={onDeleteCap ? () => onDeleteCap(l.o.id) : undefined}
                onEditTitle={
                  onUpdateObjective
                    ? (t) => onUpdateObjective(l.o.id, (p) => ({ ...p, title: t }))
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      </div>

      <p className="mt-3 px-1 text-[0.7rem] leading-relaxed text-faint">
        Caps chiffrés : les points = ce que t&apos;as accumulé (30, 60…), le
        pointillé = la projection à ton rythme, ★ la cible + date estimée. Caps à
        jalons : ● fait · ◉ le prochain · ○ à venir · ☆ cible. À droite = des
        intentions, pas des dates dures.
      </p>
    </div>
  );
}

// La carte d'un cap dans la frise — même traitement que « Chemins » (liseré
// coloré, tuile-icône, titre en gras, fond teinté) mais posée sur l'axe temps
// commun : l'étiquette reste épinglée à gauche, la piste s'étend sur l'axe.
function FriseCard({
  lane,
  x,
  trackW,
  onOpen,
  onDelete,
  onEditTitle,
}: {
  lane: Lane;
  x: (o: number) => number;
  trackW: number;
  onOpen: () => void;
  onDelete?: () => void;
  onEditTitle?: (t: string) => void;
}) {
  const { o, color, traj, marks, total, done, flows } = lane;
  const counter = traj
    ? `${traj.current}/${traj.target} ${traj.label}`
    : total > 0
      ? `${done}/${total} jalons`
      : null;

  return (
    <section
      className="group relative overflow-hidden rounded-2xl border border-line shadow-sm"
      style={{
        width: trackW,
        borderLeft: `4px solid ${color}`,
        background: `color-mix(in srgb, ${color} 5%, var(--color-surface))`,
      }}
    >
      {/* Étiquette épinglée : reste lisible même quand on défile l'axe. */}
      <div className="sticky left-0 z-10 flex w-fit max-w-[88vw] items-center gap-3 px-4 pt-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg leading-none"
          style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}
        >
          {o.icon ?? "◆"}
        </span>
        <div className="min-w-0">
          <InlineEdit
            value={o.title}
            onChange={onEditTitle}
            className="block truncate font-display text-lg font-medium text-ink"
            inputClassName="font-display text-lg font-medium text-ink border-b border-cap/40 w-56"
          />
          {flows.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-muted" style={{ maxWidth: 260 }}>
              <span style={{ color }}>⚙</span> {flows.join(" · ")}
            </p>
          )}
        </div>
        {counter && (
          <span
            className="ml-1 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
          >
            {counter}
          </span>
        )}
        {traj?.etaLabel && !traj.reached && (
          <span className="shrink-0 text-[0.7rem] text-faint">≈ {traj.etaLabel}</span>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="shrink-0 px-1 text-faint opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
            title="Supprimer ce cap"
          >
            ×
          </button>
        )}
      </div>

      {/* La piste — calée sur l'axe commun via x(). */}
      <div className="relative" style={{ height: TRACK_H }}>
        {traj ? (
          <TrajTrack traj={traj} x={x} color={color} />
        ) : marks.length > 0 ? (
          <MarksTrack lane={lane} x={x} />
        ) : (
          <EmptyTrack lane={lane} x={x} onOpen={onOpen} />
        )}
      </div>
    </section>
  );
}

// La COURBE chiffrée : points réels (30, 60…) datés & reliés, projection au
// rythme (pointillé) → cible ★ + date estimée. Le concret qui se place dans le temps.
function TrajTrack({
  traj,
  x,
  color,
}: {
  traj: Traj;
  x: (o: number) => number;
  color: string;
}) {
  const pts = traj.points;
  const firstX = x(pts[0].offset);
  const lastX = x(pts[pts.length - 1].offset);
  const projX = traj.projTargetOffset != null ? x(traj.projTargetOffset) : null;
  const targetX = projX != null && projX > lastX ? projX : lastX + 40;
  return (
    <>
      {pts.length > 1 && (
        <div
          className="absolute rounded-full"
          style={{ left: firstX, top: LINE_Y, width: Math.max(0, lastX - firstX), height: 3, transform: "translateY(-50%)", background: color, opacity: 0.75 }}
        />
      )}
      {projX != null && projX > lastX && (
        <div
          className="absolute"
          style={{ left: lastX, top: LINE_Y, width: projX - lastX, height: 0, borderTop: `2px dashed ${color}`, opacity: 0.5 }}
        />
      )}
      {traj.ratePerWeek != null && !traj.reached && projX != null && projX > lastX && (
        <div
          className="absolute -translate-x-1/2 truncate text-center text-[0.6rem]"
          style={{ left: (lastX + projX) / 2, top: LINE_Y - 20, width: Math.max(60, projX - lastX), color }}
        >
          ≈ {Math.round(traj.ratePerWeek * 10) / 10}/sem
        </div>
      )}
      {pts.map((p, i) => {
        const isLast = i === pts.length - 1;
        return (
          <div
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: x(p.offset), top: LINE_Y, zIndex: 2 }}
            title={`${p.total} ${traj.label}`}
          >
            <span
              className="block rounded-full"
              style={{
                height: isLast ? 15 : 12,
                width: isLast ? 15 : 12,
                background: color,
                boxShadow: isLast ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${color}` : undefined,
              }}
            />
            {/* Les chiffres AU-DESSUS de la ligne (la cible est en dessous). */}
            <span
              className={`absolute left-1/2 -translate-x-1/2 text-center text-[0.66rem] ${isLast ? "font-bold text-ink" : "text-muted"}`}
              style={{ bottom: 12 }}
            >
              {p.total}
            </span>
          </div>
        );
      })}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: targetX, top: LINE_Y, zIndex: 2 }}
        title={`cible : ${traj.target} ${traj.label}`}
      >
        <span
          className="flex items-center justify-center rounded-full"
          style={{
            height: 24,
            width: 24,
            background: traj.reached ? color : "var(--color-surface)",
            border: `2px solid ${color}`,
            color: traj.reached ? "var(--color-canvas)" : color,
            fontSize: "0.85rem",
          }}
        >
          ★
        </span>
        <span
          className="absolute left-1/2 w-24 -translate-x-1/2 text-center text-[0.6rem] font-medium leading-tight"
          style={{ top: 15, color }}
        >
          {traj.target} {traj.label}
          {traj.etaLabel && !traj.reached && <span className="block text-faint">≈ {traj.etaLabel}</span>}
          {traj.reached && <span className="block text-faint">atteint 🎉</span>}
        </span>
      </div>
    </>
  );
}

// La piste à JALONS (caps non chiffrés) : une jauge posée sur l'axe temps,
// remplie vers la cible ☆, avec les marques ● fait · ◉ prochain · ○ à venir.
function MarksTrack({ lane, x }: { lane: Lane; x: (o: number) => number }) {
  const { o, color, marks, targetOffset, targetLabel, done, total } = lane;
  const doneMarks = marks.filter((m) => m.kind === "done");
  const pastStart = doneMarks.length ? Math.min(...doneMarks.map((m) => m.offset)) : 0;
  const leftX = Math.min(x(pastStart), x(0));
  const targetX = x(targetOffset);
  const frac = total ? done / total : 0;
  const fillX = leftX + frac * (targetX - leftX);
  return (
    <>
      <div
        className="absolute rounded-full"
        style={{ left: leftX, top: LINE_Y, width: Math.max(0, targetX - leftX), height: 7, transform: "translateY(-50%)", background: `color-mix(in srgb, ${color} 14%, var(--color-surface))` }}
      />
      <div
        className="absolute rounded-full transition-all"
        style={{ left: leftX, top: LINE_Y, width: Math.max(0, fillX - leftX), height: 7, transform: "translateY(-50%)", background: color, opacity: 0.85 }}
      />
      {marks.map((m, i) => (
        <div
          key={m.id}
          title={m.title}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: x(m.offset), top: LINE_Y, zIndex: m.kind === "next" ? 3 : 2 }}
        >
          {m.kind === "done" ? (
            <span className="block rounded-full" style={{ height: 14, width: 14, background: color }} />
          ) : m.kind === "next" ? (
            <span className="relative flex items-center justify-center" style={{ height: 22, width: 22 }}>
              <span className="absolute inline-flex h-full w-full rounded-full opacity-30 motion-safe:animate-ping" style={{ background: color }} />
              <span className="relative rounded-full bg-surface" style={{ height: 18, width: 18, border: `3px solid ${color}` }} />
            </span>
          ) : (
            <span className="block rounded-full bg-surface" style={{ height: 12, width: 12, border: `2px solid ${color}`, opacity: 0.6 }} />
          )}
          <span
            className={`absolute left-1/2 w-[5rem] -translate-x-1/2 text-center text-[0.6rem] leading-tight ${
              m.kind === "next" ? "font-semibold text-ink" : m.kind === "done" ? "text-muted" : "text-faint"
            }`}
            style={{ top: i % 2 === 1 ? 16 : -24 }}
          >
            {m.title.length > 34 ? `${m.title.slice(0, 33)}…` : m.title}
          </span>
        </div>
      ))}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: targetX, top: LINE_Y, zIndex: 2 }}
        title={o.target ? `cible : ${o.target}` : targetLabel}
      >
        <span
          className="flex items-center justify-center rounded-full bg-surface"
          style={{ height: 22, width: 22, border: `2px solid ${color}`, color, fontSize: "0.8rem" }}
        >
          ☆
        </span>
        <span
          className="absolute left-1/2 w-24 -translate-x-1/2 text-center text-[0.6rem] font-medium leading-tight"
          style={{ top: 14, color }}
        >
          {targetLabel.length > 30 ? `${targetLabel.slice(0, 29)}…` : targetLabel}
        </span>
      </div>
    </>
  );
}

// La piste VIDE — jamais un blanc cassé : une trajectoire en pointillé de
// « maintenant » vers une cible ☆ ouverte, et l'invite à la cartographier.
function EmptyTrack({
  lane,
  x,
  onOpen,
}: {
  lane: Lane;
  x: (o: number) => number;
  onOpen: () => void;
}) {
  const { color, targetOffset, targetLabel } = lane;
  const leftX = x(0);
  const targetX = x(targetOffset);
  return (
    <>
      <div
        className="absolute"
        style={{ left: leftX, top: LINE_Y, width: Math.max(24, targetX - leftX), height: 0, borderTop: `2px dashed ${color}`, opacity: 0.4, transform: "translateY(-50%)" }}
      />
      <div
        className="absolute text-xs italic text-faint"
        style={{ left: leftX + 10, top: 8 }}
      >
        à cartographier —{" "}
        <button onClick={onOpen} className="underline decoration-dotted hover:text-cap-ink">
          parles-en avec Cap
        </button>
      </div>
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: targetX, top: LINE_Y }}
      >
        <span
          className="flex items-center justify-center rounded-full bg-surface"
          style={{ height: 22, width: 22, border: `2px dashed ${color}`, color, fontSize: "0.8rem", opacity: 0.7 }}
        >
          ☆
        </span>
        <span
          className="absolute left-1/2 w-24 -translate-x-1/2 text-center text-[0.6rem] font-medium leading-tight"
          style={{ top: 14, color, opacity: 0.8 }}
        >
          {targetLabel.length > 30 ? `${targetLabel.slice(0, 29)}…` : targetLabel}
        </span>
      </div>
    </>
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
        onClick={(e) => e.stopPropagation()}
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
