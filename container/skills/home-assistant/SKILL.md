---
name: home-assistant
description: Control Home Assistant smart home devices via REST API.
allowed-tools: Bash(curl:*), Bash(ha.sh:*)
---
# Home Assistant

Control Home Assistant smart home devices via REST API. No external dependencies beyond `curl` and `jq`.

## Configuration

Credentials are read from (in order):
1. `~/.config/home-assistant/config.json`
2. Environment variables `HA_URL` and `HA_TOKEN`

Config file format:
```json
{
  "url": "http://homeassistant.local:8123",
  "token": "your-long-lived-access-token"
}
```

For self-signed certificates, set `HA_INSECURE=true` — this passes `--insecure` to curl.

Getting a token: Home Assistant → Profile → Long-Lived Access Tokens → Create.

## Core API Commands

```bash
# List all entity IDs
curl -s -H "Authorization: Bearer $HA_TOKEN" "$HA_URL/api/states" | jq '.[].entity_id'

# Get entity state
curl -s -H "Authorization: Bearer $HA_TOKEN" "$HA_URL/api/states/light.living_room"

# Turn light on
curl -X POST -H "Authorization: Bearer $HA_TOKEN" \
  "$HA_URL/api/services/light/turn_on" \
  -d '{"entity_id": "light.living_room"}'

# Turn light on with brightness (0-255)
curl -X POST -H "Authorization: Bearer $HA_TOKEN" \
  "$HA_URL/api/services/light/turn_on" \
  -d '{"entity_id": "light.living_room", "brightness": 128}'

# Run a script
curl -X POST -H "Authorization: Bearer $HA_TOKEN" \
  "$HA_URL/api/services/script/turn_on" \
  -d '{"entity_id": "script.goodnight"}'
```

## Supported Domains

| Domain | Services | Example |
|--------|----------|---------|
| light | turn_on, turn_off, toggle | light.kitchen |
| switch | turn_on, turn_off, toggle | switch.fan |
| climate | set_temperature, set_hvac_mode | climate.thermostat |
| cover | open_cover, close_cover | cover.garage |
| media_player | play_media, media_pause | media_player.tv |
| scene | turn_on | scene.relax |
| script | turn_on | script.welcome_home |
| automation | trigger, turn_on, turn_off | automation.sunrise |

## CLI Wrapper

A helper script is available at `~/.claude/skills/home-assistant/scripts/ha.sh`:

```bash
ha.sh info                              # Test connection
ha.sh list all                          # All entities
ha.sh list lights                       # Just lights
ha.sh search kitchen                    # Find entities by name
ha.sh state light.living_room           # Get state
ha.sh on light.living_room              # Turn on
ha.sh on light.living_room 200          # Turn on with brightness
ha.sh off light.living_room             # Turn off
ha.sh toggle switch.fan                 # Toggle
ha.sh scene movie_night                 # Activate scene
ha.sh script goodnight                  # Run script
ha.sh climate climate.thermostat 22     # Set temperature
ha.sh call light turn_on '{"entity_id":"light.room","brightness":200}'
```

## Troubleshooting

- **401 Unauthorized** — Token expired; generate a new long-lived token
- **Connection refused** — Check `HA_URL` and network reachability
- **Entity not found** — Run `ha.sh list all` to confirm the entity_id
