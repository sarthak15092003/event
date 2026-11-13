import sqlite3
from turso_db import get_turso_db

def migrate():
    local = sqlite3.connect("database.db")
    local.row_factory = sqlite3.Row
    turso = get_turso_db()

    print("Creating tables on Turso...")
    turso.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            avatar TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            password TEXT DEFAULT 'welcome123'
        )
    """)

    turso.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            created_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    turso.execute("""
        CREATE TABLE IF NOT EXISTS issues (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_key TEXT UNIQUE NOT NULL,
            project_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            type TEXT DEFAULT 'Task',
            status TEXT DEFAULT 'TO DO',
            priority TEXT DEFAULT 'Medium',
            assignee_id INTEGER,
            reporter_id INTEGER NOT NULL,
            original_estimate_hours REAL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            category TEXT DEFAULT 'General',
            remarks TEXT,
            source TEXT DEFAULT 'app'
        )
    """)

    turso.execute("""
        CREATE TABLE IF NOT EXISTS worklogs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            time_spent_hours REAL NOT NULL,
            work_date TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'pending',
            manager_note TEXT,
            reviewed_by INTEGER,
            reviewed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    turso.execute("""
        CREATE TABLE IF NOT EXISTS sync_settings (
            id INTEGER PRIMARY KEY,
            sheet_url TEXT,
            last_sync_at TIMESTAMP,
            auto_sync_enabled INTEGER DEFAULT 1,
            sync_interval_mins INTEGER DEFAULT 10
        )
    """)

    print("Migrating users...")
    users = local.execute("SELECT * FROM users").fetchall()
    for u in users:
        turso.execute("""
            INSERT OR REPLACE INTO users (id, name, email, role, avatar, created_at, password)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (u["id"], u["name"], u["email"], u["role"], u["avatar"], u["created_at"], u["password"]))

    print("Migrating projects...")
    projects = local.execute("SELECT * FROM projects").fetchall()
    for p in projects:
        turso.execute("""
            INSERT OR REPLACE INTO projects (id, key, name, description, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (p["id"], p["key"], p["name"], p["description"], p["created_by"], p["created_at"]))

    print("Migrating issues...")
    issues = local.execute("SELECT * FROM issues").fetchall()
    for i in issues:
        turso.execute("""
            INSERT OR REPLACE INTO issues (id, issue_key, project_id, title, description, type, status, priority, assignee_id, reporter_id, original_estimate_hours, created_at, updated_at, category, remarks, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (i["id"], i["issue_key"], i["project_id"], i["title"], i["description"], i["type"], i["status"], i["priority"], i["assignee_id"], i["reporter_id"], i["original_estimate_hours"], i["created_at"], i["updated_at"], i["category"], i["remarks"], i["source"]))

    print("Migrating worklogs...")
    worklogs = local.execute("SELECT * FROM worklogs").fetchall()
    for w in worklogs:
        turso.execute("""
            INSERT OR REPLACE INTO worklogs (id, issue_id, user_id, time_spent_hours, work_date, description, status, manager_note, reviewed_by, reviewed_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (w["id"], w["issue_id"], w["user_id"], w["time_spent_hours"], w["work_date"], w["description"], w["status"], w["manager_note"], w["reviewed_by"], w["reviewed_at"], w["created_at"]))

    print("Migrating sync_settings...")
    sync_settings = local.execute("SELECT * FROM sync_settings").fetchall()
    for s in sync_settings:
        turso.execute("""
            INSERT OR REPLACE INTO sync_settings (id, sheet_url, last_sync_at, auto_sync_enabled, sync_interval_mins)
            VALUES (?, ?, ?, ?, ?)
        """, (s["id"], s["sheet_url"], s["last_sync_at"], s["auto_sync_enabled"], s["sync_interval_mins"]))

    print("Migration to Turso complete!")
    print("Turso users count:", turso.execute("SELECT count(*) as c FROM users").fetchone()["c"])
    print("Turso issues count:", turso.execute("SELECT count(*) as c FROM issues").fetchone()["c"])
    print("Turso projects count:", turso.execute("SELECT count(*) as c FROM projects").fetchone()["c"])

if __name__ == "__main__":
    migrate()

