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

# -f: a 4xx/5xx from the channel is a failure, not a delivered alert.
# ntfy headers are ignored by other endpoints; the body is what carries the news.
curl -fsS -m 15 --retry 2 --retry-delay 3 \
  -H "Title: FRYBIRD ${what} failed" -H "Priority: high" -H "Tags: rotating_light" \
  --data-binary "$msg" -- "$ALERT_URL" >/dev/null
echo "alert sent for ${what}"
