/**
 * There is no email on the hill, so a forgotten password is the operator's to fix:
 *
 *   npx tsx scripts/reset-password.ts <name> <new password> [path to the register]
 *
 * The register defaults to data/anamnesia.sqlite. Every session of that name is ended.
 */
import { hashPassword } from '../server/auth.ts';
import { openDatabase } from '../server/db.ts';
import { nameKey } from '../server/register.ts';
import { PasswordSchema } from '../src/api/protocol.ts';

const [name, password, path = 'data/anamnesia.sqlite'] = process.argv.slice(2);
if (!name || !password) {
  console.error('usage: reset-password <name> <new password> [register path]');
  process.exit(2);
}
const checked = PasswordSchema.safeParse(password);
if (!checked.success) {
  console.error(`password: ${checked.error.issues[0]?.message ?? 'invalid'}`);
  process.exit(2);
}
const db = openDatabase(path);
const user = db.prepare('SELECT id, name FROM users WHERE name_key = ?').get(nameKey(name)) as
  { id: number; name: string } | undefined;
if (!user) {
  console.error(`no one called "${name}" in ${path}`);
  process.exit(1);
}
db.prepare('UPDATE users SET password = ? WHERE id = ?').run(await hashPassword(password), user.id);
db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
db.close();
console.log(`${user.name}: password changed, every session ended`);
