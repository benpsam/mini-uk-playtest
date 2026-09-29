"""Run on the game server to read suggestions; never exposes an online inbox."""
import json
import sqlite3
from pathlib import Path
path = Path(__file__).with_name("feedback.sqlite3")
if not path.exists():
    print("No suggestions received yet.")
else:
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute("SELECT created, city, category, name, message FROM suggestions ORDER BY created DESC").fetchall()
    print(json.dumps([dict(row) for row in rows], indent=2, ensure_ascii=False))
