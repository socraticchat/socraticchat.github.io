# Socratic New

A single public chat room with nicknames, text, emoji, GIFs, and image/video uploads. Messages and uploads are separate from Nexus and Socratic. There are no accounts, private rooms, or moderation tools. Nicknames are not reserved and anyone can impersonate one. The most recent 100 messages appear when joining; all messages and uploads remain on the server until removed by its operator.

## Requirements

Node.js 20 or newer, npm, a Linux server, and an Nginx HTTPS virtual host for `api-nexus.scholarnavigator.top`. The server needs a writable persistent directory for SQLite and uploads. GIF search needs a KLIPY API key.

## Local development

```sh
npm install
ALLOWED_ORIGIN=http://localhost:8000 PORT=3001 npm start
```

The browser client is configured for the production API host in `public/app.js`. For local development change `API` and the WebSocket URL there to `http://localhost:3001` and `ws://localhost:3001/socratic-new-ws`, respectively, then run a static server (for example, `python3 -m http.server 8000`) and open `http://localhost:8000`. These changes are for local development only. Use `npm run check` for syntax checks.

## Publish the frontend

Create a GitHub repository in the `socraticchat` account, commit and push this folder, then enable GitHub Pages in repository Settings → Pages, deploying from the branch containing `index.html`, using the repository root. A repository named `socraticchat.github.io` is served at `https://socraticchat.github.io/`; a differently named repository is served at `https://socraticchat.github.io/REPOSITORY/`. The backend permits the origin `https://socraticchat.github.io` for either path. The backend is Node.js and cannot run on GitHub Pages.

## Oracle server

1. Install Node.js 20+ and Git. Clone the new repository into a new server directory, `cd` into it, and run `npm install --omit=dev`.
2. Create a persistent writable data directory outside the checkout, such as `/var/lib/socratic-new`, owned by the service account. Set `DATA_DIR` to that path. Back up that directory, including the SQLite database and `media/` folder.
3. Create a systemd unit, adjusting paths and user for your server:

```ini
[Unit]
Description=Socratic New chat
After=network.target

[Service]
Type=simple
User=YOUR_SERVICE_USER
WorkingDirectory=/path/to/socratic-new
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DATA_DIR=/var/lib/socratic-new
Environment=ALLOWED_ORIGIN=https://socraticchat.github.io
EnvironmentFile=-/etc/socratic-new.env
ExecStart=/usr/bin/node backend/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Put `KLIPY_API_KEY=your-key` in `/etc/socratic-new.env`, restrict its permissions to the service account and root, and do not commit it. Confirm the Node path with `which node`. Run `sudo systemctl daemon-reload`, `sudo systemctl enable --now socratic-new`, and check `sudo systemctl status socratic-new` and `journalctl -u socratic-new`.

4. Add the following locations inside the existing HTTPS `server` block for `api-nexus.scholarnavigator.top`. Keep the existing Nexus locations. This service binds to loopback; do not expose port 3001 publicly.

```nginx
location /socratic-new-api/ {
    client_max_body_size 21m;
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /socratic-new-ws {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;
}
```

Run `sudo nginx -t` and reload Nginx only after the test succeeds. Existing locations, proxy behavior, port usage and certificate setup vary, so inspect the current configuration before applying this example. For updates, pull the repository, install changed dependencies, and restart the service. Publish frontend updates through GitHub Pages separately.

The service allows images (JPEG, PNG, GIF, WebP) and videos (MP4, WebM), up to 20 MB each. Uploads and messages are public and retained indefinitely. Plan for disk capacity and backups. There is no account recovery, nickname ownership, automatic moderation, or in-app deletion. HTTP requests and WebSocket messages have basic limits, but a public unauthenticated upload service still requires operational monitoring and disk management.
