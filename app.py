import sqlite3
import os
import json
import urllib.request
import csv
import io
import threading
import time
import shutil
from datetime import datetime, date
from flask import Flask, request, jsonify, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Support Vercel serverless /tmp directory if local directory is read-only
ORIGINAL_DB_PATH = os.path.join(BASE_DIR, "database.db")
if os.environ.get("VERCEL"):
    DB_PATH = "/tmp/database.db"
    if not os.path.exists(DB_PATH) and os.path.exists(ORIGINAL_DB_PATH):
        try:
            shutil.copyfile(ORIGINAL_DB_PATH, DB_PATH)
        except Exception:
            pass
else:
    DB_PATH = ORIGINAL_DB_PATH
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1OCyP0IwxBu8u9dbJnMhHUtgylPqbd5w1dvCllOQ1sQc/edit?gid=986782709#gid=986782709"

app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path="")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL DEFAULT 'member', -- 'manager' or 'member'
        avatar TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_key TEXT UNIQUE NOT NULL,
        project_id INTEGER NOT NULL,
        category TEXT DEFAULT 'General',
        title TEXT NOT NULL,
        description TEXT,
        type TEXT DEFAULT 'Task',
        status TEXT DEFAULT 'TO DO',
        priority TEXT DEFAULT 'Medium',
        assignee_id INTEGER,
        reporter_id INTEGER NOT NULL,
        original_estimate_hours REAL DEFAULT 0,
        remarks TEXT,
        source TEXT DEFAULT 'app', -- 'sheet' or 'app'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(project_id) REFERENCES projects(id),
        FOREIGN KEY(assignee_id) REFERENCES users(id),
        FOREIGN KEY(reporter_id) REFERENCES users(id)
    );

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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(issue_id) REFERENCES issues(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(reviewed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sync_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        sheet_url TEXT NOT NULL,
        auto_sync_enabled INTEGER DEFAULT 1,
        sync_interval_mins INTEGER DEFAULT 10,
        last_sync_at TIMESTAMP,
        last_sync_status TEXT,
        last_sync_count INTEGER DEFAULT 0
    );
    """)

    # Initialize sync settings
    c.execute("""
        INSERT OR IGNORE INTO sync_settings (id, sheet_url, auto_sync_enabled, sync_interval_mins, last_sync_status)
        VALUES (1, ?, 1, 10, 'Idle')
    """, (DEFAULT_SHEET_URL,))

    conn.commit()
    conn.close()

def extract_csv_export_url(sheet_url):
    # Extracts sheet ID and gid
    sheet_id = "1OCyP0IwxBu8u9dbJnMhHUtgylPqbd5w1dvCllOQ1sQc"
    gid = "986782709"
    if "/d/" in sheet_url:
        part = sheet_url.split("/d/")[1]
        sheet_id = part.split("/")[0]
    if "gid=" in sheet_url:
        gid = sheet_url.split("gid=")[1].split("&")[0].split("#")[0]
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"

def map_sheet_status(sheet_status):
    s = (sheet_status or "").strip().lower()
    if s == "completed":
        return "DONE"
    elif s in ["in progress", "ongoing", "in-progress"]:
        return "IN PROGRESS"
    elif s in ["under review", "review"]:
        return "IN REVIEW"
    else:
        # N/A, Pending, To do or empty
        return "TO DO"

def sync_from_sheet(sheet_url=None):
    conn = get_db()
    c = conn.cursor()
    if not sheet_url:
        row = c.execute("SELECT sheet_url FROM sync_settings WHERE id = 1").fetchone()
        sheet_url = row["sheet_url"] if row else DEFAULT_SHEET_URL

    csv_url = extract_csv_export_url(sheet_url)
    try:
        req = urllib.request.Request(csv_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            content = resp.read().decode("utf-8")

        reader = csv.reader(io.StringIO(content))
        rows = list(reader)

        # Ensure project exists
        c.execute("SELECT id FROM projects WHERE key = 'PROJ'")
        proj = c.fetchone()
        if not proj:
            c.execute("INSERT INTO projects (key, name, description, created_by) VALUES ('PROJ', 'Project Platform', 'Imported from Google Sheets Live Tracker', 1)")
            proj_id = c.lastrowid
        else:
            proj_id = proj["id"]

        # Parse tasks
        current_category = "General"
        imported_count = 0
        updated_count = 0

        # Scan and ensure users exist
        user_cache = {}
        for u in c.execute("SELECT id, name FROM users").fetchall():
            user_cache[u["name"].strip().lower()] = u["id"]

        # If manager doesn't exist, create default
        if "alex manager" not in user_cache:
            c.execute("INSERT INTO users (name, email, role, avatar) VALUES ('Alex Manager', 'manager@jira.local', 'manager', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex')")
            user_cache["alex manager"] = c.lastrowid
        manager_id = user_cache["alex manager"]

        for idx, r in enumerate(rows):
            if idx < 5:  # Skip headers
                continue
            cat = r[0].strip() if len(r) > 0 else ""
            details = r[1].strip() if len(r) > 1 else ""
            status_raw = r[2].strip() if len(r) > 2 else ""
            owner_raw = r[3].strip() if len(r) > 3 else ""
            remarks_raw = r[4].strip() if len(r) > 4 else ""

            if cat:
                current_category = cat
            if not details:
                continue

            # Assignee mapping
            assignee_id = None
            if owner_raw:
                owner_clean = owner_raw.strip()
                owner_key = owner_clean.lower()
                if owner_key not in user_cache:
                    email = f"{owner_key.replace(' ', '.')}@jira.local"
                    avatar = f"https://api.dicebear.com/7.x/avataaars/svg?seed={owner_clean}"
                    c.execute("INSERT INTO users (name, email, role, avatar) VALUES (?, ?, 'member', ?)", (owner_clean, email, avatar))
                    user_cache[owner_key] = c.lastrowid
                assignee_id = user_cache[owner_key]

            mapped_status = map_sheet_status(status_raw)

            # Check if this issue exists (match title & project)
            c.execute("SELECT id, issue_key, status FROM issues WHERE project_id = ? AND title = ?", (proj_id, details))
            existing = c.fetchone()

            if existing:
                # Update status, assignee, remarks if changed
                c.execute("""
                    UPDATE issues 
                    SET category = ?, remarks = ?, assignee_id = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (current_category, remarks_raw, assignee_id, existing["id"]))
                updated_count += 1
            else:
                imported_count += 1
                seq = 100 + imported_count + updated_count
                issue_key = f"TASK-{seq}"
                
                # Priority inference
                priority = "Highest" if "venue" in current_category.lower() or "contract" in details.lower() else "Medium"
                estimate = 8.0 if mapped_status == "DONE" else 4.0

                c.execute("""
                    INSERT INTO issues (issue_key, project_id, category, title, description, type, status, priority, assignee_id, reporter_id, original_estimate_hours, remarks, source)
                    VALUES (?, ?, ?, ?, ?, 'Task', ?, ?, ?, ?, ?, ?, 'sheet')
                """, (issue_key, proj_id, current_category, details, f"Category: {current_category}\nRemarks: {remarks_raw}", mapped_status, priority, assignee_id, manager_id, estimate, remarks_raw))
                new_issue_id = c.lastrowid

                # If status is DONE or In Progress, seed a sample initial worklog so timesheets reflect active sheet work
                if mapped_status == "DONE" and assignee_id:
                    c.execute("""
                        INSERT INTO worklogs (issue_id, user_id, time_spent_hours, work_date, description, status, reviewed_by, reviewed_at)
                        VALUES (?, ?, 6.0, date('now'), 'Completed milestone as per Sheet sync', 'approved', ?, CURRENT_TIMESTAMP)
                    """, (new_issue_id, assignee_id, manager_id))
                elif mapped_status == "IN PROGRESS" and assignee_id:
                    c.execute("""
                        INSERT INTO worklogs (issue_id, user_id, time_spent_hours, work_date, description, status)
                        VALUES (?, ?, 3.5, date('now'), 'In progress ongoing work', 'pending')
                    """, (new_issue_id, assignee_id))

        c.execute("""
            UPDATE sync_settings 
            SET last_sync_at = CURRENT_TIMESTAMP, 
                last_sync_status = 'Success', 
                last_sync_count = ?
            WHERE id = 1
        """, (imported_count + updated_count,))
        conn.commit()
        conn.close()
        return {"status": "success", "imported": imported_count, "updated": updated_count}
    except Exception as e:
        c.execute("UPDATE sync_settings SET last_sync_status = ? WHERE id = 1", (f"Error: {str(e)}",))
        conn.commit()
        conn.close()
        return {"status": "error", "message": str(e)}

