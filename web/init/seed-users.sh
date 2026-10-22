#!/usr/bin/env bash
# Seed the demo cast into realm "cosign" (docs/API.md §1.1) after `npm run init`.
# Re-runnable: existing roles/users/mappings are skipped. Prints a Tide enrollment link
# for every user not enrolled yet; each person opens their own link.
#
# tide-realm-admin is deliberately NOT granted: with iga.attestor=tide the approval threshold
# follows the number of holders, and RealTideGovernance approves CRs with one admin token.
# The 2/3 quorum is computed by Cosign (docs/API.md §7).
set -euo pipefail

TC="${TIDECLOAK_LOCAL_URL:-http://localhost:8080}"
REALM="${REALM_NAME:-cosign}"
KC_USER="${KC_USER:-admin}"
KC_PASSWORD="${KC_PASSWORD:-password}"
LINK_TTL="${LINK_TTL:-43200}" # 12h

ROLES=(agent oncall security-lead platform-admin compliance
       _tide_customer_pii.selfencrypt _tide_customer_pii.selfdecrypt)
# username|first|last|roles (comma separated); mirrors SEED_USERS in api/app/auth.py
USERS=(
  "ai-oncall-agent|Atlas|Agent|agent,_tide_customer_pii.selfencrypt"
  "linh.tran|Linh|Tran|oncall"
  "marcus.lee|Marcus|Lee|security-lead,_tide_customer_pii.selfencrypt,_tide_customer_pii.selfdecrypt"
  "dave.kim|Dave|Kim|platform-admin"
  "priya.nair|Priya|Nair|compliance"
)

token() {
  curl -sf -X POST "$TC/realms/master/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=admin-cli -d "username=$KC_USER" -d "password=$KC_PASSWORD" | jq -r .access_token
}
T="$(token)"
call() { # call METHOD PATH [args]; sets CODE, BODY
  local m="$1" p="$2" tmp; shift 2; tmp="$(mktemp)"
  CODE=$(curl -s -o "$tmp" -w '%{http_code}' -X "$m" "$TC/admin/realms/$REALM/$p" -H "Authorization: Bearer $T" "$@")
  BODY="$(cat "$tmp")"; rm -f "$tmp"
}

# Approve every PENDING IGA change request. Before the firstAdmin -> multiAdmin flip an admin token
# commits them; after it TideCloak answers "needs-approval" (an enclave signature from a
# tide-realm-admin), so we stop and point at the admin console. Re-run once they are approved.
drain() {
  for _ in $(seq 1 12); do
    T="$(token)"; call GET "iga/change-requests?status=PENDING"
    [[ "$CODE" == 200 ]] || { echo "ERROR: list change requests -> $CODE $BODY" >&2; exit 1; }
    local ids; ids="$(jq -r '.[].id // empty' <<<"$BODY")"
    [[ -z "$ids" ]] && return 0
    while read -r id; do
      call POST "iga/change-requests/$id/approve" -H 'Content-Type: application/json' -d '{}'
      if [[ "$(jq -r '.mode? // empty' <<<"$BODY" 2>/dev/null)" == needs-approval ]]; then
        echo
        echo "ACTION REQUIRED: $(wc -l <<<"$ids") change request(s) need a Tide-signed approval."
        echo "  Open $TC/admin/$REALM/console/ , sign in with the enrolled admin,"
        echo "  approve them under Change Requests, then re-run this script."
        exit 2
      fi
      [[ "$CODE" == 2* || "$CODE" == 409 ]] || echo "  WARN approve $id -> $CODE $BODY"
    done <<<"$ids"
  done
  echo "  WARN change requests still pending after 12 rounds" >&2
}

# Pending CRs first: a role or user parked in a CR does not exist yet, so creating it again would queue a duplicate.
drain

echo "Roles..."
for r in "${ROLES[@]}"; do
  call POST roles -H 'Content-Type: application/json' -d "$(jq -nc --arg n "$r" '{name:$n}')"
  case "$CODE" in 201|202|409) echo "  $r -> $CODE" ;; *) echo "ERROR: role $r -> $CODE $BODY" >&2; exit 1 ;; esac
done
drain

echo "Users..."
for row in "${USERS[@]}"; do
  IFS='|' read -r u first last _ <<<"$row"
  call POST users -H 'Content-Type: application/json' -d "$(jq -nc --arg u "$u" --arg f "$first" --arg l "$last" \
    '{username:$u,email:($u+"@northwind.example"),firstName:$f,lastName:$l,enabled:true,emailVerified:false,attributes:{tideInvitable:["true"]}}')"
  case "$CODE" in 201|202|409) echo "  $u -> $CODE" ;; *) echo "ERROR: user $u -> $CODE $BODY" >&2; exit 1 ;; esac
done
drain

uid() { call GET "users?username=$1&exact=true&briefRepresentation=false"; jq -r '.[0].id // empty' <<<"$BODY"; }

echo "Role mappings..."
for row in "${USERS[@]}"; do
  IFS='|' read -r u _ _ roles <<<"$row"
  id="$(uid "$u")"; [[ -n "$id" ]] || { echo "ERROR: user $u not found (CREATE_USER not committed?)" >&2; exit 1; }
  call GET "users/$id/role-mappings/realm"; have="$BODY"
  # One role per call, and TideCloak allows one PENDING CR per user (409 PENDING_CHANGE_REQUEST_CONFLICT),
  # so a user with several roles needs one approve-and-re-run round per role.
  for r in ${roles//,/ }; do
    jq -e --arg r "$r" 'any(.[]; .name==$r)' <<<"$have" >/dev/null && { echo "  $u has $r"; continue; }
    call GET "roles/$r"; [[ "$CODE" == 200 ]] || { echo "ERROR: role $r missing -> $CODE" >&2; exit 1; }
    call POST "users/$id/role-mappings/realm" -H 'Content-Type: application/json' \
      -d "$(jq -c '[{id:.id,name:.name}]' <<<"$BODY")"
    echo "  $u += $r -> $CODE"
    [[ "$CODE" == 2* ]] && break
  done
done
drain

echo "Verify + enrollment links..."
fail=0
for row in "${USERS[@]}"; do
  IFS='|' read -r u _ _ roles <<<"$row"
  T="$(token)"; id="$(uid "$u")"; user="$BODY"
  call GET "users/$id/role-mappings/realm"
  for r in ${roles//,/ }; do
    jq -e --arg r "$r" 'any(.[]; .name==$r)' <<<"$BODY" >/dev/null || { echo "  MISSING $u: $r" >&2; fail=1; }
  done
  if jq -e '.[0].attributes.vuid[0]' <<<"$user" >/dev/null; then
    echo "  $u: enrolled"
  else
    call POST "tideAdminResources/get-required-action-link?userId=$id&lifespan=$LINK_TTL" \
      -H 'Content-Type: application/json' -H 'Accept: text/plain' -d '["link-tide-account-action"]'
    [[ "$CODE" == 2* ]] || { echo "ERROR: enrollment link for $u -> $CODE $BODY" >&2; exit 1; }
    printf '  %s: enroll at\n    %s\n' "$u" "$BODY"
  fi
done
exit "$fail"
