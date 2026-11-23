#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server (Linode, DigitalOcean, Lightsail…) for PingZest.
# Run as root:   bash setup-server.sh app.example.com you@example.com
# Installs: Node 22, PM2 (+ log rotation, start on boot), nginx, Let's Encrypt SSL (auto-renew),
# firewall, fail2ban, automatic security updates, 1 GB swap, and a "deploy" user for GitHub Actions.
set -euo pipefail

DOMAIN="${1:?Usage: setup-server.sh <domain> <email for SSL notices>}"
EMAIL="${2:?Usage: setup-server.sh <domain> <email for SSL notices>}"
APP_DIR=/var/www/pingzest
DEPLOY_USER=deploy
REPO_RAW="https://raw.githubusercontent.com/videsh-dp/PingZest/main"

log() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }

log "System updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get upgrade -y
apt-get install -y curl git ufw fail2ban unattended-upgrades nginx certbot python3-certbot-nginx
dpkg-reconfigure -f noninteractive unattended-upgrades

log "Swap (1 GB) so installs and builds don't run out of memory"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

log "Firewall: SSH, HTTP, HTTPS only"
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
systemctl enable --now fail2ban

log "Node.js 22 and PM2"
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2@latest

log "Deploy user and folders"
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
mkdir -p "$APP_DIR"/{releases,shared/logs} /var/www/certbot
touch "$APP_DIR/shared/.env" && chmod 600 "$APP_DIR/shared/.env"
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$APP_DIR"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /home/$DEPLOY_USER/.ssh
touch /home/$DEPLOY_USER/.ssh/authorized_keys
chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys && chown "$DEPLOY_USER":"$DEPLOY_USER" /home/$DEPLOY_USER/.ssh/authorized_keys
# GitHub Actions key: generated here, private half goes into the GitHub secret DEPLOY_SSH_KEY.
if [ ! -f /root/pingzest-deploy-key ]; then
  ssh-keygen -t ed25519 -N "" -C "github-actions-pingzest" -f /root/pingzest-deploy-key >/dev/null
  cat /root/pingzest-deploy-key.pub >> /home/$DEPLOY_USER/.ssh/authorized_keys
fi

log "PM2: start on boot, rotate logs"
sudo -u "$DEPLOY_USER" pm2 install pm2-logrotate >/dev/null || true
sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:max_size 10M >/dev/null || true
sudo -u "$DEPLOY_USER" pm2 set pm2-logrotate:retain 7 >/dev/null || true
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$DEPLOY_USER" --hp /home/$DEPLOY_USER >/dev/null

log "COD autopilot schedule (every 15 minutes, keeps quiet stores on time)"
ENV_FILE="$APP_DIR/shared/.env"
if ! grep -q '^CRON_SECRET=' "$ENV_FILE"; then
  echo "CRON_SECRET=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)" >> "$ENV_FILE"
fi
cat > "$APP_DIR/shared/cron-cod.sh" <<'CRONSH'
#!/usr/bin/env bash
# Called by cron: asks the local app to run the COD autopilot. The secret never leaves the server.
secret=$(grep '^CRON_SECRET=' /var/www/pingzest/shared/.env | cut -d= -f2-)
curl -fsS -m 60 -X POST -H "Authorization: Bearer $secret" http://127.0.0.1:3000/cron/cod >/dev/null
CRONSH
chmod 700 "$APP_DIR/shared/cron-cod.sh" && chown "$DEPLOY_USER":"$DEPLOY_USER" "$APP_DIR/shared/cron-cod.sh" "$ENV_FILE"
( sudo -u "$DEPLOY_USER" crontab -l 2>/dev/null | grep -v cron-cod.sh; echo "*/15 * * * * $APP_DIR/shared/cron-cod.sh" ) | sudo -u "$DEPLOY_USER" crontab -

log "nginx"
curl -fsSL "$REPO_RAW/deploy/nginx/pingzest-proxy.conf" -o /etc/nginx/snippets/pingzest-proxy.conf
curl -fsSL "$REPO_RAW/deploy/nginx/pingzest.conf" | sed "s/DOMAIN/$DOMAIN/g" > /etc/nginx/sites-available/pingzest
ln -sf /etc/nginx/sites-available/pingzest /etc/nginx/sites-enabled/pingzest
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

log "SSL certificate (Let's Encrypt). The domain's DNS must already point to this server."
if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
  systemctl enable --now certbot.timer
else
  echo "⚠ SSL failed. Check that $DOMAIN points to this server's IP (Cloudflare: 'DNS only', grey cloud), then run:"
  echo "   certbot --nginx -d $DOMAIN -m $EMAIL --agree-tos --redirect"
fi

cat <<DONE

✅ Server ready.

Next:
 1. Fill in the app settings:     nano $APP_DIR/shared/.env     (template: .env.example in the repo)
 2. In GitHub → Settings → Secrets and variables → Actions:
      Variable  DEPLOY_HOST     = $(curl -fsS https://api.ipify.org 2>/dev/null || echo "<this server's IP>")
      Variable  DEPLOY_USER     = $DEPLOY_USER
      Secret    DEPLOY_SSH_KEY  = the text below (all lines)
 3. Push to main (or re-run the CI workflow). Tests run, then the app deploys here.

----- DEPLOY_SSH_KEY (copy everything between the lines) -----
$(cat /root/pingzest-deploy-key)
---------------------------------------------------------------
DONE
