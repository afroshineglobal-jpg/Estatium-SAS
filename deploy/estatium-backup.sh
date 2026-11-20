#!/bin/bash
# Nightly local backup (installed at /usr/local/bin/estatium-backup.sh, run by /etc/cron.d/estatium-backup).
set -euo pipefail
umask 077
D=/var/backups/estatium
TS=$(date +%F-%H%M)
runuser -u postgres -- pg_dump -Fc estatium > "$D/db-$TS.dump"
tar czf "$D/uploads-$TS.tar.gz" -C /var/lib/estatium uploads
find "$D" -type f -mtime +14 -delete
echo "$(date -u +%FT%TZ) backup ok: $TS"
