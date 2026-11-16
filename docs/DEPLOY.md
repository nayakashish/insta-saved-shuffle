# Deploying with Docker

The image is the static site plus the zero-dependency `server.mjs`
(node:22-alpine, runs as the unprivileged `node` user, about 160 MB).
`.dockerignore` is an allow-list, so the private `saved/` folder can never
end up inside an image.

## Run

```
docker compose up -d --build        # http://<server>:4321/
```

or without compose:

```
docker build -t saved-shuffle .
docker run -d --name saved-shuffle --restart unless-stopped \
  -p 4321:4321 --read-only --cap-drop ALL saved-shuffle
```

Update after pulling new code: `docker compose up -d --build`.

## Preloaded list (optional)

Mount a `saved_posts.html` read-only and visitors skip the import step:

```
-v /path/to/saved_posts.html:/app/saved/saved_posts.html:ro
```

(or uncomment `volumes` in `compose.yaml`). **Anyone who can reach the
server can download that file.** Only do this on a private network, such as
your tailnet. Without it, every visitor starts on the import page and their
data stays in their own browser.

## Who can reach it

`compose.yaml` publishes port 4321 on all interfaces. To narrow it, change
the `ports` line:

| Reachable from | `ports` |
|---|---|
| Everywhere the server is | `"4321:4321"` |
| Your tailnet only | `"<server-tailscale-ip>:4321:4321"` |
| Only a reverse proxy on the same host | `"127.0.0.1:4321:4321"` |

## HTTPS

The app works over plain HTTP, but installing it as an app and offline use
need HTTPS. Two easy options:

- **Tailscale:** `tailscale serve --bg 4321` on the server gives
  `https://<machine>.<tailnet>.ts.net/` with a valid certificate, tailnet only.
- **Caddy** for a public domain: `reverse_proxy 127.0.0.1:4321`.

## Configuration

| Variable | Default in image | Meaning |
|---|---|---|
| `PORT` | `4321` | Port inside the container |
| `HOST` | `0.0.0.0` | Bind address inside the container |
| `DEFAULT_LIST` | `/app/saved/saved_posts.html` | File served at `/default/saved_posts.html`, if it exists |

## What the server does

- Serves `public/` and, if present, the one default-list file. Nothing else.
- `GET`/`HEAD` only; `/healthz` for the container health check.
- Security headers: a strict Content-Security-Policy (own scripts only,
  Instagram allowed as a frame), `nosniff`, `frame-ancestors 'none'`.
- Files are revalidated on every load (`no-cache` plus `Last-Modified`), so
  a redeploy shows up at once; the default list is `private, no-store`.
- Stops cleanly on `docker stop`.
