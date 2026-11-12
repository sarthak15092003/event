import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), "database.db")
conn = sqlite3.connect(db_path)
c = conn.cursor()

# 1. Add password column if missing
try:
    c.execute("ALTER TABLE users ADD COLUMN password TEXT DEFAULT 'password123'")
    print("Added password column to users")
except Exception as e:
    print("Password column check:", e)

# 2. Make Ankit Parashar Manager
c.execute("UPDATE users SET role = 'manager' WHERE name LIKE '%Ankit%' OR email LIKE '%ankit%'")
print("Updated Ankit to manager role. Rows affected:", c.rowcount)

# 3. Find David's ID
c.execute("SELECT id FROM users WHERE name LIKE '%David%' OR email LIKE '%david%'")
david_rows = c.fetchall()
david_ids = [r[0] for r in david_rows]

if david_ids:
    for did in david_ids:
        # Reassign David's issues to unassigned or Ankit
        c.execute("UPDATE issues SET assignee_id = NULL WHERE assignee_id = ?", (did,))
        c.execute("UPDATE issues SET reporter_id = 1 WHERE reporter_id = ?", (did,))
        # Reassign or clean David's worklogs
        c.execute("DELETE FROM worklogs WHERE user_id = ?", (did,))
        # Delete David
        c.execute("DELETE FROM users WHERE id = ?", (did,))
    print(f"Removed David (IDs: {david_ids}) successfully.")

# Set standard individual default passwords for all users if null
c.execute("UPDATE users SET password = 'password123' WHERE password IS NULL OR password = ''")

conn.commit()
conn.close()
print("DB user modifications complete.")

