import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), "database.db")
conn = sqlite3.connect(db_path)
c = conn.cursor()

columns = [
    ("category", "TEXT DEFAULT 'General'"),
    ("remarks", "TEXT"),
    ("source", "TEXT DEFAULT 'app'")
]

for col_name, col_def in columns:
    try:
        c.execute(f"ALTER TABLE issues ADD COLUMN {col_name} {col_def}")
        print(f"Added column {col_name}")
    except Exception as e:
        print(f"Column {col_name} check: {e}")

conn.commit()
conn.close()
print("Migration completed.")

