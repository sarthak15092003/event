import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), "database.db")
conn = sqlite3.connect(db_path)
c = conn.cursor()

# If AEONX project exists, point its issues to project 1 and remove AEONX project
c.execute("SELECT id FROM projects WHERE key = 'AEONX'")
aeonx_row = c.fetchone()
if aeonx_row:
    aeonx_id = aeonx_row[0]
    c.execute("UPDATE issues SET project_id = 1 WHERE project_id = ?", (aeonx_id,))
    c.execute("DELETE FROM projects WHERE id = ?", (aeonx_id,))

# Update Project 1 Name
c.execute("UPDATE projects SET name = 'Events & Project Operations', description = 'Task and Timesheet Tracking' WHERE id = 1")

# Update issue keys from AEONX- to TASK-
c.execute("UPDATE issues SET issue_key = replace(issue_key, 'AEONX-', 'TASK-') WHERE issue_key LIKE 'AEONX-%'")

# Clean user emails from @aeonx.digital to @jira.local
c.execute("UPDATE users SET email = replace(email, '@aeonx.digital', '@jira.local') WHERE email LIKE '%@aeonx.digital%'")

conn.commit()

c.execute("SELECT id, name, email FROM users")
print("Cleaned Users:", c.fetchall())

c.execute("SELECT issue_key, title FROM issues LIMIT 5")
print("Cleaned Issues:", c.fetchall())

conn.close()
print("All database references to Aeonx removed successfully.")
