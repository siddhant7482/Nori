#!/usr/bin/env bash
# Provision Nori inside its container (CT 111). Idempotent: re-run to deploy.
#
# From the Proxmox host:
#   pct push 111 deploy/provision-nori.sh /root/provision-nori.sh --perms 755
#   pct exec 111 -- bash /root/provision-nori.sh
#
# .env.local is written once, from /root/nori.env if it is staged there, and
# never overwritten after that: it holds the Monzo client secret and the key
# that decrypts the Monzo tokens. Lose the key and Monzo has to be connected
# again, which after the first five minutes only reaches 90 days back.
set -euo pipefail

export PATH=/usr/local/bin:$PATH

DIR=/srv/nori
PORT=3006
REPO=https://github.com/siddhant7482/Nori.git

say() { printf '\n== %s\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive

say "packages"
apt-get update -qq
apt-get install -y -qq curl ca-certificates xz-utils git >/dev/null
echo "   ok"

say "node"
if command -v node >/dev/null 2>&1 && node -v | grep -qE '^v(2[2-9]|[3-9][0-9])'; then
  echo "   already have $(node -v)"
else
  TGZ=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ \
        | grep -oE 'node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' | head -1)
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/${TGZ}" | tar -xJ -C /usr/local --strip-components=1
  echo "   installed $(node -v)"
fi
corepack enable >/dev/null 2>&1 || npm i -g corepack >/dev/null 2>&1
corepack prepare pnpm@10.18.3 --activate >/dev/null 2>&1
echo "   pnpm $(pnpm --version)"

say "source"
if [ -d "$DIR/.git" ]; then
  cd "$DIR"
  git fetch --quiet origin
  git reset --hard --quiet origin/main
  echo "   pulled $(git log --oneline -1)"
else
  git clone --quiet "$REPO" "$DIR"
  cd "$DIR"
  echo "   cloned $(git log --oneline -1)"
fi

say "config"
if [ -f "$DIR/.env.local" ]; then
  echo "   .env.local already present, left alone"
elif [ -f /root/nori.env ]; then
  install -m 600 /root/nori.env "$DIR/.env.local"
  echo "   installed .env.local"
else
  echo "   NO .env.local and none staged at /root/nori.env"; exit 1
fi
if grep -q '^NORI_TODAY=' "$DIR/.env.local"; then
  echo "   NORI_TODAY is set: that pins the date and is for the example cycle only"; exit 1
fi

say "build"
cd "$DIR"
pnpm install --frozen-lockfile --silent 2>&1 | tail -2
# pnpm build runs scripts/postbuild.mjs, which assembles the standalone
# output. Check it exists before touching the service: a failed build can
# leave a running server whose files are gone.
pnpm build 2>&1 | tail -4
[ -f "$DIR/.next/standalone/server.js" ] || { echo "   no standalone server.js, service left as it was"; exit 1; }

say "schema"
pnpm db:push --force 2>&1 | tail -2

say "services"
cat > /etc/systemd/system/commandhq-nori.service <<UNIT
[Unit]
Description=CommandHQ Nori
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${DIR}/.next/standalone
EnvironmentFile=${DIR}/.env.local
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=HOSTNAME=0.0.0.0
# Reading a receipt runs out of the repo, not the standalone bundle:
# Tesseract loads a worker from node_modules and a page render has no
# business holding hundreds of megabytes of wasm.
Environment=NORI_HOME=${DIR}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/local/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

# The five-minute Monzo poll. No webhooks: they need a public URL, and a
# public door into the node costs more than a five-minute delay saves.
# Enabled from the start because the job exits 0 until Monzo is connected
# and approved, so it never shows as a failed unit for nothing.
cat > /etc/systemd/system/nori-sync.service <<UNIT
[Unit]
Description=Nori: read new transactions from Monzo
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${DIR}
EnvironmentFile=${DIR}/.env.local
Environment=NODE_ENV=production
ExecStart=/usr/local/bin/pnpm sync
Nice=10
UNIT

cat > /etc/systemd/system/nori-sync.timer <<UNIT
[Unit]
Description=Nori: Monzo sync every five minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable commandhq-nori >/dev/null 2>&1
systemctl restart commandhq-nori
systemctl enable --now nori-sync.timer >/dev/null 2>&1
sleep 3
echo "   commandhq-nori: $(systemctl is-active commandhq-nori)"
echo "   nori-sync.timer: $(systemctl is-active nori-sync.timer)"
curl -fsS "http://127.0.0.1:${PORT}/api/status" | head -c 200 || echo "   status did not answer"
echo

say "done"
