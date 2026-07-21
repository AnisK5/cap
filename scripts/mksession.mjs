// Crée l'utilisateur (email confirmé) et fabrique une session pour smoke-tester
// les routes API cookie-based. Sortie : la valeur du cookie sb-...-auth-token.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('/Users/anisk/cap/.env.local', 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY);
const email = 'krari.anis@gmail.com';
const password = crypto.randomUUID() + 'Aa1!';

let { data: created, error } = await admin.auth.admin.createUser({
  email, password, email_confirm: true,
});
if (error && !/already/i.test(error.message)) throw error;
if (error) {
  // utilisateur déjà là : maj du mot de passe pour pouvoir ouvrir la session de test
  const { data: list } = await admin.auth.admin.listUsers();
  const u = list.users.find(u => u.email === email);
  await admin.auth.admin.updateUserById(u.id, { password });
}

const anon = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const { data: signed, error: e2 } = await anon.auth.signInWithPassword({ email, password });
if (e2) throw e2;
const cookie = 'base64-' + Buffer.from(JSON.stringify(signed.session)).toString('base64url');
console.log(cookie);
