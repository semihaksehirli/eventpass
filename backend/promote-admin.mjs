import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const email = process.argv[2]?.trim();
if (!email) {
  console.error("Usage: node backend/promote-admin.mjs <registered-organizer-email>");
  process.exit(1);
}
const databasePath = process.env.EVENTPASS_DB ??
  fileURLToPath(new URL("./eventpass.sqlite", import.meta.url));
const db = new DatabaseSync(databasePath);

try {
  db.exec("BEGIN IMMEDIATE");
  const account = db.prepare(`
    UPDATE Users SET Role = 'Admin'
    WHERE Email = ? AND Role = 'Organizer' AND PasswordHash IS NOT NULL
    RETURNING UserID, Email
  `).get(email);
  if (!account) throw new Error("Register an organizer account before promoting it.");
  db.prepare("DELETE FROM Sessions WHERE UserID = ?").run(account.UserID);
  db.exec("COMMIT");
  console.log(`Promoted ${account.Email} to Admin. Sign in again for an admin session.`);
} catch (error) {
  if (db.isTransaction) db.exec("ROLLBACK");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
