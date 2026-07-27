"use client";

import { useRef, useState } from "react";
import type { Flow, FlowState, Habit, Objective, Step } from "@/lib/types";
import { newId } from "@/lib/merge";
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

const LABEL_W = 210;
const WEEK_W = 52;
const ROW_H = 34;
const HEADER_H = 46;
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
  onUpdateObjective?: UpdateObjective;
  onUpdateHabits?: UpdateHabits;
  onClean?: () => void;
  cleaning?: boolean;
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
      <div className="mb-5 flex items-center justify-between gap-3">
        {props.onClean ? (
          <button
            onClick={props.onClean}
            disabled={props.cleaning}
            title="L'IA range la carte : fusionne les doublons et raccourcit les titres à rallonge, sans rien perdre"
            className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted shadow-sm transition-colors hover:text-ink disabled:opacity-40"
          >
            {props.cleaning ? "Nettoyage…" : "✨ Nettoyer"}
          </button>
        ) : (
          <span />
        )}
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
          colorOf={(id) => capColor(props.objectives, id)}
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
      {objectives.map((o) => (
        <CapPath
          key={o.id}
          o={o}
          color={colorOf(o.id)}
          open={openIds.has(o.id)}
          onToggle={() => toggle(o.id)}
          onOpen={onOpen}
          onDelete={onDeleteCap ? () => onDeleteCap(o.id) : undefined}
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
  onUpdate,
  onSeeWeeks,
}: {
  o: Objective;
  color: string;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete?: () => void;
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
    <section className="animate-rise mb-3">
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

// ═════════════════════ NIVEAU 2 : SEMAINES (projection) ═══════════════════
// La frise projette la SÉQUENCE DES ÉTAPES (les jalons sont séquentiels par
// nature) : le jalon courant « maintenant », les suivants déroulés devant, pour
// se projeter et sentir l'enjeu d'aujourd'hui. Estimations LARGES (≈ 1 semaine
// par étape si le phasage n'est pas posé), jamais des dates. Les flux (continus)
// ne sont PAS mis en barres — ça mentirait sur leur nature : rappelés en légende.

interface StepBar {
  id: string;
  title: string;
  fromWeek: number;
  toWeek: number;
  current: boolean; // le prochain jalon à franchir
}

// Projette les étapes NON franchies en séquence. Honore le phasage explicite
// (fromWeek/toWeek) s'il est posé, sinon déroule ~1 semaine chacune depuis
// « cette semaine » (0). Les jalons franchis sont derrière : pas sur la frise.
function projectSteps(o: Objective): StepBar[] {
  const undone = (o.steps ?? []).filter((s) => !s.done);
  const bars: StepBar[] = [];
  let cursor = 0;
  undone.forEach((s, i) => {
    const from = s.fromWeek ?? cursor;
    const to = Math.max(from, s.toWeek ?? from);
    bars.push({ id: s.id, title: s.title, fromWeek: from, toWeek: to, current: i === 0 });
    cursor = to + 1;
  });
  return bars;
}

function activeFlowTitles(o: Objective): string[] {
  return (o.flows ?? [])
    .filter((f) => !f.waitingOn && f.state !== "pause")
    .map((f) => f.title);
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
  onUpdateObjective,
  colorOf,
}: CarteProps & { colorOf: (id: string) => string }) {
  const groups = objectives.map((o) => ({
    o,
    color: colorOf(o.id),
    steps: projectSteps(o),
    flows: activeFlowTitles(o),
  }));

  const allBars = groups.flatMap((g) => g.steps);
  const maxTo = Math.max(4, ...allBars.map((b) => b.toWeek));
  const N = Math.min(16, Math.max(8, maxTo + 2));

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
          {groups.map(({ o, color, steps, flows }) => (
            <ObjectiveGroup
              key={o.id}
              o={o}
              color={color}
              steps={steps}
              flows={flows}
              N={N}
              onOpen={onOpen}
              onDelete={onDeleteCap ? () => onDeleteCap(o.id) : undefined}
              onEditTitle={
                onUpdateObjective
                  ? (t) => onUpdateObjective(o.id, (p) => ({ ...p, title: t }))
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
  steps,
  flows,
  N,
  onOpen,
  onDelete,
  onEditTitle,
}: {
  o: Objective;
  color: string;
  steps: StepBar[];
  flows: string[];
  N: number;
  onOpen: () => void;
  onDelete?: () => void;
  onEditTitle?: (title: string) => void;
}) {
  const chip = deadlineChip(o);
  const momentum = momentumLabel(o);
  const asleep = momentum?.startsWith("dort");

  const allSteps = o.steps ?? [];
  const total = allSteps.length;
  const doneCount = allSteps.filter((s) => s.done).length;

  return (
    <div className="group mt-5 border-t border-line/70 pt-3 first:mt-2 first:border-t-0">
      {/* En-tête de l'objectif — posé AU-DESSUS des lignes de mois (z-10 +
          fond), sinon les lignes le traversent. */}
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
          {total > 0 && (
            <span
              className="rounded-full bg-sink px-2 py-0.5 text-[0.68rem] font-medium text-muted"
              title="jalons franchis"
            >
              {doneCount}/{total} jalons
            </span>
          )}
          {o.target ? (
            <span
              className="max-w-[10rem] truncate rounded-full bg-sink px-2 py-0.5 text-[0.68rem] text-muted"
              title={`cible : ${o.target}`}
            >
              🎯 {o.target}
            </span>
          ) : (
            <button
              onClick={onOpen}
              className="text-[0.68rem] text-faint underline decoration-dotted hover:text-cap-ink"
            >
              cible à définir
            </button>
          )}
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

      {/* La projection des jalons : le courant « maintenant », les suivants devant. */}
      {steps.length === 0 ? (
        total > 0 ? (
          <p className="pl-1 text-xs italic text-faint">
            tous les jalons sont franchis ✓
          </p>
        ) : (
          <p className="pl-1 text-xs italic text-faint">
            à cartographier —{" "}
            <button
              onClick={onOpen}
              className="underline decoration-dotted hover:text-cap-ink"
            >
              parles-en avec Cap
            </button>
          </p>
        )
      ) : (
        steps.map((b) => <StepRow key={b.id} bar={b} N={N} color={color} />)
      )}

      {/* Le moteur (flux continus) en légende — pas en barres : un flux est un
          débit, pas une période ; le mettre en Gantt mentirait sur sa nature. */}
      {flows.length > 0 && (
        <p className="mt-1.5 pl-1 text-[0.7rem] text-faint">
          <span className="text-muted">moteur en continu&nbsp;:</span>{" "}
          {flows.join(" · ")}
        </p>
      )}
    </div>
  );
}

// Une ligne de la projection : le libellé du jalon (le courant marqué ◉) et sa
// barre sur la frise. Le jalon courant est plus appuyé, les suivants estompés.
function StepRow({
  bar,
  N,
  color,
}: {
  bar: StepBar;
  N: number;
  color: string;
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
        <span className={bar.current ? "font-medium text-ink" : "text-muted"}>
          {bar.current && <span className="mr-1 text-cap">◉</span>}
          {bar.title}
        </span>
      </div>
      <div className="relative" style={{ width: N * WEEK_W, height: "100%" }}>
        <div
          className="absolute top-1/2 rounded-full"
          style={{
            left: left + 3,
            width,
            height: 10,
            transform: "translateY(-50%)",
            background: color,
            opacity: bar.current ? 0.55 : 0.28,
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
