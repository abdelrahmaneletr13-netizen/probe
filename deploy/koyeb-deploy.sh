#!/usr/bin/env bash
# One-shot Koyeb deploy for the pentest-ide backend.
#
# Usage:
#   KOYEB_TOKEN=xxxx APP_NAME=pentest-ide ./deploy/koyeb-deploy.sh
#
# Requirements:
#   - You signed up at https://app.koyeb.com (no credit card needed for the
#     free starter plan).
#   - You connected your GitHub account to Koyeb at:
#       https://app.koyeb.com/services/deploy/github
#     and granted access to the `probe` repository.
#   - You generated a personal API token at:
#       https://app.koyeb.com/account/api
#
# What this does:
#   1. Logs the koyeb CLI in with your token.
#   2. Creates (or updates) a service that builds docker/Dockerfile.backend
#      from the GitHub repo on every push to main.
#   3. Sets PENTEST_IDE_API_KEYS to a freshly generated random key.
#   4. Prints the public URL and the API key so you can connect the extension.

set -euo pipefail

: "${KOYEB_TOKEN:?Set KOYEB_TOKEN to your Koyeb personal API token}"
APP_NAME="${APP_NAME:-pentest-ide}"
GIT_URL="${GIT_URL:-github.com/abdelrahmaneletr13-netizen/probe}"
GIT_BRANCH="${GIT_BRANCH:-main}"
REGION="${REGION:-fra}"
INSTANCE_TYPE="${INSTANCE_TYPE:-free}"

KOYEB_BIN="${KOYEB_BIN:-$HOME/.koyeb/bin/koyeb}"
if [ ! -x "$KOYEB_BIN" ]; then
  echo "koyeb CLI not found at $KOYEB_BIN — install it with:"
  echo "  curl -fsSL https://raw.githubusercontent.com/koyeb/koyeb-cli/master/install.sh | sh"
  exit 1
fi

API_KEY="$(openssl rand -hex 32)"

echo "▶ Logging in to Koyeb…"
mkdir -p "$HOME/.config/koyeb"
cat > "$HOME/.config/koyeb/config.yaml" <<EOF
token: $KOYEB_TOKEN
EOF

echo "▶ Creating/updating Koyeb app & service: $APP_NAME"
if "$KOYEB_BIN" app get "$APP_NAME" >/dev/null 2>&1; then
  echo "  app exists, redeploying service…"
  "$KOYEB_BIN" service update "$APP_NAME/$APP_NAME" \
    --git "$GIT_URL" \
    --git-branch "$GIT_BRANCH" \
    --git-builder docker \
    --git-docker-dockerfile docker/Dockerfile.backend \
    --instance-type "$INSTANCE_TYPE" \
    --regions "$REGION" \
    --ports 8787:http \
    --routes /:8787 \
    --env "PENTEST_IDE_API_KEYS=$API_KEY" \
    --env "REQUIRE_PUBLIC_TARGETS=true" \
    --env "LOG_PRETTY=false" \
    --env "PORT=8787"
else
  "$KOYEB_BIN" app init "$APP_NAME" \
    --git "$GIT_URL" \
    --git-branch "$GIT_BRANCH" \
    --git-builder docker \
    --git-docker-dockerfile docker/Dockerfile.backend \
    --instance-type "$INSTANCE_TYPE" \
    --regions "$REGION" \
    --ports 8787:http \
    --routes /:8787 \
    --env "PENTEST_IDE_API_KEYS=$API_KEY" \
    --env "REQUIRE_PUBLIC_TARGETS=true" \
    --env "LOG_PRETTY=false" \
    --env "PORT=8787"
fi

echo
echo "✅ Deploy submitted."
echo
echo "Once the service is healthy, your URL will be:"
echo "    https://${APP_NAME}-<your-koyeb-org>.koyeb.app"
echo "(exact URL is shown in the Koyeb dashboard)"
echo
echo "API KEY for the extension (save this!):"
echo "    $API_KEY"
echo
echo "Watch progress with:"
echo "    $KOYEB_BIN service logs $APP_NAME/$APP_NAME"
