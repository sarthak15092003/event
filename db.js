const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'database.sqlite'));

db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member', -- 'manager' or 'member'
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_key TEXT UNIQUE NOT NULL,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT DEFAULT 'Task', -- 'Story', 'Bug', 'Task'
    status TEXT DEFAULT 'TO DO', -- 'TO DO', 'IN PROGRESS', 'IN REVIEW', 'DONE'
    priority TEXT DEFAULT 'Medium', -- 'Highest', 'High', 'Medium', 'Low', 'Lowest'
    assignee_id INTEGER,
    reporter_id INTEGER NOT NULL,
    original_estimate_hours REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id),
    FOREIGN KEY(assignee_id) REFERENCES users(id),
    FOREIGN KEY(reporter_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS worklogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    time_spent_hours REAL NOT NULL,
    work_date TEXT NOT NULL, -- YYYY-MM-DD
    description TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    manager_note TEXT,
    reviewed_by INTEGER,
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(reviewed_by) REFERENCES users(id)
  );
`);

// Seed default users if empty
const userCount = db.prepare('SELECT count(*) as count FROM users').get().count;
if (userCount === 0) {
  const hash = bcrypt.hashSync('password123', 10);
  
  // Manager
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password, role, avatar)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const mId = insertUser.run('Alex Manager', 'manager@jira.local', hash, 'manager', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex').lastInsertRowid;
  const d1Id = insertUser.run('Sarah Developer', 'sarah@jira.local', hash, 'member', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah').lastInsertRowid;
  const d2Id = insertUser.run('David Engineer', 'david@jira.local', hash, 'member', 'https://api.dicebear.com/7.x/avataaars/svg?seed=David').lastInsertRowid;

  // Insert Project
  const insertProject = db.prepare(`INSERT INTO projects (key, name, description, created_by) VALUES (?, ?, ?, ?)`);
  const projId = insertProject.run('PROJ', 'NextGen Platform', 'Core enterprise platform rewrite', mId).lastInsertRowid;

  // Insert Issues
  const insertIssue = db.prepare(`
    INSERT INTO issues (issue_key, project_id, title, description, type, status, priority, assignee_id, reporter_id, original_estimate_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const i1 = insertIssue.run('PROJ-101', projId, 'Design Authentication & JWT Session flow', 'Implement refresh tokens, RBAC permissions and session invalidation.', 'Story', 'DONE', 'High', d1Id, mId, 16).lastInsertRowid;
  const i2 = insertIssue.run('PROJ-102', projId, 'Create Interactive Worklog Approval Dashboard', 'Managers should be able to approve, reject with feedback, and filter logs by user/date range.', 'Story', 'IN PROGRESS', 'Highest', d1Id, mId, 24).lastInsertRowid;
  const i3 = insertIssue.run('PROJ-103', projId, 'Optimize database queries for timesheet export', 'Add indexes and compute summaries efficiently for high-volume logs.', 'Task', 'IN REVIEW', 'Medium', d2Id, mId, 8).lastInsertRowid;
  const i4 = insertIssue.run('PROJ-104', projId, 'Fix timezone offset bug in calendar logger', 'Work logs submitted across timezones should normalize to local workday.', 'Bug', 'TO DO', 'Low', d2Id, d1Id, 4).lastInsertRowid;
  const i5 = insertIssue.run('PROJ-105', projId, 'Export timesheet report to CSV and Excel', 'Enable team managers to download billing report for clients.', 'Task', 'TO DO', 'Medium', null, mId, 12).lastInsertRowid;

  // Insert Worklogs
  const insertLog = db.prepare(`
    INSERT INTO worklogs (issue_id, user_id, time_spent_hours, work_date, description, status, manager_note, reviewed_by, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  insertLog.run(i1, d1Id, 7.5, yesterday, 'Drafted security architecture diagram and token validation middleware', 'approved', 'Great work and clear documentation.', mId, new Date().toISOString());
  insertLog.run(i1, d1Id, 8.0, today, 'Unit tests for JWT revocation and login endpoint verification', 'approved', 'Approved.', mId, new Date().toISOString());
  insertLog.run(i2, d1Id, 6.0, today, 'Built backend approval routes, filter endpoints and aggregation SQL queries', 'pending', null, null, null);
  insertLog.run(i3, d2Id, 5.5, today, 'Added composite indexes on worklogs(issue_id, user_id, work_date) and benchmarked', 'pending', null, null, null);
  insertLog.run(i4, d2Id, 3.0, yesterday, 'Reproduced timezone issue with synthetic UTC timestamps', 'approved', 'Verified reproduction steps.', mId, new Date().toISOString());
}

module.exports = db;

