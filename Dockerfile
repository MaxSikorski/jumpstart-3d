FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV JUMPSTART_MCP_HOST=0.0.0.0
ENV JUMPSTART_MCP_PORT=3210
ENV JUMPSTART_MCP_HTTP_ONLY=1

EXPOSE 3210

CMD ["npm", "run", "mcp:jumpstart"]
