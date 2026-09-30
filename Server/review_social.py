"""Owner-only console tool. Run on the server; no public admin endpoint."""
import argparse,os,json
from social_store import Store
p=argparse.ArgumentParser();p.add_argument('action',choices=['reports','moderation','resolve']);p.add_argument('--id');p.add_argument('--table',choices=['reports','moderation_events']);a=p.parse_args()
s=Store(os.path.join(os.environ.get('MINIUK_DATA_DIR','/tmp/miniuk'),'social.sqlite3'),os.environ.get('DATABASE_URL'),claim_server=False)
with s.transaction():
 if a.action=='resolve':
  if not a.table or not a.id:p.error('resolve requires --table and --id')
  column='state' if a.table=='reports' else 'review_state'
  s.execute(f"UPDATE {a.table} SET {column}='reviewed' WHERE id=?",(a.id,));print('Marked reviewed. No permanent account restriction was applied.')
 else:
  table='reports' if a.action=='reports' else 'moderation_events'
  print(json.dumps(s.all(f'SELECT * FROM {table} ORDER BY created DESC LIMIT 50'),indent=2))
s.close()
