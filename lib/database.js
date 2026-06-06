import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = process.env.DATA_DIR || './data';
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(path.join(dataDir, 'ernie.db'));
db.pragma('journal_mode = WAL');

// Migrations / Table Creation
db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        acs_token TEXT NOT NULL,
        sign TEXT NOT NULL,
        jt TEXT,
        cookie_string TEXT NOT NULL,
        active INTEGER DEFAULT 1,
        request_count INTEGER DEFAULT 0,
        last_used DATETIME
    );
`);

export function getNextAccount() {
    return db.prepare(`SELECT * FROM accounts WHERE active = 1 ORDER BY last_used ASC NULLS FIRST LIMIT 1`).get();
}



export function bumpAccountUsage(id) {
    db.prepare(`UPDATE accounts SET request_count = request_count + 1, last_used = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
}

export function disableAccount(id) {
    db.prepare(`UPDATE accounts SET active = 0 WHERE id = ?`).run(id);
}
