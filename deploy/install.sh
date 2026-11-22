#!/usr/bin/env bash
# Network Simulator installer for a clean Debian 13 (trixie) server or Proxmox LXC.
# Native install, no Docker: Node.js 24, PostgreSQL, systemd units.
#
#   curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/network-simulator/production/deploy/install.sh | sudo bash
#   ... | sudo bash -s -- --channel test --port 8080 --token <github token for a private repo>
#
# Run it again to repair an installation; existing data and settings are kept.
set -euo pipefail

REPO="rhisijmuiden/network-simulator"
CHANNEL="production"
PORT="8080"
TOKEN=""
APP_USER="netsim"
DB_NAME="network_simulator"
BASE=/opt/network-simulator
ETC=/etc/network-simulator
DATA=/var/lib/network-simulator
UPDATE_STATE=/var/lib/network-simulator-update

while [[ $# -gt 0 ]]; do
    case "$1" in
        --channel) CHANNEL="$2"; shift 2 ;;
        --port) PORT="$2"; shift 2 ;;
        --token) TOKEN="$2"; shift 2 ;;
        --repo) REPO="$2"; shift 2 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done
[[ "$CHANNEL" =~ ^(production|test)$ ]] || { echo "--channel must be production or test" >&2; exit 2; }
[[ $EUID -eq 0 ]] || { echo "run as root (sudo)" >&2; exit 1; }

say() { printf '\n\033[1;38;2;255;107;87m==>\033[0m \033[1m%s\033[0m\n' "$*"; }

. /etc/os-release
if [[ "${ID:-}" != "debian" || "${VERSION_ID:-}" != "13" ]]; then
    echo "Warning: tested on Debian 13, this is ${PRETTY_NAME:-unknown}." >&2
fi

say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git jq postgresql postgresql-client openssl

if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=15)?0:1)'; then
    say "Installing Node.js 24 LTS (NodeSource)"
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
    apt-get update -q
    apt-get install -y -q nodejs
fi
echo "Node.js $(node -v)"

say "Creating user and folders"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin "$APP_USER"
install -d -m 0755 "$BASE" "$BASE/releases"
install -d -m 0750 -o root -g "$APP_USER" "$ETC"
install -d -m 0750 -o "$APP_USER" -g "$APP_USER" "$DATA"
install -d -m 0770 -o "$APP_USER" -g "$APP_USER" "$DATA/update" "$DATA/restore"
install -d -m 0755 "$UPDATE_STATE"
install -d -m 0700 "$UPDATE_STATE/backups"

say "Setting up PostgreSQL"
systemctl enable --now postgresql >/dev/null
runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$APP_USER'" | grep -q 1 ||
    runuser -u postgres -- psql -qc "CREATE ROLE $APP_USER LOGIN"
runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 ||
    runuser -u postgres -- psql -qc "CREATE DATABASE $DB_NAME OWNER $APP_USER"

say "Writing configuration"
if [[ ! -f "$ETC/server.env" ]]; then
    cat >"$ETC/server.env" <<ENV
# Network Simulator server settings. Restart after changes:
#   systemctl restart network-simulator
NETSIM_HOST=0.0.0.0
NETSIM_PORT=$PORT
# PostgreSQL over the local socket with peer authentication (no password).
DATABASE_URL=postgresql://$APP_USER@/$DB_NAME?host=/var/run/postgresql
NETSIM_DATA_DIR=$DATA
NETSIM_UPDATE_STATUS=$UPDATE_STATE/status.json
NETSIM_UPDATE_REPO=$REPO
# Read-only GitHub token, only needed while the repository is private.
NETSIM_UPDATE_TOKEN=$TOKEN
# Set to false when the server is reachable without a reverse proxy in front.
NETSIM_TRUST_PROXY=true
ENV
elif [[ -n "$TOKEN" ]]; then
    sed -i "s|^NETSIM_UPDATE_TOKEN=.*|NETSIM_UPDATE_TOKEN=$TOKEN|" "$ETC/server.env"
fi
chown root:"$APP_USER" "$ETC/server.env"
chmod 0640 "$ETC/server.env"

git_auth() {
    local token
    token=$(sed -n 's/^NETSIM_UPDATE_TOKEN=//p' "$ETC/server.env")
    if [[ -n "$token" ]]; then
        printf -- '-c\nhttp.extraHeader=Authorization: Basic %s\n' "$(printf 'x-access-token:%s' "$token" | base64 -w0)"
    fi
}

say "Downloading the $CHANNEL channel"
mapfile -t AUTH < <(git_auth)
if [[ ! -d "$BASE/repo/.git" ]]; then
    git "${AUTH[@]}" clone --quiet --no-checkout "https://github.com/$REPO.git" "$BASE/repo"
fi
git -C "$BASE/repo" "${AUTH[@]}" fetch --quiet --prune origin "+refs/heads/production:refs/remotes/origin/production" "+refs/heads/test:refs/remotes/origin/test"
COMMIT=$(git -C "$BASE/repo" rev-parse "origin/$CHANNEL")

say "Building release ${COMMIT:0:7} (this takes a few minutes)"
REL="$BASE/releases/$COMMIT"
if [[ ! -f "$REL/.complete" ]]; then
    rm -rf "$REL.tmp"
    mkdir -p "$REL.tmp"
    git -C "$BASE/repo" archive "$COMMIT" | tar -x -C "$REL.tmp"
    (cd "$REL.tmp" && npm ci --no-audit --no-fund --loglevel=error &&
        NETSIM_COMMIT="$COMMIT" NETSIM_BRANCH="$CHANNEL" npm run build --silent &&
        npm prune --omit=dev --no-audit --no-fund --loglevel=error)
    touch "$REL.tmp/.complete"
    rm -rf "$REL"
    mv "$REL.tmp" "$REL"
fi
ln -sfn "$REL" "$BASE/current"

say "Installing helpers and systemd units"
install -m 0755 "$REL/deploy/network-simulator-update" /usr/local/sbin/network-simulator-update
install -m 0755 "$REL/deploy/network-simulator-restore" /usr/local/sbin/network-simulator-restore
install -m 0755 "$REL/deploy/network-simulator-cli" /usr/local/bin/network-simulator
install -m 0644 "$REL"/deploy/systemd/*.service "$REL"/deploy/systemd/*.path /etc/systemd/system/
systemctl daemon-reload

say "Preparing the database"
network-simulator migrate

FIRST_RUN=0
if [[ "$(runuser -u postgres -- psql -tAc "SELECT count(*) FROM users" "$DB_NAME")" == "0" ]]; then
    FIRST_RUN=1
    ADMIN_OUT=$(network-simulator create-admin admin)
fi

systemctl enable --now network-simulator.service network-simulator-update.path network-simulator-restore.path >/dev/null
systemctl restart network-simulator.service

for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break
    sleep 1
done

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
say "Network Simulator is running"
echo "  URL:      http://${IP:-<server-ip>}:$PORT"
echo "  Channel:  $CHANNEL (${COMMIT:0:7})"
if [[ $FIRST_RUN == 1 ]]; then
    echo
    echo "$ADMIN_OUT" | sed 's/^/  /'
fi
echo
echo "  Put it behind your reverse proxy with TLS for use outside your LAN."
echo "  Lost the admin password? Run: sudo network-simulator reset-admin"
