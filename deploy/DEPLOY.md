# Deploying Estatium on the VPS (nginx + systemd + PostgreSQL, no Docker)

Layout on the server
- Code: `/opt/estatium/app` (git clone, owner `estatium`, deploy key read-only)
- Env file: `/etc/estatium/estatium.env` (root:estatium, mode 640) — copy of `deploy/estatium.env.example`
- Built client: `/var/www/estatium` (served by nginx)
- Uploads (selfies): `/var/lib/estatium/uploads` (private)
- Service: `estatium.service` on 127.0.0.1:3001 (never exposed directly; UFW needs no change)
- Other apps on the box (soulharb.com, VMS on :4000) are never touched by these steps.

## Install dependencies (always from the official npm registry, lock files verified)
```bash
cd /opt/estatium/app/server && sudo -H -u estatium npm ci --ignore-scripts && sudo -H -u estatium npx prisma generate
cd ../client && sudo -H -u estatium npm ci --ignore-scripts && sudo -H -u estatium npm run build
sudo mkdir -p /var/www/estatium && sudo rm -rf /var/www/estatium/* && sudo cp -a dist/. /var/www/estatium/
```

## Every deploy (update)
1. `sudo /usr/local/bin/estatium-backup.sh`            (fresh database backup first)
2. `sudo -H -u estatium git -C /opt/estatium/app pull --ff-only`
3. Apply any new `server/sql/00N_*.sql` as the OWNER role (see below); never edit applied files.
4. Re-run the install block above if `package-lock.json` changed; rebuild the client if `client/` changed.
   If `server/prisma/schema.prisma` changed, ALSO run `sudo -H -u estatium npx prisma generate` (in `server/`) before restarting.
5. `sudo systemctl restart estatium && sudo systemctl status estatium --no-pager`
6. `curl -s http://127.0.0.1:3001/api/health` should return `{"status":"OK",...}`

## Applying a SQL migration
```bash
OWNER_URL=$(grep '^OWNER_URL=' /root/estatium-db-credentials.txt | cut -d= -f2-)
psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f server/sql/00N_name.sql; unset OWNER_URL
```
Test every migration first on a scratch copy: `createdb estatium_test`, load the three base files, run the isolation test.

## Roll back
1. `sudo systemctl stop estatium`
2. `sudo -H -u estatium git -C /opt/estatium/app checkout <previous-commit>` and rebuild as above.
3. If the database changed: restore with `pg_restore --clean --if-exists -d estatium /var/backups/estatium/db-<stamp>.dump` (as postgres).
4. `sudo systemctl start estatium`

## Never
- Put real values in git. Secrets live only in `/etc/estatium/estatium.env` and the root credentials file.
- Run the app as the owner role or as root.
- Open new firewall ports. Postgres and the app listen on 127.0.0.1 only.
