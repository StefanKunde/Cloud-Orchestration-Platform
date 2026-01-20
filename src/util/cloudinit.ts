import crypto from 'node:crypto';

export function buildUserDataBase64(opts: {
  adminApiKey: string;
  controlApiUrl: string;
}) {
  const cloudInit = `## template: jinja
#cloud-config
package_update: true
package_upgrade: false
packages: [chrony]

write_files:
  - path: /usr/local/sbin/setup-networking.sh
    permissions: '0755'
    owner: root:root
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      IFACE="$(ip -4 route show default 2>/dev/null | sed -n 's/.* dev \\([^ ]*\\).*/\\1/p' | head -n1 || true)"
      [[ -z "\${IFACE}" ]] && { echo "[setup-networking] No default interface"; exit 1; }
      echo "[setup-networking] Configuring interface \${IFACE}"
      systemctl restart chrony || true

  - path: /usr/local/sbin/deploy-admin-service.sh
    permissions: '0755'
    owner: root:root
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      DIR="/opt/admin-service"
      NAME="task-admin-api"

      log(){ echo "[deploy-service] \$*"; }

      if [ -d "\$DIR/.git" ]; then
        cd "\$DIR"
        git config --global --add safe.directory "\$DIR" || true
        log "Updating repo"
        git fetch origin master --prune || true
        git clean -fd || true
        git reset --hard origin/master || true

        if [ -f package-lock.json ]; then
          npm ci || npm install || true
        else
          npm install || true
        fi
        npm run build || true
      else
        log "Repository not found at \$DIR"
      fi

      if systemctl list-unit-files | grep -q "^task-admin-api\\.service"; then
        systemctl daemon-reload
        systemctl restart task-admin-api || systemctl start task-admin-api || true
      elif command -v pm2 >/dev/null 2>&1; then
        PM2="\$(command -v pm2)"
        cd "\$DIR"
        "\$PM2" restart "\$NAME" --update-env || "\$PM2" start "node dist/main.js" --name "\$NAME" --update-env --time || true
        "\$PM2" save || true
      else
        log "No systemd or pm2 available"
      fi

  - path: /usr/local/sbin/signal-ready.sh
    permissions: '0755'
    owner: root:root
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      CTRL="${opts.controlApiUrl}"
      IID="{{ v1.instance_id }}"
      HN="$(hostname)"
      BODY="$(printf '{\"instance_id\":\"%s\",\"hostname\":\"%s\"}' "$IID" "$HN")"
      curl -sSf -H 'Content-Type: application/json' -X POST "$CTRL/api/provisioning/phone-home/$IID/done" -d "$BODY" || true

  - path: /etc/task-provisioning.env
    permissions: '0640'
    owner: root:root
    content: |
      ADMIN_API_KEY=${opts.adminApiKey}
      CONTROL_API_URL=${opts.controlApiUrl}

runcmd:
  - [ bash, -lc, "/usr/local/sbin/setup-networking.sh" ]
  - [ bash, -lc, "/usr/local/sbin/deploy-admin-service.sh" ]
  - [ bash, -lc, "/usr/local/sbin/signal-ready.sh || true" ]

phone_home:
  url: "${opts.controlApiUrl}/provisioning/phone-home/{{ v1.instance_id }}/done"
  post: [instance_id, hostname]
  tries: 5
  timeout: 10
`;

  const b64 = Buffer.from(cloudInit, 'utf8').toString('base64');
  const hash = crypto.createHash('sha1').update(cloudInit).digest('hex');
  return { b64, hash, cloudInit };
}
