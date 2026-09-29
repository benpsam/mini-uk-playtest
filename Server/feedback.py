"""Private owner-readable suggestion storage; no public listing endpoint."""
import sqlite3
import threading
import time
import re
from pathlib import Path

class FeedbackError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message

class Feedback:
    def __init__(self, path=None, clock=time.monotonic):
        self.path = str(path or Path(__file__).with_name("feedback.sqlite3"))
        self.clock, self.lock, self.hits = clock, threading.Lock(), {}

    def submit(self, data, ip):
        city, category, message = (data.get(k) for k in ("city", "category", "message"))
        identity, name = data.get("id"), data.get("name", "Explorer")
        if city not in ("london", "manchester", "liverpool", "leeds", "scotland", "wales"):
            raise FeedbackError(400, "Choose a valid city.")
        if category not in ("Realism", "New additions", "Other ideas"):
            raise FeedbackError(400, "Choose a suggestion category.")
        if not isinstance(message, str) or not 10 <= len(message.strip()) <= 1000:
            raise FeedbackError(400, "Please write 10–1000 characters.")
        if not isinstance(identity, str) or not re.fullmatch(r"[a-f0-9]{32}", identity):
            raise FeedbackError(400, "Invalid suggestion identifier.")
        if not isinstance(name, str) or len(name) > 24:
            raise FeedbackError(400, "Name is too long.")
        with self.lock:
            now = self.clock()
            self.hits = {key: [t for t in times if t > now-60] for key, times in self.hits.items() if times[-1] > now-60}
            with sqlite3.connect(self.path) as db:
                db.execute("CREATE TABLE IF NOT EXISTS suggestions (id TEXT PRIMARY KEY, created TEXT DEFAULT CURRENT_TIMESTAMP, city TEXT, category TEXT, name TEXT, message TEXT)")
                previous = db.execute("SELECT city, category, name, message FROM suggestions WHERE id=?", (identity,)).fetchone()
                values = (city, category, name, message.strip())
                if previous:
                    if previous != values:
                        raise FeedbackError(409, "This suggestion identifier has already been used.")
                    return {"ok": True, "id": identity}
                if len(self.hits.get(ip, [])) >= 3:
                    raise FeedbackError(429, "Please wait a minute before sending another suggestion.")
                if db.execute("SELECT count(*) FROM suggestions").fetchone()[0] >= 10000:
                    raise FeedbackError(503, "The suggestion inbox is full. Please try later.")
                db.execute("INSERT INTO suggestions(id, city, category, name, message) VALUES(?,?,?,?,?)", (identity,)+values)
                self.hits.setdefault(ip, []).append(now)
        return {"ok": True, "id": identity}
