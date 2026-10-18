#!/usr/bin/env bash
# Call the shop's maintenance route and print ONLY what is safe in a public log.
#
# This repository is public, so its Actions logs are readable by anyone. The
# maintenance response carries raw error text (database, supplier, payment
# provider), and a failed request's body or headers can carry anything. So:
#
#   - the token goes to curl through a header file, never on its command line;
#   - nothing from the response body is printed except numeric counts and the
#     NAMES of steps that reported an error (maintenance-report.mjs);
#   - a failed request prints its status code and a short category, never the
#     body, headers or curl's own error text;
#   - no shell trace, whatever the caller set.
#
# Inputs (environment): CRON_SECRET (the repository secret), SITE (the shop's
# origin), MAINTENANCE_ROUTE (default /api/cron/maintenance),
# MAINTENANCE_MAX_TIME (seconds, default 60).
set +x
set -u

if [ -z "${CRON_SECRET:-}" ]; then
  echo "::notice::CRON_SECRET is not set as a repository secret — skipping. See the comment at the top of the workflow."
  exit 0
fi

run_ref="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
route="${MAINTENANCE_ROUTE:-/api/cron/maintenance}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
umask 077
printf 'Authorization: Bearer %s\n' "$CRON_SECRET" > "$work/headers"

code="$(curl -s -o "$work/body" -w '%{http_code}' --max-time "${MAINTENANCE_MAX_TIME:-60}" \
  -H @"$work/headers" "${SITE}${route}" 2>/dev/null)"
rc=$?
rm -f "$work/headers"

if [ "$rc" -ne 0 ]; then
  case "$rc" in
    28) category="timeout" ;;
    6|7) category="network (could not connect)" ;;
    35|51|58|60) category="network (TLS)" ;;
    *) category="network" ;;
  esac
  echo "::error::Maintenance call failed — category: ${category} (curl exit ${rc}), run ${run_ref}"
  exit 1
fi

echo "HTTP ${code} (run ${run_ref})"
if [ "$code" = "200" ]; then
  node "$(dirname "$0")/maintenance-report.mjs" "$work/body" || echo "Summary could not be read (not printed)."
  exit 0
fi

case "$code" in
  401|403) category="auth — CRON_SECRET in GitHub and Vercel do not match" ;;
  404) category="not found — wrong SITE or route" ;;
  429) category="rate limited" ;;
  5??) category="server error — see the Vercel logs" ;;
  *) category="unexpected status" ;;
esac
echo "::error::Maintenance answered ${code} — category: ${category}, run ${run_ref}"
exit 1
