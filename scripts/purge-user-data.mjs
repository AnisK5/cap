import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync('/Users/anisk/cap/.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
for (const t of ['sessions','state_snapshots','states']) {
  const { error, count } = await admin.from(t).delete({ count: 'exact' }).not('user_id','is',null);
  console.log(t, error ? 'ERR '+error.message : `purgé (${count})`);
}
