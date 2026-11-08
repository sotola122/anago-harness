#!/usr/bin/env bash
# Build the verification image, refresh its secrets, and run the Web host on
# 100.110.252.31:8083. `./run.sh stop` removes the container.
#
# The fork must not reach DeepSeek/China endpoints, so their names resolve to
# loopback inside the container: an accidental request fails immediately and
# shows up in the log instead of silently succeeding.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
IMAGE=anago-verify:8083
NAME=anago-verify-8083
HOST_IP=100.110.252.31
PORT=8083
CREDENTIALS=/home/hwd/.dsh/.credentials.yaml
CLAUDE_CREDENTIALS=/home/hwd/.claude/.credentials.json
SECRET_KEY=anago-opencode-go
SECRET_COMMANDCODE=anago-commandcode
SECRET_CLAUDE=anago-claude-credentials
SECRET_STORE=anago-dsh-credentials
BLACKHOLED=(
  api.deepseek.com
  chat.deepseek.com
  platform.deepseek.com
  download.deepseek.com
  www.deepseek.com
  dsh-otel-collector.deepseeksvc.com
  registry.npmmirror.com
)

if [[ ${1:-} == stop ]]; then
  podman rm -f "$NAME" >/dev/null 2>&1 || true
  echo "stopped and removed $NAME"
  exit 0
fi

command -v podman >/dev/null || { echo 'run.sh: podman is required' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'run.sh: python3 is required' >&2; exit 1; }

# A transient verification unit from UPSTREAM_MIGRATION.md may hold this port.
systemctl --user stop anago-verify-8083 2>/dev/null || true

need_credential() {
  python3 - "$CREDENTIALS" "$1" <<'PY'
import sys
try:
    import yaml
except ImportError:
    sys.exit('run.sh: python3 PyYAML is required to read the credentials document')
try:
    with open(sys.argv[1], encoding='utf-8') as handle:
        document = yaml.safe_load(handle) or {}
except OSError as error:
    sys.exit(f'run.sh: cannot read {sys.argv[1]}: {error}')
refs = document.get('refs') or {}
if not isinstance(refs.get(sys.argv[2]), str) or not refs[sys.argv[2]]:
    sys.exit(f'run.sh: {sys.argv[2]} is missing from {sys.argv[1]}')
PY
}

emit_credential() {
  python3 - "$CREDENTIALS" "$1" <<'PY'
import sys, yaml
with open(sys.argv[1], encoding='utf-8') as handle:
    sys.stdout.write((yaml.safe_load(handle) or {})['refs'][sys.argv[2]])
PY
}

[[ -r $CLAUDE_CREDENTIALS ]] || { echo "run.sh: missing $CLAUDE_CREDENTIALS" >&2; exit 1; }
need_credential OPENCODE_GO_API_KEY
need_credential COMMANDCODE_API_KEY

echo "building $IMAGE"
build_start=$(date +%s)
podman build \
  --file "$HERE/Containerfile" \
  --ignorefile "$HERE/containerignore" \
  --build-arg "DSH_CLIENT_COMMIT_HASH=$(git -C "$ROOT" rev-parse HEAD)" \
  --tag "$IMAGE" \
  "$ROOT"
echo "built in $(( $(date +%s) - build_start ))s"

# A running container may pin the old secret, so remove it before replacing.
podman rm -f "$NAME" >/dev/null 2>&1 || true
emit_credential OPENCODE_GO_API_KEY | podman secret create --replace "$SECRET_KEY" -
emit_credential COMMANDCODE_API_KEY | podman secret create --replace "$SECRET_COMMANDCODE" -
podman secret create --replace "$SECRET_CLAUDE" "$CLAUDE_CREDENTIALS" >/dev/null
podman secret create --replace "$SECRET_STORE" "$CREDENTIALS" >/dev/null

run_args=()
for host in "${BLACKHOLED[@]}"; do
  run_args+=(--add-host "$host:127.0.0.1")
done

podman run --detach --name "$NAME" \
  --publish "$HOST_IP:$PORT:$PORT" \
  "${run_args[@]}" \
  --secret "$SECRET_KEY,type=env,target=OPENCODE_GO_API_KEY" \
  --secret "$SECRET_COMMANDCODE,type=env,target=COMMANDCODE_API_KEY" \
  --secret "$SECRET_CLAUDE,type=mount,target=/home/dsh/.claude/.credentials.json" \
  --secret "$SECRET_STORE,type=mount,target=/run/anago-secrets/credentials.yaml" \
  "$IMAGE" >/dev/null

url=''
for _ in $(seq 1 120); do
  url=$(podman logs "$NAME" 2>&1 | sed -n 's/^dsh web: \(http[^ ]*\)$/\1/p' | tail -1)
  [[ -n $url ]] && break
  podman container exists "$NAME" || break
  sleep 1
done

if [[ -z $url ]]; then
  echo 'run.sh: the Web host did not print a launch URL' >&2
  podman logs "$NAME" 2>&1 | tail -40 >&2 || true
  exit 1
fi

echo "launch URL: $url"
echo "logs: podman logs -f $NAME   stop: $HERE/run.sh stop"
