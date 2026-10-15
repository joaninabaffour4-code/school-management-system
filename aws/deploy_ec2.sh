#!/usr/bin/env bash
# Production EC2 Deployment Script for School Management System
# Target OS: Ubuntu 22.04 / 24.04 LTS (Amazon EC2 t3.small / t4g.small)

set -euo pipefail

echo "=== Starting School Management System EC2 Deployment ==="

# 1. Update OS and install prerequisites
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y curl git ufw nginx certbot python3-certbot-nginx sqlite3

# 2. Install Node.js 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# 3. Create dedicated system user
sudo id -u schoolapp &>/dev/null || sudo useradd -m -s /bin/bash schoolapp

APP_DIR="/opt/school-management-system"
sudo mkdir -p "$APP_DIR"
sudo chown -R schoolapp:schoolapp "$APP_DIR"

# 4. Copy project files and install production dependencies
# (Assumes repo cloned to /tmp/repo or deployed via git)
cd "$APP_DIR"
sudo -u schoolapp npm ci --omit=dev

# 5. Run initial database migration & seeding
sudo -u schoolapp npm run migrate
sudo -u schoolapp npm run seed

# 6. Configure systemd service
sudo tee /etc/systemd/system/school-system.service > /dev/null <<EOF
[Unit]
Description=School Management System Node.js Service
After=network.target

[Service]
Type=simple
User=schoolapp
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5s
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable school-system.service
sudo systemctl restart school-system.service

# 7. Configure Nginx Reverse Proxy
sudo tee /etc/nginx/sites-available/school-system > /dev/null <<'EOF'
server {
    listen 80;
    server_name _;

    # Security Headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/school-system /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# 8. Configure Firewall (UFW)
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

echo "=== Deployment Complete! Application listening via Nginx on port 80 ==="
echo "To attach SSL/TLS: sudo certbot --nginx -d your-domain.com"
