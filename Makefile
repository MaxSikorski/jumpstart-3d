.PHONY: up down logs mcp-config benchmark

up:
	mkdir -p exports
	docker compose up -d --build --wait
	@printf 'JumpStart is ready at http://localhost:3210/?mcp=1\n'
	@printf 'Connect an MCP client with: make mcp-config\n'

down:
	docker compose down

logs:
	docker compose logs -f jumpstart

mcp-config:
	@printf '[mcp_servers.jumpstart]\ncommand = "docker"\nargs = ["exec", "-i", "jumpstart-3d", "node", "scripts/jumpstart-mcp-stdio-proxy.mjs"]\n'

benchmark:
	npm run benchmark:tutorials