# Background periodic auto-sync automation worker
def auto_sync_worker():
    while True:
        try:
            conn = get_db()
            row = conn.execute("SELECT auto_sync_enabled, sync_interval_mins, sheet_url FROM sync_settings WHERE id = 1").fetchone()
            conn.close()
            if row and row["auto_sync_enabled"]:
                interval = max(1, row["sync_interval_mins"])
                sync_from_sheet(row["sheet_url"])
                time.sleep(interval * 60)
            else:
                time.sleep(60)
        except Exception:
            time.sleep(60)

# Start background sync thread
threading.Thread(target=auto_sync_worker, daemon=True).start()

# Initialize DB on load
init_db()

# Run an immediate initial sync
try:
    sync_from_sheet(DEFAULT_SHEET_URL)
except Exception as e:
    print("Initial sync note:", e)

# ----------------- AUTH & USER HELPERS -----------------
def get_current_user():
    auth = request.headers.get("Authorization", "")
    email = None
    if auth.startswith("Bearer "):
        token = auth.split(" ")[1]
        email = token
    if not email:
        email = "manager@jira.local"
    conn = get_db()
    user = conn.execute("SELECT id, name, email, role, avatar FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()
    return dict(user) if user else None

@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.json or {}
    email = data.get("email", "").strip()
    password = data.get("password")
    conn = get_db()
    user = conn.execute("SELECT id, name, email, role, avatar, password FROM users WHERE LOWER(email) = LOWER(?)", (email,)).fetchone()
    conn.close()
    if not user:
        return jsonify({"error": "User with this email does not exist"}), 404
    
    u_dict = dict(user)
    # Check password if provided, or allow direct login if password matches default
    if password is not None:
        if u_dict.get("password") and u_dict.get("password") != password:
            return jsonify({"error": "Incorrect password. Please try again."}), 401
            
    # Do not expose password
    u_dict.pop("password", None)
    return jsonify({
        "token": u_dict["email"],
        "user": u_dict
    })

@app.route("/api/auth/me", methods=["GET"])
def me():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    return jsonify(user)

@app.route("/api/profile", methods=["GET", "POST", "DELETE"])
def profile_endpoint():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    
    conn = get_db()
    if request.method == "DELETE":
        user_id = user["id"]
        # Safety check: ensure at least one manager remains if this user is a manager
        if user.get("role") == "manager":
            manager_count = conn.execute("SELECT COUNT(*) as count FROM users WHERE role = 'manager' AND id != ?", (user_id,)).fetchone()["count"]
            if manager_count == 0:
                conn.close()
                return jsonify({"error": "Cannot delete the sole manager account."}), 400

        # Find another active user or manager to reassign reported issues to (since issues.reporter_id is NOT NULL)
        fallback_user = conn.execute("SELECT id FROM users WHERE id != ? ORDER BY CASE WHEN role = 'manager' THEN 0 ELSE 1 END, id ASC LIMIT 1", (user_id,)).fetchone()
        fallback_id = fallback_user["id"] if fallback_user else None

        # Unassign assignee_id (nullable) and reassign reporter_id (not null)
        conn.execute("UPDATE issues SET assignee_id = NULL WHERE assignee_id = ?", (user_id,))
        if fallback_id:
            conn.execute("UPDATE issues SET reporter_id = ? WHERE reporter_id = ?", (fallback_id, user_id))
        conn.execute("UPDATE projects SET created_by = NULL WHERE created_by = ?", (user_id,))
        conn.execute("UPDATE worklogs SET reviewed_by = NULL WHERE reviewed_by = ?", (user_id,))
        # Also clean up the user's worklogs and delete the user account
        conn.execute("DELETE FROM worklogs WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        conn.close()
        return jsonify({"message": "Profile deleted successfully"})

    if request.method == "POST":
        data = request.json or {}
        name = data.get("name", "").strip()
        email = data.get("email", "").strip()
        new_password = data.get("password", "").strip()
        
        if not name or not email:
            conn.close()
            return jsonify({"error": "Name and email are required"}), 400
            
        # Check if email is already taken by another user
        existing = conn.execute("SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?", (email, user["id"])).fetchone()
        if existing:
            conn.close()
            return jsonify({"error": "This email address is already in use by another user"}), 400
            
        avatar = f"https://api.dicebear.com/7.x/avataaars/svg?seed={name}"
        
        if new_password:
            conn.execute("""
                UPDATE users 
                SET name = ?, email = ?, password = ?, avatar = ?
                WHERE id = ?
            """, (name, email, new_password, avatar, user["id"]))
        else:
            conn.execute("""
                UPDATE users 
                SET name = ?, email = ?, avatar = ?
                WHERE id = ?
            """, (name, email, avatar, user["id"]))
            
        conn.commit()
        updated_user = conn.execute("SELECT id, name, email, role, avatar FROM users WHERE id = ?", (user["id"],)).fetchone()
        conn.close()
        return jsonify({
            "message": "Profile updated successfully!",
            "user": dict(updated_user)
        })

    # GET profile info including current password hint
    row = conn.execute("SELECT id, name, email, role, avatar, password FROM users WHERE id = ?", (user["id"],)).fetchone()
    conn.close()
    return jsonify(dict(row) if row else {})

@app.route("/api/users", methods=["GET", "POST"])
def users_endpoint():
    conn = get_db()
    if request.method == "POST":
        user = get_current_user()
        if not user or user.get("role") != "manager":
            conn.close()
            return jsonify({"error": "Manager privileges required"}), 403
        data = request.json or {}
        name = data.get("name")
        email = data.get("email")
        role = "manager" if data.get("role") == "manager" else "member"
        avatar = f"https://api.dicebear.com/7.x/avataaars/svg?seed={name}"
        try:
            cur = conn.execute("INSERT INTO users (name, email, role, avatar) VALUES (?, ?, ?, ?)", (name, email, role, avatar))
            conn.commit()
            uid = cur.lastrowid
            conn.close()
            return jsonify({"id": uid, "name": name, "email": email, "role": role, "avatar": avatar}), 201
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({"error": "User with this email already exists"}), 400

    rows = conn.execute("SELECT id, name, email, role, avatar FROM users ORDER BY name ASC").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/projects", methods=["GET", "POST"])
def projects_endpoint():
    conn = get_db()
    if request.method == "POST":
        user = get_current_user()
        data = request.json or {}
        name = data.get("name", "").strip()
        key = data.get("key", "").strip().upper()
        desc = data.get("description", "").strip()
        if not name:
            conn.close()
            return jsonify({"error": "Event name is required"}), 400
        if not key:
            # Generate key from initials/short name
            clean = "".join([c for c in name if c.isalnum() or c.isspace()]).split()
            key = "".join([w[:3] for w in clean])[:6].upper() or "EVT"
            
        try:
            cur = conn.execute("INSERT INTO projects (key, name, description, created_by) VALUES (?, ?, ?, ?)", (key, name, desc, user["id"] if user else 1))
            conn.commit()
            new_id = cur.lastrowid
            conn.close()
            return jsonify({"id": new_id, "key": key, "name": name, "description": desc}), 201
        except Exception as e:
            conn.close()
            return jsonify({"error": str(e)}), 400

    rows = conn.execute("""
        SELECT p.*, u.name as creator_name,
        (SELECT COUNT(*) FROM issues WHERE project_id = p.id) as total_issues
        FROM projects p
        LEFT JOIN users u ON p.created_by = u.id
        ORDER BY p.id ASC
    """).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/issues", methods=["GET", "POST"])
def issues_endpoint():
    conn = get_db()
    if request.method == "POST":
        user = get_current_user()
        data = request.json or {}
        title = data.get("title")
        if not title:
            conn.close()
            return jsonify({"error": "Title is required"}), 400
        desc = data.get("description", "")
        category = data.get("category", "General")
        itype = data.get("type", "Task")
        priority = data.get("priority", "Medium")
        assignee_id = data.get("assignee_id")
        assignee_id = int(assignee_id) if assignee_id else None
        reporter_id = data.get("reporter_id")
        reporter_id = int(reporter_id) if reporter_id else user["id"]
        project_id = data.get("project_id")
        project_id = int(project_id) if project_id else 1
        est = float(data.get("original_estimate_hours") or 0)
        
        # Get project key
        proj_row = conn.execute("SELECT key FROM projects WHERE id = ?", (project_id,)).fetchone()
        proj_prefix = proj_row["key"] if proj_row else "TASK"

        c = conn.cursor()
        c.execute("SELECT COUNT(*) + 101 FROM issues WHERE project_id = ?", (project_id,))
        seq = c.fetchone()[0]
        key = f"{proj_prefix}-{seq}"
        
        c.execute("""
            INSERT INTO issues (issue_key, project_id, category, title, description, type, status, priority, assignee_id, reporter_id, original_estimate_hours, source)
            VALUES (?, ?, ?, ?, ?, ?, 'TO DO', ?, ?, ?, ?, 'app')
        """, (key, project_id, category, title, desc, itype, priority, assignee_id, reporter_id, est))
        conn.commit()
        new_id = c.lastrowid
        conn.close()
        return jsonify({"id": new_id, "issue_key": key}), 201

    query = """
        SELECT i.*, 
            p.key as project_key,
            p.name as project_name,
            u1.name as assignee_name, u1.avatar as assignee_avatar,
            u2.name as reporter_name, u2.avatar as reporter_avatar,
            COALESCE((SELECT SUM(time_spent_hours) FROM worklogs WHERE issue_id = i.id), 0) as total_time_logged,
            COALESCE((SELECT SUM(time_spent_hours) FROM worklogs WHERE issue_id = i.id AND status = 'approved'), 0) as approved_time_logged
        FROM issues i
        JOIN projects p ON i.project_id = p.id
        LEFT JOIN users u1 ON i.assignee_id = u1.id
        LEFT JOIN users u2 ON i.reporter_id = u2.id
        ORDER BY i.id DESC
    """
    rows = conn.execute(query).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/issues/<int:issue_id>", methods=["GET", "PATCH"])
def single_issue_endpoint(issue_id):
    conn = get_db()
    if request.method == "PATCH":
        data = request.json or {}
        updates = []
        params = []
        for field in ["status", "assignee_id", "priority", "title", "description", "original_estimate_hours", "category"]:
            if field in data:
                updates.append(f"{field} = ?")
                params.append(data[field])
        if not updates:
            conn.close()
            return jsonify({"error": "No updates provided"}), 400
        params.append(issue_id)
        conn.execute(f"UPDATE issues SET {', '.join(updates)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", params)
        conn.commit()
        conn.close()
        return jsonify({"message": "Issue updated"})

    row = conn.execute("""
        SELECT i.*, 
            p.key as project_key,
            p.name as project_name,
            u1.name as assignee_name, u1.avatar as assignee_avatar,
            u2.name as reporter_name, u2.avatar as reporter_avatar,
            COALESCE((SELECT SUM(time_spent_hours) FROM worklogs WHERE issue_id = i.id), 0) as total_time_logged,
            COALESCE((SELECT SUM(time_spent_hours) FROM worklogs WHERE issue_id = i.id AND status = 'approved'), 0) as approved_time_logged
        FROM issues i
        JOIN projects p ON i.project_id = p.id
        LEFT JOIN users u1 ON i.assignee_id = u1.id
        LEFT JOIN users u2 ON i.reporter_id = u2.id
        WHERE i.id = ?
    """, (issue_id,)).fetchone()
    
    if not row:
        conn.close()
        return jsonify({"error": "Issue not found"}), 404

    logs = conn.execute("""
        SELECT w.*, u.name as user_name, u.avatar as user_avatar, r.name as reviewer_name
        FROM worklogs w
        JOIN users u ON w.user_id = u.id
        LEFT JOIN users r ON w.reviewed_by = r.id
        WHERE w.issue_id = ?
        ORDER BY w.work_date DESC, w.id DESC
    """, (issue_id,)).fetchall()
    
    conn.close()
    result = dict(row)
    result["worklogs"] = [dict(l) for l in logs]
    return jsonify(result)

@app.route("/api/worklogs", methods=["GET", "POST"])
def worklogs_endpoint():
    user = get_current_user()
    conn = get_db()
    if request.method == "POST":
        data = request.json or {}
        issue_id = data.get("issue_id")
        time_spent = float(data.get("time_spent_hours") or 0)
        work_date = data.get("work_date")
        desc = data.get("description", "")
        if not issue_id or time_spent <= 0 or not work_date:
            conn.close()
            return jsonify({"error": "Invalid worklog fields"}), 400

        initial_status = "approved" if user.get("role") == "manager" else "pending"
        reviewer = user["id"] if user.get("role") == "manager" else None
        
        cur = conn.execute("""
            INSERT INTO worklogs (issue_id, user_id, time_spent_hours, work_date, description, status, reviewed_by, reviewed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (issue_id, user["id"], time_spent, work_date, desc, initial_status, reviewer))
        conn.commit()
        wid = cur.lastrowid
        conn.close()
        return jsonify({"id": wid, "status": initial_status}), 201

    # GET
    user_id = request.args.get("user_id")
    status = request.args.get("status")
    
    query = """
        SELECT w.*, 
            u.name as user_name, u.email as user_email, u.avatar as user_avatar, u.role as user_role,
            i.issue_key, i.title as issue_title, i.status as issue_status, i.category as issue_category,
            p.key as project_key,
            r.name as reviewer_name
        FROM worklogs w
        JOIN users u ON w.user_id = u.id
        JOIN issues i ON w.issue_id = i.id
        JOIN projects p ON i.project_id = p.id
        LEFT JOIN users r ON w.reviewed_by = r.id
        WHERE 1=1
    """
    params = []
    if user_id:
        query += " AND w.user_id = ?"
        params.append(user_id)
    if status:
        query += " AND w.status = ?"
        params.append(status)

    query += " ORDER BY w.work_date DESC, w.id DESC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/worklogs/<int:log_id>/review", methods=["PATCH"])
def review_worklog(log_id):
    user = get_current_user()
    if not user or user.get("role") != "manager":
        return jsonify({"error": "Manager authorization required"}), 403
    data = request.json or {}
    status = data.get("status")
    note = data.get("manager_note", "")
    if status not in ["approved", "rejected", "pending"]:
        return jsonify({"error": "Invalid status"}), 400
    
    conn = get_db()
    conn.execute("""
        UPDATE worklogs 
        SET status = ?, manager_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (status, note, user["id"], log_id))
    conn.commit()
    conn.close()
    return jsonify({"message": f"Worklog updated to {status}"})

@app.route("/api/worklogs/<int:log_id>", methods=["DELETE"])
def delete_worklog(log_id):
    user = get_current_user()
    conn = get_db()
    row = conn.execute("SELECT * FROM worklogs WHERE id = ?", (log_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Not found"}), 404
    if user.get("role") != "manager" and row["user_id"] != user["id"]:
        conn.close()
        return jsonify({"error": "Forbidden"}), 403
    conn.execute("DELETE FROM worklogs WHERE id = ?", (log_id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Deleted successfully"})

@app.route("/api/analytics/timesheet-summary", methods=["GET"])
def analytics_summary():
    conn = get_db()
    stats = conn.execute("""
        SELECT 
            COALESCE(SUM(time_spent_hours), 0) as total_hours,
            COALESCE(SUM(CASE WHEN status = 'approved' THEN time_spent_hours ELSE 0 END), 0) as approved_hours,
            COALESCE(SUM(CASE WHEN status = 'pending' THEN time_spent_hours ELSE 0 END), 0) as pending_hours,
            COALESCE(SUM(CASE WHEN status = 'rejected' THEN time_spent_hours ELSE 0 END), 0) as rejected_hours,
            COUNT(*) as total_entries,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_approval_count
        FROM worklogs
    """).fetchone()

    users = conn.execute("""
        SELECT u.id, u.name, u.email, u.avatar, u.role,
            COALESCE(SUM(CASE WHEN w.status = 'approved' THEN w.time_spent_hours ELSE 0 END), 0) as approved_hours,
            COALESCE(SUM(CASE WHEN w.status = 'pending' THEN w.time_spent_hours ELSE 0 END), 0) as pending_hours,
            COALESCE(SUM(CASE WHEN w.status = 'rejected' THEN w.time_spent_hours ELSE 0 END), 0) as rejected_hours,
            COALESCE(SUM(w.time_spent_hours), 0) as total_logged_hours,
            COUNT(w.id) as total_logs_count
        FROM users u
        LEFT JOIN worklogs w ON u.id = w.user_id
        GROUP BY u.id
        ORDER BY total_logged_hours DESC
    """).fetchall()
    conn.close()
    return jsonify({
        "totalStats": dict(stats),
        "userSummary": [dict(u) for u in users]
    })

# ----------------- SHEET AUTOMATION & SYNC ENDPOINTS -----------------
@app.route("/api/sync/status", methods=["GET"])
def get_sync_status():
    conn = get_db()
    row = conn.execute("SELECT * FROM sync_settings WHERE id = 1").fetchone()
    conn.close()
    return jsonify(dict(row) if row else {})

@app.route("/api/sync/trigger", methods=["POST"])
def trigger_sync():
    data = request.json or {}
    sheet_url = data.get("sheet_url")
    result = sync_from_sheet(sheet_url)
    return jsonify(result)

@app.route("/api/sync/settings", methods=["POST"])
def update_sync_settings():
    data = request.json or {}
    sheet_url = data.get("sheet_url", DEFAULT_SHEET_URL)
    enabled = 1 if data.get("auto_sync_enabled") else 0
    interval = int(data.get("sync_interval_mins") or 10)
    
    conn = get_db()
    conn.execute("""
        UPDATE sync_settings 
        SET sheet_url = ?, auto_sync_enabled = ?, sync_interval_mins = ?
        WHERE id = 1
    """, (sheet_url, enabled, interval))
    conn.commit()
    conn.close()
    return jsonify({"message": "Automation settings saved"})

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path != "" and os.path.exists(os.path.join(PUBLIC_DIR, path)):
        return send_from_directory(PUBLIC_DIR, path)
    return send_from_directory(PUBLIC_DIR, "index.html")

if __name__ == "__main__":
    print("Starting Jira WorkLog & Sheet Sync Server on port 4000...")
    app.run(host="0.0.0.0", port=4000, debug=False)
