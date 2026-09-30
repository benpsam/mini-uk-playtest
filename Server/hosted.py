"""Browser game and private-playtest API behind the host HTTPS proxy."""
import mimetypes
import os
import shutil
import threading
import time
from pathlib import Path
from urllib.parse import unquote, urlsplit
from http.server import ThreadingHTTPServer
from server import Handler, Rooms
from feedback import Feedback
from login import Login
from social_service import Social
from social_store import Store
WEB_ROOT = Path(__file__).resolve().parent.parent / "Web"
API_PATHS = {"/health", "/presence", "/leaderboard"}
ALLOWED = {".html", ".js", ".css", ".wasm", ".data", ".unityweb", ".json", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".svg", ".woff", ".woff2", ".ttf"}
def asset_path(url, root=WEB_ROOT):
    root = root.resolve()
    name = unquote(urlsplit(url).path).lstrip("/") or "index.html"
    candidate = (root/name).resolve()
    if not candidate.is_relative_to(root) or candidate.suffix.lower() not in ALLOWED or not candidate.is_file():
        return None
    return candidate
class HostedHandler(Handler):
    login = Login()
    def do_POST(self):
        path = urlsplit(self.path).path
        if path.startswith("/auth/"): return self.login.handle(self, path)
        return super().do_POST()
    def do_GET(self):
        if urlsplit(self.path).path.startswith("/auth/"): return self.login.handle(self, urlsplit(self.path).path)
        if urlsplit(self.path).path in API_PATHS:
            self.path = urlsplit(self.path).path
            return super().do_GET()
        file = asset_path(self.path)
        if file is None:
            return self.reply(404, {"error": "Not found."})
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(file.stat().st_size))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        try:
            with file.open("rb") as source:
                shutil.copyfileobj(source, self.wfile, 256*1024)
        except (ConnectionError, TimeoutError):
            pass
def main():
    if not (WEB_ROOT/"index.html").is_file():
        raise SystemExit("Browser export missing. Use Mini UK > Prepare Online Playtest.")
    storage = Path(os.environ.get("MINIUK_DATA_DIR", "/tmp/miniuk"))
    storage.mkdir(parents=True, exist_ok=True)
    with ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "10000"))), HostedHandler) as server:
        server.daemon_threads = True
        server.rooms = Rooms(social=Social(Store(storage/'social.sqlite3',os.environ.get('DATABASE_URL'))))
        server.feedback = Feedback(storage/"feedback.sqlite3")
        def expire_private_data():
            while True:
                time.sleep(60)
                try:
                    with server.rooms.social.db.transaction():server.rooms.social.cleanup()
                except Exception:
                    print("Social retention cleanup failed; check database availability.",flush=True)
        threading.Thread(target=expire_private_data,daemon=True).start()
        server.origin = os.environ.get("GAME_ORIGIN", "")
        print("Mini UK playtest ready", flush=True)
        server.serve_forever()
if __name__ == "__main__":
    main()
