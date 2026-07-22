// Inspection de la STRUCTURE de l'état (volumes, longueurs) pour designer
// contre la réalité — n'affiche pas le contenu intégral.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await admin.from('states').select('data').limit(1).maybeSingle();
if (!data) { console.log('aucun état'); process.exit(0); }
const s = data.data;
for (const o of s.objectives) {
  console.log(`CAP "${o.title}" (${(o.icon??'')}) target=${o.target? '«'+o.target+'»':'—'} horizon=${o.horizon??'—'} unlocks=${o.unlocks? o.unlocks.length+'c':'—'} deadline=${o.deadline??'—'}`);
  console.log(`  steps: ${(o.steps??[]).map(st=>`[${st.done?'x':' '}]${st.title}(${st.title.length}c)`).join(' → ') || '—'}`);
  console.log(`  flows: ${(o.flows??[]).map(f=>`${f.title}(${f.state??'actif'}${f.waitingOn?',wait':''})`).join(' · ') || '—'}`);
}
console.log('priorités:', s.priorities.map(p=>p.title));
console.log('notes ctx:', (s.contextNotes??[]).length);
