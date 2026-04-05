usage:
    cd data/sessions/main/.claude && CLAUDE_CONFIG_DIR=$(pwd) pnpm dlx ccusage --recent --session-length 1

# Stop running containers immediately, forcing a fresh spawn on next message
restart-containers:
	container stop $(container ls --format json | jq -r '.[] | select(.configuration.id | startswith("nanoclaw-")) | .configuration.id')

# Spawn a shell inside the most recently started nanoclaw container
shell:
	#!/usr/bin/env bash
	id=$(container ls --format json | jq -r '[.[] | select(.configuration.id | startswith("nanoclaw-"))] | sort_by(.startedDate) | last | .configuration.id // empty')
	if [ -z "$id" ]; then
	    echo "No nanoclaw container is running"
	    exit 1
	fi
	echo "Attaching to $id"
	container exec -it "$id" /bin/bash
