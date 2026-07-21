import type { SupabaseClient } from "@supabase/supabase-js";
import type { CapState, ChatMessage } from "./types";

// Accès données. L'état reste un blob CapState (jsonb) : le modèle produit
// bouge encore, on ne normalise pas prématurément.

export interface StoredState {
  state: CapState;
  updatedAt: string;
}

export async function getState(
  supabase: SupabaseClient,
  userId: string,
): Promise<StoredState | null> {
  const { data, error } = await supabase
    .from("states")
    .select("data, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Lecture de l'état : ${error.message}`);
  return data
    ? { state: data.data as CapState, updatedAt: data.updated_at as string }
    : null;
}

// Écrit l'état. Si `expectedUpdatedAt` est fourni et que l'état a bougé entre
// temps (écriture concurrente), renvoie null : au caller de relire et refaire
// sa fusion. Avant la première écriture du jour, l'état sortant est snapshoté.
export async function putState(
  supabase: SupabaseClient,
  userId: string,
  state: CapState,
  expectedUpdatedAt?: string,
): Promise<StoredState | null> {
  const current = await getState(supabase, userId);

  if (expectedUpdatedAt && current && current.updatedAt !== expectedUpdatedAt) {
    return null;
  }

  if (current) await snapshotDaily(supabase, userId, current.state);

  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from("states").upsert({
    user_id: userId,
    data: state,
    updated_at: updatedAt,
  });
  if (error) throw new Error(`Écriture de l'état : ${error.message}`);
  return { state, updatedAt };
}

// Backup quotidien : conserve l'état tel qu'il était AVANT la première
// écriture du jour (on conflict do nothing), purge au-delà de 30 jours.
async function snapshotDaily(
  supabase: SupabaseClient,
  userId: string,
  outgoing: CapState,
) {
  const day = new Date().toISOString().slice(0, 10);
  await supabase
    .from("state_snapshots")
    .upsert(
      { user_id: userId, day, data: outgoing },
      { onConflict: "user_id,day", ignoreDuplicates: true },
    );
  const cutoff = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await supabase
    .from("state_snapshots")
    .delete()
    .eq("user_id", userId)
    .lt("day", cutoff);
}

// --- Sessions Au clair ---

export interface StoredSession {
  id: string;
  startedAt: string;
  messages: ChatMessage[];
  landed: boolean;
}

// La session ouverte « du jour » = non atterrie et récente (< 12 h) : c'est
// elle qu'on reprend après un refresh. Fenêtre glissante plutôt que minuit —
// le serveur déployé vit en UTC, pas dans le fuseau de la personne.
export async function getOpenSessionToday(
  supabase: SupabaseClient,
  userId: string,
): Promise<StoredSession | null> {
  const startOfDay = new Date(Date.now() - 12 * 3600_000);
  const { data, error } = await supabase
    .from("sessions")
    .select("id, started_at, messages, landed")
    .eq("user_id", userId)
    .eq("landed", false)
    .gte("started_at", startOfDay.toISOString())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Lecture de la session : ${error.message}`);
  return data
    ? {
        id: data.id as string,
        startedAt: data.started_at as string,
        messages: (data.messages ?? []) as ChatMessage[],
        landed: data.landed as boolean,
      }
    : null;
}

export async function getSessionById(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<StoredSession | null> {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, started_at, messages, landed")
    .eq("user_id", userId)
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(`Lecture de la session : ${error.message}`);
  return data
    ? {
        id: data.id as string,
        startedAt: data.started_at as string,
        messages: (data.messages ?? []) as ChatMessage[],
        landed: data.landed as boolean,
      }
    : null;
}

export async function createSession(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("sessions")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (error) throw new Error(`Création de session : ${error.message}`);
  return data.id as string;
}

export async function saveSessionMessages(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  messages: ChatMessage[],
  landed = false,
) {
  const { error } = await supabase
    .from("sessions")
    .update({
      messages,
      landed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", userId);
  if (error) throw new Error(`Sauvegarde de session : ${error.message}`);
}
