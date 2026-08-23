#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu box as the hill: node 24, Caddy, sqlite3, the anamnesia
# user, the service, the daily backup, and TLS for the name. Safe to run again: it refreshes
# the Cloudflare ranges and the unit files. `scripts/deploy.sh setup` ships this directory to
# the box and runs it as root; then `scripts/deploy.sh` ships a build.
set -euo pipefail
NAME="${PLAY_HOSTNAME:?set PLAY_HOSTNAME to the name players will use}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

echo "== packages"
apt-get install -y -qq ca-certificates curl gnupg apt-transport-https sqlite3 rsync >/dev/null
install -d -m 0755 /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/nodesource.gpg ]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
fi
if [ ! -f /etc/apt/keyrings/caddy-stable-archive-keyring.gpg ]; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /etc/apt/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sed 's#/usr/share/keyrings/caddy-stable-archive-keyring.gpg#/etc/apt/keyrings/caddy-stable-archive-keyring.gpg#' \
    > /etc/apt/sources.list.d/caddy-stable.list
fi
apt-get update -qq >/dev/null
apt-get install -y -qq nodejs caddy >/dev/null
echo "node $(node -v) · caddy $(caddy version | cut -d' ' -f1)"

echo "== the anamnesia user and its places"
id anamnesia >/dev/null 2>&1 || useradd --system --home /var/lib/anamnesia --shell /usr/sbin/nologin anamnesia
install -d -m 0755 -o anamnesia -g anamnesia /opt/anamnesia
install -d -m 0750 -o anamnesia -g anamnesia /var/lib/anamnesia /var/lib/anamnesia/backups

echo "== the service and the daily backup"
install -m 0644 "$HERE"/anamnesia.service "$HERE"/anamnesia-backup.service "$HERE"/anamnesia-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now anamnesia-backup.timer >/dev/null 2>&1
systemctl enable anamnesia >/dev/null 2>&1
if [ -f /opt/anamnesia/dist-server/main.js ]; then systemctl restart anamnesia; fi

echo "== caddy for $NAME"
CF="$( (curl -fsSL https://www.cloudflare.com/ips-v4; echo; curl -fsSL https://www.cloudflare.com/ips-v6) | tr '\n' ' ' | tr -s ' ')"
sed -e "s#__CLOUDFLARE__#$CF#" -e "s#__HOSTNAME__#$NAME#g" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy
echo "== done"
