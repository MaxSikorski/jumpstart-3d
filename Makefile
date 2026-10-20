.PHONY: up down logs mcp-config codex-install benchmark

up:
	mkdir -p exports
	docker compose up -d --build --wait
	@printf 'JumpStart is ready at http://localhost:3210/?mcp=1\n'
	@printf 'Connect an MCP client with: make mcp-config\n'
	@printf 'Register with Codex: make codex-install\n'

down:
	docker compose down

logs:
	docker compose logs -f jumpstart

mcp-config:
	@printf '[mcp_servers.jumpstart]\ncommand = "docker"\nargs = ["exec", "-i", "jumpstart-3d", "node", "scripts/jumpstart-mcp-stdio-proxy.mjs"]\n'

codex-install:
	@command -v codex >/dev/null 2>&1 || { echo 'Codex CLI not found on PATH.' >&2; exit 1; }
	@command -v docker >/dev/null 2>&1 || { echo 'Docker CLI not found on PATH.' >&2; exit 1; }
	codex mcp add jumpstart -- "$$(command -v docker)" exec -i jumpstart-3d node scripts/jumpstart-mcp-stdio-proxy.mjs
	@printf 'JumpStart MCP registered with Codex.\nRun make up, then open http://localhost:3210/?mcp=1\nReconnect the MCP server in Codex, or restart Codex, to load it.\n'

benchmark:
	npm run benchmark:tutorials
