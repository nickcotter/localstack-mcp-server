# Notes for Claude Code

## Environment

- **Docker is available in cloud sessions, but the daemon is not running when the
  session starts.** Do not conclude that Docker is unavailable when `docker info`
  fails. Start it with `dockerd &` (or `sudo dockerd &`) and wait until
  `docker info` succeeds. This project drives LocalStack through the Docker API,
  so the daemon is needed for anything beyond unit tests.

## Project

- TypeScript MCP server built with `xmcp`; package manager is `yarn`.
- Build with `yarn build`, unit tests with `yarn test` (jest), formatting with
  `yarn format` (prettier). The MCP end-to-end tests (`yarn test:mcp:*`) need a
  running Docker daemon and pull the LocalStack image.
