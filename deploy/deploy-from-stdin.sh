#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

fail() {
  printf 'deployment error: %s\n' "$*" >&2
  exit 1
}

original_command="${SSH_ORIGINAL_COMMAND:-}"
if [[ ! "$original_command" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  fail "unsupported command"
fi
revision="${BASH_REMATCH[1]}"
short_revision="${revision:0:12}"

command -v docker >/dev/null || fail "docker is not installed"
command -v curl >/dev/null || fail "curl is not installed"
command -v tar >/dev/null || fail "tar is not installed"
command -v flock >/dev/null || fail "flock is not installed"
[[ -f /etc/nhanes-agent/model.env ]] || fail "model environment file is missing"

exec 9>/run/lock/nhanes-agent-deploy.lock
flock -n 9 || fail "another deployment is running"

archive="$(mktemp /tmp/nhanes-agent-release.XXXXXX.tar.gz)"
release_root="/opt/nhanes-agent/releases"
mkdir -p "$release_root"
release_dir="$(mktemp -d "$release_root/${revision}.XXXXXX")"
deployment_complete=false

cleanup() {
  rm -f -- "$archive"
  if [[ "$deployment_complete" != true ]]; then
    rm -rf -- "$release_dir"
  fi
}
trap cleanup EXIT

cat >"$archive"
archive_size="$(stat -c '%s' "$archive")"
(( archive_size > 0 )) || fail "empty release archive"
(( archive_size <= 20971520 )) || fail "release archive exceeds 20 MiB"

while IFS= read -r path; do
  case "$path" in
    /*|..|../*|*/../*|*/..)
      fail "unsafe archive path"
      ;;
  esac
done < <(tar -tzf "$archive")

if tar -tvzf "$archive" | cut -c1 | grep -Ev '^[-d]$' >/dev/null; then
  fail "archive contains links or special files"
fi

tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$release_dir"
[[ -f "$release_dir/Dockerfile" ]] || fail "Dockerfile is missing"
[[ -f "$release_dir/package.json" ]] || fail "package.json is missing"

image="nhanes-research-agent:sha-${short_revision}"
docker build \
  --build-arg DEBIAN_MIRROR=mirrors.aliyun.com \
  --label "org.opencontainers.image.revision=$revision" \
  --tag "$image" \
  "$release_dir"

rollback_container=""
restore_previous() {
  trap - ERR
  docker rm -f nhanes-agent >/dev/null 2>&1 || true
  if [[ -n "$rollback_container" ]] && docker inspect "$rollback_container" >/dev/null 2>&1; then
    docker rename "$rollback_container" nhanes-agent
    docker start nhanes-agent >/dev/null
  fi
}
trap 'restore_previous' ERR

if docker inspect nhanes-agent >/dev/null 2>&1; then
  rollback_container="nhanes-agent-rollback-${short_revision}-$(date +%s)"
  docker stop nhanes-agent >/dev/null
  docker rename nhanes-agent "$rollback_container"
fi

docker run -d \
  --name nhanes-agent \
  --restart unless-stopped \
  --env-file /etc/nhanes-agent/model.env \
  --env NODE_ENV=production \
  --env PORT=4173 \
  --env DATABASE_PATH=/data/nhanes.sqlite \
  --env AUTO_BACKUP_ENABLED=true \
  --env BACKUP_PATH=/data/backups \
  --env BACKUP_INTERVAL_HOURS=24 \
  --env BACKUP_RETENTION_DAYS=14 \
  --env BACKUP_MAX_FILES=30 \
  --env DATA_CACHE_PATH=/data/xpt-cache \
  --env DATA_ROOT=/data \
  --publish 80:4173 \
  --read-only \
  --tmpfs /tmp:size=256m,mode=1777 \
  --volume nhanes_app_data:/data \
  --label "org.opencontainers.image.revision=$revision" \
  "$image" >/dev/null

healthy=false
for _ in $(seq 1 60); do
  if [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' nhanes-agent 2>/dev/null)" == healthy ]] \
    && curl -fsS --max-time 5 http://127.0.0.1/api/health >/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done
if [[ "$healthy" != true ]]; then
  restore_previous
  fail "new container did not become healthy"
fi

ln -sfn "$release_dir" /opt/nhanes-agent-current
deployment_complete=true
trap - ERR

printf 'deployed %s\n' "$revision"
curl -fsS --max-time 5 http://127.0.0.1/api/health
printf '\n'
