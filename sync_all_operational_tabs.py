import turso_db
import urllib.request
import csv
import io

TABS = [
    {"name": "Event & Operation", "gid": "2041394632", "key": "EVT"},
    {"name": "Creatives", "gid": "1818385189", "key": "CR"},
    {"name": "Audience Aquisition", "gid": "0", "key": "AUD"},
    {"name": "Social Media", "gid": "1948818569", "key": "SOC"},
    {"name": "Event Coverage", "gid": "360894581", "key": "COV"}
]

def map_status(raw):
    s = (raw or "").strip().lower()
    if s in ["completed", "done", "closed"]:
        return "DONE"
    elif s in ["in progress", "ongoing", "working"]:
        return "IN PROGRESS"
    elif s in ["under review", "review", "in review"]:
        return "IN REVIEW"
    return "TO DO"

def sync_all_operational_tabs():
    conn = turso_db.get_turso_db()
    c = conn.cursor()

    # Load users cache
    c.execute("SELECT id, name, email FROM users")
    users = c.fetchall()
    user_map = {u["name"].strip().lower(): u["id"] for u in users}

    # Ensure default members exist
    defaults = [
        ("Bibhuti", "bibhuti@jira.local"),
        ("Sunali", "sunali@jira.local"),
        ("Aditya Mishra", "aditya.mishra@cybermedia.co.in"),
        ("Manisha Bhatt", "manisha.bhatt@cybermedia.co.in"),
        ("Ankit Parashar", "ankit.parashar@jira.local")
    ]
    for name, email in defaults:
        if name.lower() not in user_map:
            c.execute("INSERT INTO users (name, email, role, avatar) VALUES (?, ?, 'member', ?)",
                      (name, email, f"https://api.dicebear.com/7.x/avataaars/svg?seed={name}"))
            c.execute("SELECT id FROM users WHERE email = ?", (email,))
            user_map[name.lower()] = c.fetchone()["id"]

    # Clear previous issues from sheet imports across projects
    c.execute("DELETE FROM worklogs")
    c.execute("DELETE FROM issues")
    c.execute("DELETE FROM projects")

    total_tasks_synced = 0

    for tab in TABS:
        tab_name = tab["name"]
        tab_gid = tab["gid"]
        tab_key = tab["key"]

        # Create project for this operational sheet tab
        c.execute("INSERT INTO projects (key, name, description, created_by) VALUES (?, ?, ?, ?)",
                  (tab_key, tab_name, f"Imported strictly from Google Sheet tab '{tab_name}' (gid={tab_gid})", 1))
        c.execute("SELECT id FROM projects WHERE key = ?", (tab_key,))
        proj_id = c.fetchone()["id"]

        url = f"https://docs.google.com/spreadsheets/d/1OCyP0IwxBu8u9dbJnMhHUtgylPqbd5w1dvCllOQ1sQc/export?format=csv&gid={tab_gid}"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        content = urllib.request.urlopen(req).read().decode('utf-8')
        reader = list(csv.reader(io.StringIO(content)))

        # Header is row 0: ['Task', 'Status', 'Owner', 'Stage', 'Due date', 'Notes']
        task_seq = 0
        for idx, row in enumerate(reader):
            if idx == 0:
                continue
            task_title = row[0].strip() if len(row) > 0 else ""
            status_raw = row[1].strip() if len(row) > 1 else ""
            owner_raw = row[2].strip() if len(row) > 2 else ""
            stage_raw = row[3].strip() if len(row) > 3 else ""
            due_raw = row[4].strip() if len(row) > 4 else ""
            notes_raw = row[5].strip() if len(row) > 5 else ""

            if not task_title:
                continue

            task_seq += 1
            total_tasks_synced += 1
            issue_key = f"{tab_key}-{100 + task_seq}"
            status = map_status(status_raw)
            category = stage_raw if stage_raw else tab_name

            # Determine assignee
            assignee_id = None
            remarks = notes_raw

            if owner_raw:
                owner_str = owner_raw.strip().lower()
                if "aditya" in owner_str and "manisha" in owner_str:
                    assignee_id = user_map.get("aditya mishra")
                    remarks = f"Co-owner: Manisha Bhatt. {notes_raw}".strip()
                elif "bibhuti" in owner_str:
                    assignee_id = user_map.get("bibhuti")
                elif "sunali" in owner_str:
                    assignee_id = user_map.get("sunali")
                elif "ankit" in owner_str:
                    assignee_id = user_map.get("ankit parashar")
                elif owner_str in user_map:
                    assignee_id = user_map[owner_str]
                else:
                    # Create user on the fly if needed
                    c.execute("INSERT INTO users (name, email, role, avatar) VALUES (?, ?, 'member', ?)",
                              (owner_raw.strip(), f"{owner_str.replace(' ', '.')}@cybermedia.co.in", f"https://api.dicebear.com/7.x/avataaars/svg?seed={owner_raw}"))
                    c.execute("SELECT id FROM users WHERE email = ?", (f"{owner_str.replace(' ', '.')}@cybermedia.co.in",))
                    assignee_id = c.fetchone()["id"]
                    user_map[owner_str] = assignee_id
            else:
                # Unassigned default or stage lead
                if tab_key in ["SOC", "COV"]:
                    assignee_id = user_map.get("bibhuti")

            priority = "Highest" if "contract" in task_title.lower() or "payment" in task_title.lower() else "Medium"
            desc = f"Stage: {stage_raw}\nDue Date: {due_raw}\nNotes: {notes_raw}".strip()

            c.execute("""
                INSERT INTO issues (issue_key, project_id, category, title, description, type, status, priority, assignee_id, reporter_id, original_estimate_hours, remarks, source)
                VALUES (?, ?, ?, ?, ?, 'Task', ?, ?, ?, 1, 4.0, ?, 'sheet')
            """, (issue_key, proj_id, category, task_title, desc, status, priority, assignee_id, remarks))

        print(f"Synced {task_seq} tasks for tab '{tab_name}' ({tab_key}) in exact Excel row order.")

    # Update sync_settings
    c.execute("""
        UPDATE sync_settings 
        SET last_sync_at = CURRENT_TIMESTAMP, 
            last_sync_status = 'Success', 
            last_sync_count = ?
        WHERE id = 1
    """, (total_tasks_synced,))

    print(f"\nALL 5 OPERATIONAL TABS SYNCED: Total {total_tasks_synced} tasks. Index tab excluded!")
    conn.close()

if __name__ == "__main__":
    sync_all_operational_tabs()

