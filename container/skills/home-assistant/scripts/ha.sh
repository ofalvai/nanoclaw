#!/usr/bin/env bash
# Home Assistant CLI wrapper
# Reads credentials from ~/.config/home-assistant/config.json or HA_URL / HA_TOKEN env vars

set -euo pipefail

CONFIG_FILE="$HOME/.config/home-assistant/config.json"

if [[ -f "$CONFIG_FILE" ]]; then
  HA_URL="${HA_URL:-$(jq -r '.url' "$CONFIG_FILE")}"
  HA_TOKEN="${HA_TOKEN:-$(jq -r '.token' "$CONFIG_FILE")}"
fi

: "${HA_URL:?HA_URL not set. Configure ~/.config/home-assistant/config.json or set HA_URL}"
: "${HA_TOKEN:?HA_TOKEN not set. Configure ~/.config/home-assistant/config.json or set HA_TOKEN}"

AUTH_HEADER="Authorization: Bearer $HA_TOKEN"
CURL_OPTS=(-sf)
[[ "${HA_INSECURE:-}" == "true" ]] && CURL_OPTS+=(--insecure)

api_get()  { curl "${CURL_OPTS[@]}" -H "$AUTH_HEADER" "$HA_URL/api/$1"; }
api_post() { curl "${CURL_OPTS[@]}" -X POST -H "$AUTH_HEADER" -H "Content-Type: application/json" "$HA_URL/api/$1" -d "${2:-{}}"; }

cmd="${1:-help}"
shift || true

case "$cmd" in
  info)
    api_get "config" | jq '{version: .version, location_name: .location_name}'
    ;;
  list)
    filter="${1:-all}"
    if [[ "$filter" == "all" ]]; then
      api_get "states" | jq -r '.[].entity_id' | sort
    else
      api_get "states" | jq -r --arg d "$filter" '.[] | select(.entity_id | startswith($d+".")) | .entity_id' | sort
    fi
    ;;
  search)
    query="${1:?usage: ha.sh search <query>}"
    api_get "states" | jq -r --arg q "$query" '.[] | select(.entity_id | contains($q)) | "\(.entity_id)\t\(.state)"'
    ;;
  state)
    entity="${1:?usage: ha.sh state <entity_id>}"
    api_get "states/$entity" | jq '{state: .state, attributes: .attributes}'
    ;;
  on)
    entity="${1:?usage: ha.sh on <entity_id> [brightness]}"
    domain="${entity%%.*}"
    brightness="${2:-}"
    if [[ -n "$brightness" ]]; then
      api_post "services/$domain/turn_on" "{\"entity_id\":\"$entity\",\"brightness\":$brightness}" | jq -c '.[0].state // empty'
    else
      api_post "services/$domain/turn_on" "{\"entity_id\":\"$entity\"}" | jq -c '.[0].state // empty'
    fi
    ;;
  off)
    entity="${1:?usage: ha.sh off <entity_id>}"
    domain="${entity%%.*}"
    api_post "services/$domain/turn_off" "{\"entity_id\":\"$entity\"}" | jq -c '.[0].state // empty'
    ;;
  toggle)
    entity="${1:?usage: ha.sh toggle <entity_id>}"
    domain="${entity%%.*}"
    api_post "services/$domain/toggle" "{\"entity_id\":\"$entity\"}" | jq -c '.[0].state // empty'
    ;;
  scene)
    scene="${1:?usage: ha.sh scene <scene_name>}"
    api_post "services/scene/turn_on" "{\"entity_id\":\"scene.$scene\"}"
    ;;
  script)
    script="${1:?usage: ha.sh script <script_name>}"
    api_post "services/script/turn_on" "{\"entity_id\":\"script.$script\"}"
    ;;
  climate)
    entity="${1:?usage: ha.sh climate <entity_id> <temperature>}"
    temp="${2:?usage: ha.sh climate <entity_id> <temperature>}"
    api_post "services/climate/set_temperature" "{\"entity_id\":\"$entity\",\"temperature\":$temp}" | jq -c '.[0].state // empty'
    ;;
  call)
    domain="${1:?usage: ha.sh call <domain> <service> [json_data]}"
    service="${2:?usage: ha.sh call <domain> <service> [json_data]}"
    data="${3:-{}}"
    api_post "services/$domain/$service" "$data" | jq .
    ;;
  *)
    echo "Usage: ha.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  info                              Test connection"
    echo "  list [all|lights|switch|...]      List entities by domain"
    echo "  search <query>                    Find entities by name"
    echo "  state <entity_id>                 Get entity state"
    echo "  on <entity_id> [brightness]       Turn on"
    echo "  off <entity_id>                   Turn off"
    echo "  toggle <entity_id>                Toggle"
    echo "  scene <scene_name>                Activate scene"
    echo "  script <script_name>              Run script"
    echo "  climate <entity_id> <temp>        Set temperature"
    echo "  call <domain> <service> [json]    Raw service call"
    ;;
esac
