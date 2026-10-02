"""Private social storage with serialized state transitions."""
import os, sqlite3, threading
from contextlib import contextmanager
from pathlib import Path

SCHEMA = [
"CREATE TABLE IF NOT EXISTS public_messages (id TEXT PRIMARY KEY, sender TEXT NOT NULL, body TEXT NOT NULL, created DOUBLE PRECISION NOT NULL)",
"CREATE INDEX IF NOT EXISTS public_messages_time ON public_messages(created)",
"CREATE TABLE IF NOT EXISTS voice_calls (id TEXT PRIMARY KEY, accepted DOUBLE PRECISION NOT NULL, phase TEXT NOT NULL)",
"CREATE TABLE IF NOT EXISTS auth_sessions (digest TEXT PRIMARY KEY, subject TEXT NOT NULL, expires DOUBLE PRECISION NOT NULL)",
"CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, auth_id TEXT UNIQUE, name TEXT NOT NULL, avatar TEXT NOT NULL, created DOUBLE PRECISION NOT NULL)",
"CREATE TABLE IF NOT EXISTS contacts (owner TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(owner,target))",
"CREATE TABLE IF NOT EXISTS controls (owner TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, expires DOUBLE PRECISION NOT NULL, PRIMARY KEY(owner,target,kind))",
"CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, sender TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL, created DOUBLE PRECISION NOT NULL, delivered DOUBLE PRECISION NOT NULL DEFAULT 0, seen DOUBLE PRECISION NOT NULL DEFAULT 0)",
"CREATE INDEX IF NOT EXISTS messages_recipient ON messages(recipient,created)",
"CREATE INDEX IF NOT EXISTS messages_sender ON messages(sender,created)",
"CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, sender TEXT NOT NULL, recipient TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, created DOUBLE PRECISION NOT NULL, expires DOUBLE PRECISION NOT NULL)",
"CREATE INDEX IF NOT EXISTS invitations_pair ON invitations(sender,recipient,kind)",
"CREATE TABLE IF NOT EXISTS statuses (sender TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL, expires DOUBLE PRECISION NOT NULL, PRIMARY KEY(sender,recipient))",
"CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, reporter TEXT NOT NULL, target TEXT NOT NULL, category TEXT NOT NULL, notes TEXT NOT NULL, created DOUBLE PRECISION NOT NULL, state TEXT NOT NULL)",
"CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, board TEXT NOT NULL, turn TEXT NOT NULL, state TEXT NOT NULL, winner TEXT NOT NULL, created DOUBLE PRECISION NOT NULL, expires DOUBLE PRECISION NOT NULL)",
"CREATE TABLE IF NOT EXISTS scores (profile TEXT PRIMARY KEY, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0)",
"CREATE INDEX IF NOT EXISTS scores_rank ON scores(score)",
"CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, sender TEXT NOT NULL, recipient TEXT NOT NULL, invitation TEXT NOT NULL, data TEXT NOT NULL, once_only INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, expires DOUBLE PRECISION NOT NULL)",
"CREATE TABLE IF NOT EXISTS moderation_events (id TEXT PRIMARY KEY, profile TEXT NOT NULL, digest TEXT NOT NULL, decision TEXT NOT NULL, detail TEXT NOT NULL, created DOUBLE PRECISION NOT NULL, review_state TEXT NOT NULL)",
"CREATE TABLE IF NOT EXISTS restrictions (profile TEXT PRIMARY KEY, until_time DOUBLE PRECISION NOT NULL, reason TEXT NOT NULL)"
]
class Store:
 def __init__(self, path=':memory:', database_url=None, claim_server=True):
  self.lock=threading.RLock(); self.pg=bool(database_url)
  if self.pg:
   import psycopg
   from psycopg.rows import dict_row
   self.db=psycopg.connect(database_url,row_factory=dict_row,autocommit=True,connect_timeout=10,options="-c statement_timeout=8000 -c lock_timeout=5000")

  else:
   if str(path)!=':memory:':Path(path).parent.mkdir(parents=True,exist_ok=True)
   self.db=sqlite3.connect(str(path),check_same_thread=False,isolation_level=None)
   self.db.row_factory=sqlite3.Row
   self.db.execute('PRAGMA journal_mode=WAL')
  for statement in SCHEMA:self.db.execute(statement)
 @contextmanager
 def transaction(self):
  if not self.lock.acquire(timeout=10):raise TimeoutError('Database is busy. Please retry.')
  try:
   self.db.execute('BEGIN')
   try:
    if self.pg:self.db.execute('SELECT pg_advisory_xact_lock(624910301)')
    yield self
    self.db.execute('COMMIT')
   except Exception:
    self.db.execute('ROLLBACK');raise
  finally:self.lock.release()
 def execute(self,sql,args=()):
  return self.db.execute(sql.replace('?', '%s') if self.pg else sql,args)
 def one(self,sql,args=()):
  row=self.execute(sql,args).fetchone();return dict(row) if row else None
 def all(self,sql,args=()):return [dict(r) for r in self.execute(sql,args).fetchall()]
 def close(self):self.db.close()
