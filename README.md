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
6. Players enter London and automatically join an available public session. No server address or room code is needed. Each session has at most 12 players; overflow starts another session.
7. Verify movement, jumping, names, appearance and credits. Separately test phone loading, touch movement, camera and Jump.

A domain is not needed. Free Render services sleep after inactivity. Rooms and online scores reset on restart; feedback files also do not survive replacement without persistent storage. For durable feedback, use a paid disk or external database. MINIUK_DATA_DIR configures the feedback storage directory.

Opt-in nearby voice is available in the browser build as an unverified private-playtest feature. Train, police, bridge and vehicle animations are local. No production accounts, moderation or anti-cheat yet.

References:
https://render.com/docs/web-services
https://render.com/docs/docker
https://render.com/docs/free


## Browser room voice test

After players enter London, open **Nearby voice** at the top left.
Click **Enable voice**, allow the microphone, then click **Unmute mic**. Each player must do this.
Use headphones. The panel shows connected peers, a listening volume slider and a playback button if the browser blocks incoming audio.
Mute silences the outgoing track. Turn voice off releases the microphone. Leaving the room, changing city, closing the page or hiding the tab also stops capture; returning requires enabling voice again.
Audio is full volume within 5 metres, fades to zero at 25 metres, and peer connections close outside that range. Distance updates arrive once per second. Only players in the same public session can see/hear one another. No audio is recorded by Mini UK. Peer-to-peer connections may reveal network addresses to other room participants. Never publish session tokens or TURN secrets.
Start with two players on different networks. Verify both directions, mute, stop, deny permission and rejoin. Editor/native builds do not include browser voice. Twelve-player audio load has not been tested.

### Relay setup for different networks

The default uses Google's public STUN server. STUN alone cannot connect all mobile, VPN or restricted networks. For reliable remote calls configure a TURN service supporting coturn REST/HMAC-SHA1 credentials. Render's HTTP web service is only the signalling server; it is not a TURN relay.
Set these **Render environment secrets**, not repository files:

- MINIUK_TURN_URLS: provider-supplied comma-separated `turn:` / `turns:` URLs (ideally UDP plus TLS on 443).
- MINIUK_TURN_SECRET: the provider's coturn shared authentication secret.

The server generates one-hour credentials for authenticated room participants; it never returns the shared secret. Providers with different credential APIs need an adapter. With no configuration the UI explicitly labels this a limited-network test. Re-enable voice to refresh credentials for new connections after an hour. An external provider/account and its pricing must be chosen before setup; none is provisioned by this update.

If voice cannot connect, turn it off and on after checking microphone site permission and the relay configuration. Successful signalling/unit tests do not prove that a two-device audio call works.


## Android browser playtest
Open the HTTPS game link in Chrome on Android. The Android browser uses a lower pixel ratio, visible movement pad and Jump / Ride / Zoom controls. Landscape is recommended. Drag the right side to look. Ride replaces keyboard F; confirmation buttons still need tapping. Nearby voice remains opt-in and needs microphone permission; moving to another app pauses it. This is a Web build, not an APK. Real Android hardware, sustained performance and two-device audio still need testing.
