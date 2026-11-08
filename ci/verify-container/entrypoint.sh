#!/bin/sh
# Container-local harness home: no host DSH state or build is read, and the only
# host credentials are the podman secrets run.sh mounts. The profile itself (package.json, cordis.patch.yml) was composed into the image;
# this script only prepares the writable home and starts the Web host.
set -eu

export HOME=/home/dsh
export DSH_HOME=/home/dsh/.dsh
PROFILE="$DSH_HOME/profiles/verify"

# Skill discovery for the preset rows, and the read-only credential mount target.
mkdir -p /home/dsh/.agents /home/dsh/.claude "$DSH_HOME"

# The credential store must be writable: a sign-in inside this container has to
# persist its grant. Seed it once from the mounted secret, which podman exposes
# read-only; later sign-ins win because an existing file is never overwritten.
SEED=/run/anago-secrets/credentials.yaml
if [ -f "$SEED" ] && [ ! -f "$DSH_HOME/.credentials.yaml" ]; then
  install -m 600 "$SEED" "$DSH_HOME/.credentials.yaml"
fi
[ -f "$PROFILE/package.json" ] || { echo "entrypoint: missing profile at $PROFILE" >&2; exit 1; }

# The Web host rejects a wildcard bind, so bind the container's own interface;
# podman publishes that port on 100.110.252.31.
BIND_HOST=$(node -e "const os=require('node:os');for(const a of Object.values(os.networkInterfaces()))for(const i of a??[])if(i.family==='IPv4'&&!i.internal){console.log(i.address);process.exit(0)}process.exit(1)")
[ -n "$BIND_HOST" ] || { echo 'entrypoint: no container IPv4 address' >&2; exit 1; }

exec node /app/apps/cli/lib/bin.js --profile verify \
  --host "$BIND_HOST" --port 8083 \
  --public-url http://100.110.252.31:8083 \
  --trusted-host 100.110.252.31:8083 \
  --no-open
