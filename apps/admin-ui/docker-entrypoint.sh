#!/bin/sh
# Build /etc/nginx/.htpasswd from ADMIN_USER + ADMIN_PASSWORD on every
# container start, so rotating the password is just a `docker compose
# restart mediago-admin` away — no rebuild, no baked-in credentials.
set -e

: "${ADMIN_USER:=admin}"
if [ -z "${ADMIN_PASSWORD}" ]; then
  echo "ERROR: ADMIN_PASSWORD env var is required" >&2
  exit 1
fi

# Use the already-installed apache2-utils htpasswd to avoid hand-rolling
# crypt(3); -B asks for bcrypt, -b reads the password from argv (one
# layer of process visibility, but the container is single-tenant and
# the value is already in env).
htpasswd -B -b -c /etc/nginx/.htpasswd "${ADMIN_USER}" "${ADMIN_PASSWORD}"
# nginx workers drop to the `nginx` user — chown so they can read the
# bcrypt hashes; mode 640 keeps it out of reach of anyone else who
# happens to share the container.
chown root:nginx /etc/nginx/.htpasswd
chmod 640 /etc/nginx/.htpasswd

exec "$@"
