# Mini UK online playtest

The Unity Web export and London server run together as one Docker service. This is a small private-playtest system.

## Prepare
Stop Unity Play mode, then choose Mini UK → Prepare Online Playtest.
The resulting folder is Builds/OnlinePlaytest. Put its contents into a private Git repository; do not upload the entire Unity project or any feedback database. Large files may require Git LFS instead of the repository browser uploader.

## Render
1. Create your own Render account and complete any required terms/sign-in yourself.
2. Create a Web Service from the repository containing this package.
3. Select Docker and the Free plan for the first short test, if offered. Do not choose paid services without deciding a budget.
4. Set health check path to /health. The Dockerfile reads Render's PORT.
5. When deployment succeeds, open the generated HTTPS URL.
6. Both players enter London → Menu → Play with friends. The browser build automatically uses its own server address. One creates a room; the other joins its eight-character code.
7. Verify movement, jumping, names, appearance and credits. Separately test phone loading, touch movement, camera and Jump.

A domain is not needed. Free Render services sleep after inactivity. Rooms and online scores reset on restart; feedback files also do not survive replacement without persistent storage. For durable feedback, use a paid disk or external database. MINIUK_DATA_DIR configures the feedback storage directory.

Live voice is not implemented. Train, police, bridge and vehicle animations are local. No production accounts, moderation or anti-cheat yet.

References:
https://render.com/docs/web-services
https://render.com/docs/docker
https://render.com/docs/free
