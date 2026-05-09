#!/usr/bin/env bash
#
# pin-image-digests.sh — refresh upstream image digests pinned in
# docker-compose.prod.yml.
#
# Usage:
#   ./scripts/pin-image-digests.sh                 # report only
#   ./scripts/pin-image-digests.sh --apply         # rewrite the compose file
#
# Why this exists: every upstream image (nginx, postgis, redis, minio,
# gotenberg) is pinned in compose as `tag@sha256:digest` so that
# `docker compose up` is byte-reproducible. When upstream rebuilds, the
# digest behind the same tag changes; this script fetches the current
# manifest digest from the registry and (with --apply) rewrites the
# compose file in-place.
#
# Frequency: re-run before each release-bundle build to pick up
# upstream security patches. The bundle then carries the new digests
# baked in.
#
# Requires: docker manifest support (Docker ≥ 19.03), python3 (for
# JSON parsing), sed (in-place edit). Network access to the registry.

set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

# tag-only image references that the script knows how to refresh.
# Keep in lock-step with the `image:` lines in compose.
declare -a IMAGES=(
  "nginx:1.27-alpine"
  "postgis/postgis:16-3.4"
  "redis:7-alpine"
  "minio/minio:RELEASE.2025-01-20T14-49-07Z"
  "gotenberg/gotenberg:8"
)

current_digest_for() {
  local image="$1"
  # `manifest inspect` returns the index manifest for multi-arch images.
  # We pin the platform-specific amd64 digest where the index resolves
  # to one (matches our linux/amd64-only prod). Falls through to the
  # top-level Descriptor digest for single-arch images.
  docker manifest inspect --verbose "$image" 2>/dev/null | python3 -c '
import sys, json
data = json.load(sys.stdin)
# Newer Docker returns a list of {Ref, Descriptor, ...}; older docker
# returns the inner manifest directly.
if isinstance(data, list):
    for entry in data:
        plat = entry.get("Descriptor", {}).get("platform", {})
        if plat.get("architecture") == "amd64" and plat.get("os") == "linux":
            print(entry["Descriptor"]["digest"])
            sys.exit(0)
    # Fallback: first entry.
    print(data[0]["Descriptor"]["digest"])
elif isinstance(data, dict) and "Descriptor" in data:
    print(data["Descriptor"]["digest"])
elif isinstance(data, dict) and "manifests" in data:
    for m in data["manifests"]:
        plat = m.get("platform", {})
        if plat.get("architecture") == "amd64" and plat.get("os") == "linux":
            print(m["digest"])
            sys.exit(0)
    sys.exit(1)
else:
    sys.exit(1)
'
}

cd "$(dirname "$0")/.."

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: $COMPOSE_FILE missing — run from repo root."
  exit 2
fi

declare -A REWRITES=()
declare -i unchanged=0 changed=0 missing=0

for image in "${IMAGES[@]}"; do
  echo "→ $image"
  digest="$(current_digest_for "$image" || true)"
  if [[ -z "$digest" ]]; then
    echo "  WARNING: could not resolve digest (offline? auth?). Skipping."
    ((missing+=1))
    continue
  fi

  # Find the pinned digest in compose for this exact tag.
  current_in_compose="$(grep -E "^\s*image: ${image//./\\.}@sha256:[a-f0-9]+" "$COMPOSE_FILE" | head -1 | sed -E 's/.*sha256:([a-f0-9]+).*/\1/' || true)"
  fresh_short="${digest#sha256:}"

  if [[ "$current_in_compose" == "$fresh_short" ]]; then
    echo "  unchanged ($digest)"
    ((unchanged+=1))
  else
    echo "  $current_in_compose → $fresh_short"
    REWRITES["$image"]="$digest"
    ((changed+=1))
  fi
done

echo ""
echo "Summary: $unchanged unchanged · $changed updated · $missing skipped"

if [[ $APPLY -eq 0 ]]; then
  if (( changed > 0 )); then
    echo ""
    echo "Re-run with --apply to rewrite $COMPOSE_FILE."
  fi
  exit 0
fi

if (( changed == 0 )); then
  echo "Nothing to apply."
  exit 0
fi

# Apply rewrites. Keep a .bak so the operator can diff post-edit.
cp "$COMPOSE_FILE" "$COMPOSE_FILE.bak"
for image in "${!REWRITES[@]}"; do
  digest="${REWRITES[$image]}"
  # `image:tag@sha256:OLD` → `image:tag@sha256:NEW`. Anchored to the
  # exact tag to avoid catching another image that shares the prefix.
  esc_image="${image//./\\.}"
  esc_image="${esc_image//\//\\/}"
  sed -i -E "s|(${esc_image})@sha256:[a-f0-9]+|\1@${digest}|g" "$COMPOSE_FILE"
  echo "  applied: $image"
done

echo ""
echo "Wrote $COMPOSE_FILE — backup at $COMPOSE_FILE.bak"
echo "Validate with:  docker compose -f $COMPOSE_FILE config >/dev/null"
