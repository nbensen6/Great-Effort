// Manage user roles from the server itself, rather than exposing an HTTP route.
//
//   node scripts/admin.js                    list users and roles
//   node scripts/admin.js promote <username> make them admin
//   node scripts/admin.js demote  <username> back to player
//
//   fly ssh console -C "node scripts/admin.js" --app tge-lol-team
//
// Role changes are otherwise admin-only over the API (PATCH /auth/users/:id/role),
// so this is the way to appoint the first admin without a public endpoint.

require('dotenv').config();
const db = require('../database/db');

const [, , command, username] = process.argv;

function list() {
  const users = db.prepare(`
    SELECT u.id, u.username, u.email, u.role, u.created_at,
           (SELECT summoner_name FROM players WHERE user_id = u.id) AS roster_card
    FROM users u ORDER BY u.id
  `).all();

  if (!users.length) {
    console.log('No users registered yet. The first account to register becomes admin.');
    return;
  }
  console.log(`${users.length} user(s):`);
  for (const u of users) {
    console.log(
      `  #${u.id}  ${u.username.padEnd(16)} ${u.role.padEnd(7)}` +
      ` card=${u.roster_card || '-'}  registered=${u.created_at}`
    );
  }
  const admins = users.filter(u => u.role === 'admin');
  console.log(`\n${admins.length} admin(s): ${admins.map(a => a.username).join(', ') || 'none'}`);
}

function setRole(name, role) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(name);
  if (!user) {
    console.error(`No user named "${name}".`);
    process.exit(1);
  }
  if (role === 'player') {
    const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get().c;
    if (user.role === 'admin' && admins <= 1) {
      console.error('Refusing to demote the only admin — nobody could promote anyone afterwards.');
      process.exit(1);
    }
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  console.log(`${user.username}: ${user.role} -> ${role}`);
}

if (command === 'promote') setRole(username, 'admin');
else if (command === 'demote') setRole(username, 'player');
else list();
