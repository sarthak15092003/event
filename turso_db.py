import os
import json
import urllib.request
import urllib.error

TURSO_URL = os.environ.get("TURSO_DATABASE_URL", "https://event-event.aws-ap-south-1.turso.io")
if TURSO_URL.startswith("libsql://"):
    TURSO_URL = TURSO_URL.replace("libsql://", "https://")

TURSO_TOKEN = os.environ.get("TURSO_AUTH_TOKEN", "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTQ1NTMyMjksImlkIjoiMDFhMWQzYjAtYzUwMS03YzFhLWFiNTMtMjc1YmU3OTNhZjFkIiwia2lkIjoibm1GR3hPNHVSak9qTlFLelFFY2NZdWt6T0tUUG1nSFhpZ1psMWNENElNSSIsInJpZCI6IjJiNTk3Y2ViLTNmOGItNDg5Ny05MjA0LTFhZTQ1NWEwNzMxMSJ9.uLqNYEabE6p51QMkhV5mOv8p998YSzj-R4r4fMQhYSYsniKZqB80laxtT3dVi9rQuoMGJhuVqenVILKA7YyfBg")

def format_val(val):
    if val is None:
        return {"type": "null"}
    elif isinstance(val, bool):
        return {"type": "integer", "value": "1" if val else "0"}
    elif isinstance(val, int):
        return {"type": "integer", "value": str(val)}
    elif isinstance(val, float):
        return {"type": "float", "value": val}
    else:
        return {"type": "text", "value": str(val)}

def parse_val(v):
    if not isinstance(v, dict):
        return v
    t = v.get("type")
    val = v.get("value")
    if t == "null":
        return None
    elif t == "integer":
        try:
            return int(val)
        except Exception:
            return val
    elif t == "float":
        try:
            return float(val)
        except Exception:
            return val
    elif t == "text":
        return str(val)
    return val

class TursoRow(dict):
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)
    def get(self, key, default=None):
        return super().get(key, default)

class TursoCursor:
    def __init__(self, conn):
        self.conn = conn
        self.lastrowid = None
        self.rowcount = 0
        self._rows = []
        self._idx = 0

    def execute(self, sql, params=()):
        res = self.conn._execute_sql(sql, params)
        self.lastrowid = res.get("last_insert_rowid")
        self.rowcount = res.get("affected_row_count", 0)
        cols = [c["name"] for c in res.get("cols", [])]
        raw_rows = res.get("rows", [])

        self._rows = []
        for r in raw_rows:
            parsed = [parse_val(cell) for cell in r]
            row_dict = TursoRow()
            for idx, c in enumerate(cols):
                row_dict[c] = parsed[idx]
            self._rows.append(row_dict)
        self._idx = 0
        return self

    def fetchone(self):
        if self._idx < len(self._rows):
            row = self._rows[self._idx]
            self._idx += 1
            return row
        return None

    def fetchall(self):
        rows = self._rows[self._idx:]
        self._idx = len(self._rows)
        return rows

    def executescript(self, sql_script):
        for stmt in sql_script.split(";"):
            stmt = stmt.strip()
            if stmt:
                self.execute(stmt)

class TursoConnection:
    def __init__(self, url=TURSO_URL, token=TURSO_TOKEN):
        self.url = url.rstrip("/")
        self.token = token
        self.row_factory = None

    def _execute_sql(self, sql, params=()):
        endpoint = f"{self.url}/v2/pipeline"
        args = [format_val(p) for p in params]
        payload = {
            "requests": [
                {
                    "type": "execute",
                    "stmt": {
                        "sql": sql,
                        "args": args
                    }
                }
            ]
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            endpoint,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}"
            },
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                res_item = body["results"][0]
                if res_item.get("type") == "error":
                    raise Exception(res_item.get("error", "Turso query error"))
                return res_item.get("response", {}).get("result", {})
        except urllib.error.HTTPError as e:
            err_text = e.read().decode("utf-8")
            raise Exception(f"Turso HTTP {e.code}: {err_text}")

    def cursor(self):
        return TursoCursor(self)

    def execute(self, sql, params=()):
        cur = self.cursor()
        return cur.execute(sql, params)

    def executescript(self, sql_script):
        # Split statements by ;
        for stmt in sql_script.split(";"):
            stmt = stmt.strip()
            if stmt:
                self.execute(stmt)

    def commit(self):
        pass

    def close(self):
        pass

def get_turso_db():
    return TursoConnection()

