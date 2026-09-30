"""Bounded private media; fail closed on moderation errors; never public URLs."""
import os,json,base64,hashlib,io,time,urllib.request,warnings
from social_service import SocialError,uid
WARNING="Please do not upload sexual/explicit content, gore, graphic violence, illegal content, or other prohibited material. Images may be automatically checked for safety. Violations may result in restrictions or account action."
def normalize(value):
 if not isinstance(value,str) or len(value)>2800000:raise SocialError(413,'Maximum image size is 2 MB.')
 try:
  from PIL import Image,ImageOps
  Image.MAX_IMAGE_PIXELS=12000000
  raw=base64.b64decode(value,validate=True)
  if len(raw)>2000000:raise ValueError()
  with warnings.catch_warnings():
   warnings.simplefilter('error',Image.DecompressionBombWarning)
   source=Image.open(io.BytesIO(raw))
   if source.format not in ('JPEG','PNG','WEBP') or getattr(source,'n_frames',1)!=1:raise ValueError()
   source.load();image=ImageOps.exif_transpose(source).convert('RGB');image.thumbnail((1600,1600))
   out=io.BytesIO();image.save(out,'JPEG',quality=85)
  return base64.b64encode(out.getvalue()).decode()
 except Exception:raise SocialError(400,'Use a single JPEG, PNG or WebP image up to 2 MB and 12 megapixels.')
def moderate(encoded):
 payload={'model':'omni-moderation-latest','input':[{'type':'image_url','image_url':{'url':'data:image/jpeg;base64,'+encoded}}]}
 request=urllib.request.Request('https://api.openai.com/v1/moderations',data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+os.environ['OPENAI_API_KEY'],'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(request,timeout=20) as response:result=json.load(response)['results'][0]
  scores=result['category_scores'];threshold=float(os.environ.get('MINIUK_IMAGE_REVIEW_THRESHOLD','0.2'))
  if not 0<=threshold<=1:raise ValueError()
  review=result['flagged'] or any(float(v)>=threshold for v in scores.values())
  return ('review' if review else 'approved'),json.dumps({'flagged':result['flagged'],'scores':scores})
 except Exception:raise SocialError(503,'Safety checking is unavailable. No image was delivered.')
class Media:
 def __init__(self,social,moderator=moderate):self.social=social;self.moderator=moderator
 def permission(self,me,recipient,invitation):
  self.social.permitted(me,recipient)
  row=self.social.db.one("SELECT * FROM invitations WHERE id=? AND sender=? AND recipient=? AND kind='picture' AND state='accepted' AND expires>?",(invitation,me,recipient,self.social.clock()))
  if not row:raise SocialError(403,'The recipient must accept a new picture request first.')
  if self.social.muted(recipient,me):raise SocialError(403,'Recipient unavailable.')
 def upload(self,data,me):
  if os.environ.get('MINIUK_IMAGES_ENABLED')!='1' or not os.environ.get('OPENAI_API_KEY'):raise SocialError(503,'Picture sharing is disabled until safety services are configured.')
  if data.get('understood') is not True:raise SocialError(400,'Read and acknowledge the image safety warning.')
  if type(data.get('once')) is not bool:raise SocialError(400,'Choose normal or View Once delivery.')
  recipient=data.get('target');invitation=data.get('invitation')
  with self.social.db.transaction():
   self.social.rate(me,'image',3)
   self.permission(me,recipient,invitation)
   if self.social.db.one('SELECT COUNT(*) AS n FROM media WHERE (sender=? OR recipient=?) AND expires>?',(me,recipient,self.social.clock()))['n']>=20:raise SocialError(429,'Too many pending pictures. Wait for older pictures to expire.')
   if self.social.db.one('SELECT profile FROM restrictions WHERE profile=? AND until_time>?',(me,self.social.clock())):raise SocialError(403,'Image uploads are temporarily restricted pending review.')
  encoded=normalize(data.get('data'));decision,detail=self.moderator(encoded)
  with self.social.db.transaction():
   self.social.db.execute('INSERT INTO moderation_events VALUES(?,?,?,?,?,?,?)',(uid(),me,hashlib.sha256(encoded.encode()).hexdigest(),decision,detail,self.social.clock(),'open' if decision!='approved' else 'closed'))
   if decision!='approved':
    self.social.db.execute('INSERT INTO restrictions VALUES(?,?,?) ON CONFLICT(profile) DO UPDATE SET until_time=excluded.until_time,reason=excluded.reason',(me,self.social.clock()+600,'Image safety review'))
   else:
    self.permission(me,recipient,invitation)
    identity=uid();ttl=max(60,min(86400,int(os.environ.get('MINIUK_MEDIA_TTL_SECONDS','3600'))))
    self.social.db.execute('INSERT INTO media(id,sender,recipient,invitation,data,once_only,expires) VALUES(?,?,?,?,?,?,?)',(identity,me,recipient,invitation,encoded,int(data['once']),self.social.clock()+ttl))
    self.social.db.execute("UPDATE invitations SET state='used' WHERE id=?",(invitation,))
  if decision!='approved':raise SocialError(422,'Image rejected or held for safety review. It was not delivered. Image uploads are paused for ten minutes; contact support to request a review.')
  return dict(id=identity,ok=True)
 def open(self,data,me):
  with self.social.db.transaction():
   row=self.social.db.one('SELECT * FROM media WHERE id=? AND recipient=? AND consumed=0 AND expires>?',(data.get('id'),me,self.social.clock()))
   if not row:raise SocialError(404,'Picture unavailable, expired or already opened.')
   self.social.permitted(me,row['sender'])
   if row['once_only']:self.social.db.execute("UPDATE media SET consumed=1,data='' WHERE id=?",(row['id'],))
   return dict(data=row['data'],type='image/jpeg',viewOnce=bool(row['once_only']))
