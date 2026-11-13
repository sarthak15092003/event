import turso_db
import urllib.request
import csv
import io

def run():
    conn = turso_db.get_turso_db()
    c = conn.cursor()

    url = 'https://docs.google.com/spreadsheets/d/1OCyP0IwxBu8u9dbJnMhHUtgylPqbd5w1dvCllOQ1sQc/export?format=csv&gid=986782709'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    content = urllib.request.urlopen(req).read().decode('utf-8')
    reader = list(csv.reader(io.StringIO(content)))

    event_name = reader[0][0].strip() or 'Amazon Connect Event Bangalore'
    c.execute("SELECT id, key FROM projects WHERE key = 'AMZ' OR name LIKE '%Amazon%'")
    p_row = c.fetchone()
    if p_row:
        project_id = p_row['id']
        project_key = p_row['key']
    else:
        c.execute("INSERT INTO projects (key, name, description, created_by) VALUES ('AMZ', ?, 'Amazon Connect Event Bangalore', 1)", (event_name,))
        c.execute("SELECT id, key FROM projects WHERE key = 'AMZ'")
        p_row = c.fetchone()
        project_id = p_row['id']
        project_key = p_row['key']

    print(f"Target Project: id={project_id}, key={project_key}, name={event_name}")

    c.execute("SELECT id, name FROM users")
    user_rows = c.fetchall()
    user_map = {u['name'].strip().lower(): u['id'] for u in user_rows}

    # Delete existing tasks for this project
    c.execute("DELETE FROM worklogs WHERE issue_id IN (SELECT id FROM issues WHERE project_id = ?)", (project_id,))
    c.execute("DELETE FROM issues WHERE project_id = ?", (project_id,))

    # Also clean up old AEONX sheet-synced items if any
    c.execute("DELETE FROM issues WHERE project_id = 3 AND source = 'sheet'")

    def map_status(raw):
        s = (raw or '').strip().lower()
        if s in ['completed', 'done', 'closed']:
            return 'DONE'
        elif s in ['in progress', 'ongoing', 'working']:
            return 'IN PROGRESS'
        elif s in ['under review', 'review', 'in review']:
            return 'IN REVIEW'
        return 'TO DO'

    current_cat = 'General'
    task_count = 0

    for idx, r in enumerate(reader):
        if idx < 5:
            continue
        cat = r[0].strip() if len(r) > 0 else ''
        details = r[1].strip() if len(r) > 1 else ''
        status_raw = r[2].strip() if len(r) > 2 else ''
        owner_raw = r[3].strip() if len(r) > 3 else ''
        remarks_raw = r[4].strip() if len(r) > 4 else ''
        
        if cat:
            current_cat = cat
        if not details:
            continue
            
        task_count += 1
        issue_key = f"{project_key}-{100 + task_count}"
        status = map_status(status_raw)
        
        assignee_id = None
        if owner_raw:
            owner_clean = owner_raw.strip()
            okey = owner_clean.lower()
            if okey in user_map:
                assignee_id = user_map[okey]
            else:
                email = f"{okey.replace(' ', '.')}@cybermedia.co.in"
                avatar = f"https://api.dicebear.com/7.x/avataaars/svg?seed={owner_clean}"
                c.execute("INSERT INTO users (name, email, role, avatar) VALUES (?, ?, 'member', ?)", (owner_clean, email, avatar))
                c.execute("SELECT id FROM users WHERE email = ?", (email,))
                assignee_id = c.fetchone()['id']
                user_map[okey] = assignee_id
                
        c.execute("""
            INSERT INTO issues (issue_key, project_id, category, title, description, type, status, priority, assignee_id, reporter_id, original_estimate_hours, remarks, source)
            VALUES (?, ?, ?, ?, ?, 'Task', ?, 'Medium', ?, 1, 4.0, ?, 'sheet')
        """, (issue_key, project_id, current_cat, details, f"Category: {current_cat}\nRemarks: {remarks_raw}", status, assignee_id, remarks_raw))

    c.execute("""
        UPDATE sync_settings 
        SET sheet_url = ?, last_sync_at = CURRENT_TIMESTAMP, last_sync_status = 'Success', last_sync_count = ? 
        WHERE id = 1
    """, (url, task_count))

    print(f"Successfully inserted {task_count} tasks in exact sequential sheet order!")
    conn.close()

if __name__ == '__main__':
    run()

