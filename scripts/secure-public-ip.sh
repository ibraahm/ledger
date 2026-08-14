#!/usr/bin/env bash
set -euo pipefail

LEDGER_IP="${LEDGER_IP:-}"
LEDGER_DIR="${LEDGER_DIR:-/opt/ledger}"
ACME_ROOT="/var/www/letsencrypt"
NGINX_SITE="/etc/nginx/sites-available/ledger"
CERTBOT_BIN="/snap/bin/certbot"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi
if [[ -z "${LEDGER_IP}" ]]; then
  echo "Set LEDGER_IP to the public IPv4 address assigned exclusively to this Ledger server."
  echo "Example: sudo LEDGER_IP=203.0.113.10 LETSENCRYPT_EMAIL=you@example.com bash scripts/secure-public-ip.sh"
  exit 1
fi
if [[ ! "${LEDGER_IP}" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "LEDGER_IP must be a public IPv4 address."
  exit 1
fi
IFS=. read -r -a LEDGER_IP_OCTETS <<< "${LEDGER_IP}"
for octet in "${LEDGER_IP_OCTETS[@]}"; do
  if (( 10#${octet} > 255 )); then
    echo "LEDGER_IP must be a valid public IPv4 address."
    exit 1
  fi
done
if [[ ! -f "${LEDGER_DIR}/.env" || ! -f "${LEDGER_DIR}/ecosystem.config.cjs" ]]; then
  echo "Ledger was not found at ${LEDGER_DIR}."
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx snapd
systemctl enable --now nginx snapd.socket

if [[ ! -x "${CERTBOT_BIN}" ]]; then
  snap install core
  snap refresh core
  snap install --classic certbot
else
  snap refresh certbot
fi

CERTBOT_VERSION="$(${CERTBOT_BIN} --version | awk '{print $2}')"
CERTBOT_MAJOR="${CERTBOT_VERSION%%.*}"
CERTBOT_MINOR="$(printf '%s' "${CERTBOT_VERSION}" | cut -d. -f2)"
if (( CERTBOT_MAJOR < 5 || (CERTBOT_MAJOR == 5 && CERTBOT_MINOR < 4) )); then
  echo "Certbot 5.4 or newer is required for webroot IP certificates. Found ${CERTBOT_VERSION}."
  exit 1
fi

install -d -m 0755 "${ACME_ROOT}/.well-known/acme-challenge"

# Bootstrap plain HTTP only long enough for the ACME ownership challenge.
cat > "${NGINX_SITE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${LEDGER_IP};

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
        default_type text/plain;
        try_files \$uri =404;
    }

    location / {
        proxy_pass http://127.0.0.1:4321;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Forwarded-Proto http;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF
ln -sfn "${NGINX_SITE}" /etc/nginx/sites-enabled/ledger
nginx -t
systemctl reload nginx

if [[ ! -f "/etc/letsencrypt/live/${LEDGER_IP}/fullchain.pem" ]]; then
  CONTACT=(--register-unsafely-without-email)
  if [[ -n "${LETSENCRYPT_EMAIL:-}" ]]; then
    CONTACT=(-m "${LETSENCRYPT_EMAIL}")
  fi
  "${CERTBOT_BIN}" certonly \
    --non-interactive \
    --agree-tos \
    "${CONTACT[@]}" \
    --preferred-profile shortlived \
    --webroot \
    --webroot-path "${ACME_ROOT}" \
    --ip-address "${LEDGER_IP}" \
    --cert-name "${LEDGER_IP}"
else
  "${CERTBOT_BIN}" renew --cert-name "${LEDGER_IP}" --quiet
fi

cat > "${NGINX_SITE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${LEDGER_IP};

    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
        default_type text/plain;
        try_files \$uri =404;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${LEDGER_IP};

    ssl_certificate /etc/letsencrypt/live/${LEDGER_IP}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${LEDGER_IP}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:LedgerTLS:10m;
    ssl_session_timeout 1d;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:4321;
        proxy_http_version 1.1;
        proxy_set_header Host \$http_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 10s;
        proxy_read_timeout 120s;
    }
}
EOF
nginx -t
systemctl reload nginx

set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "${LEDGER_DIR}/.env"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${LEDGER_DIR}/.env"
  else
    printf '\n%s=%s\n' "${key}" "${value}" >> "${LEDGER_DIR}/.env"
  fi
}

set_env BIND_HOST 127.0.0.1
set_env PUBLIC_URL "https://${LEDGER_IP}"
chmod 600 "${LEDGER_DIR}/.env"

cat > /usr/local/sbin/ledger-renew-certificate <<EOF
#!/bin/sh
exec ${CERTBOT_BIN} renew --quiet --deploy-hook "systemctl reload nginx"
EOF
chmod 0755 /usr/local/sbin/ledger-renew-certificate

cat > /etc/systemd/system/ledger-cert-renew.service <<'EOF'
[Unit]
Description=Renew Ledger HTTPS certificate
After=network-online.target nginx.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/ledger-renew-certificate
EOF

cat > /etc/systemd/system/ledger-cert-renew.timer <<'EOF'
[Unit]
Description=Check Ledger HTTPS certificate renewal every eight hours

[Timer]
OnCalendar=*-*-* 00/8:15:00
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now ledger-cert-renew.timer

cd "${LEDGER_DIR}"
npm run build
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

sleep 2
curl --fail --silent --show-error "https://${LEDGER_IP}/api/security"
echo
echo "Ledger is secured at https://${LEDGER_IP}"
echo "Certificate renewal timer: $(systemctl is-active ledger-cert-renew.timer)"
ss -ltnp | grep -E ':(80|443|4321)[[:space:]]' || true
