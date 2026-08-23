#!/usr/bin/env bash
# Ship the hill.
#
#   scripts/deploy.sh          build, rsync dist/ and dist-server/ to the box, restart, check
#   scripts/deploy.sh setup    first time (or to refresh Caddy/systemd): run deploy/setup.sh there
#
# Where the box is comes from deploy.local (git-ignored, `*.local`) — two lines:
#   DEPLOY_HOST=root@203.0.113.7
#   PLAY_HOSTNAME=game.example.com
# — or from the environment. The origin's address stays out of the repo on purpose: the name
# is proxied through Cloudflare, and an address in a public README is an address to go round it.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f deploy.local ] && . ./deploy.local
: "${DEPLOY_HOST:?set DEPLOY_HOST (deploy.local or the environment)}"
: "${PLAY_HOSTNAME:?set PLAY_HOSTNAME (deploy.local or the environment)}"
SSH=(ssh -o BatchMode=yes "$DEPLOY_HOST")

if [ "${1:-}" = setup ]; then
  echo "== setting up $DEPLOY_HOST for $PLAY_HOSTNAME"
  tar cz deploy | "${SSH[@]}" 'rm -rf /root/anamnesia-setup && mkdir -p /root/anamnesia-setup && tar xz -C /root/anamnesia-setup'
  "${SSH[@]}" "PLAY_HOSTNAME=$PLAY_HOSTNAME bash /root/anamnesia-setup/deploy/setup.sh"
  exit 0
fi

echo "== building"
npm run build >/dev/null
echo "== shipping to $DEPLOY_HOST"
rsync -az --delete -e 'ssh -o BatchMode=yes' dist-server/ "$DEPLOY_HOST:/opt/anamnesia/dist-server/"
rsync -az --delete -e 'ssh -o BatchMode=yes' dist/ "$DEPLOY_HOST:/opt/anamnesia/dist/"
"${SSH[@]}" 'chown -R anamnesia:anamnesia /opt/anamnesia && systemctl restart anamnesia && sleep 1 && systemctl is-active anamnesia >/dev/null && curl -fsS -o /dev/null http://127.0.0.1:8787/api/me && echo "the hill answers on the box"'
echo "== checking https://$PLAY_HOSTNAME/"
curl -fsS -o /dev/null -w 'https://%{url.host}/ → %{http_code} in %{time_total}s\n' "https://$PLAY_HOSTNAME/api/me"
