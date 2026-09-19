#!/usr/bin/env bash
#
# Tells a human that something on this server failed. Started by
# frybird-alert@.service (OnFailure= of the backup, the job runner and the
# failed-job unit). Installed as /usr/local/bin/frybird-notify.
#
#   frybird-notify <what failed>   e.g. frybird-notify frybird-backup.service
#                                       frybird-notify "job heartbeat"
#
# Channel: one HTTPS URL in /etc/frybird/alert.env as ALERT_URL, which the
# script POSTs a short plain-text body to (ntfy.sh topic, or any endpoint that
# accepts a text POST). The message is the unit name, host and UTC time and
# nothing else: no journal lines, so no secret or customer data can ride along
# to a third party. If ALERT_URL is unset the script still records the failure
# in the journal (priority err) and exits non-zero, so the unconfigured state
# is visible in `systemctl --failed` rather than silent.
set -euo pipefail

what="${1:?usage: frybird-notify <what failed>}"
host="$(hostname -s)"
when="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
msg="FRYBIRD ALERT: ${what} failed on ${host} at ${when}. On the server: journalctl -e -p err"

logger -p user.err -t frybird-alert "$msg"

if [ -z "${ALERT_URL:-}" ]; then
  echo "ALERT_URL is not set in /etc/frybird/alert.env; alert was only logged" >&2
  exit 1
fi

# The URL is a credential (an ntfy topic URL can read and post), so it must
# never be on curl's command line: /proc/<pid>/cmdline is world-readable on
# Ubuntu. printf is a shell builtin (no exec, no argv), and curl reads the
# `url = "..."` line from stdin via --config -, so the URL exists only in this
# process's environment (owner-only /proc/<pid>/environ) and on a pipe.
# --data-binary takes the message as a literal, so it does not contend for stdin.
# A quote, backslash or newline in the URL would break the config line; refuse it.
case "$ALERT_URL" in
  *[\"\\]* | *$'\n'*) echo "ALERT_URL contains a quote, backslash or newline" >&2; exit 1 ;;
esac
# --proto: https only, and no redirect to anything else. The URL is the
# credential, so a mistyped http:// would put it on the wire in cleartext.
# -f: a 4xx/5xx from the channel is a failure, not a delivered alert.
# ntfy headers are ignored by other endpoints; the body is what carries the news.
printf 'url = "%s"\n' "$ALERT_URL" | curl -fsS -m 15 --retry 2 --retry-delay 3 \
  --proto '=https' --proto-redir '=https' \
  -H "Title: FRYBIRD ${what} failed" -H "Priority: high" -H "Tags: rotating_light" \
  --data-binary "$msg" --config - >/dev/null
echo "alert sent for ${what}"
