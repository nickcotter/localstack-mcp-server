import { AUTH_TOKEN_ENV, DOCKER_IMAGE, DockerOptions, NPM_PACKAGE, ServerSpec } from "./types";

/**
 * Clients that spawn the server without a shell (Claude Code, Codex) can't
 * resolve the npx.cmd shim on native Windows — wrap in `cmd /c` there.
 * File-based clients (Cursor, VS Code, Claude Desktop) resolve npx themselves
 * and must keep the plain command.
 */
export function windowsSpawnSafeSpec(spec: ServerSpec): ServerSpec {
  if (spec.command !== "npx") return spec;
  return { command: "cmd", args: ["/c", spec.command, ...spec.args], env: spec.env };
}

/**
 * The server's env block. The auth token is optional: without one the entry carries
 * no LOCALSTACK_AUTH_TOKEN at all (the server then runs the Community image), rather
 * than an empty value that LocalStack would try to activate.
 */
function buildServerEnv(
  token: string | undefined,
  extraEnv: Record<string, string>
): Record<string, string> {
  const trimmed = token?.trim();
  return { ...(trimmed ? { [AUTH_TOKEN_ENV]: trimmed } : {}), ...extraEnv };
}

export function buildNpxServerSpec(
  token: string | undefined,
  extraEnv: Record<string, string> = {}
): ServerSpec {
  return {
    command: "npx",
    args: ["-y", NPM_PACKAGE],
    env: buildServerEnv(token, extraEnv),
  };
}

export function buildDockerServerSpec(
  token: string | undefined,
  extraEnv: Record<string, string>,
  options: DockerOptions
): ServerSpec {
  const env = buildServerEnv(token, extraEnv);
  const args = [
    "run",
    "-i",
    "--rm",
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "--add-host",
    "host.docker.internal:host-gateway",
    "--add-host",
    "s3.host.docker.internal:host-gateway",
    "--add-host",
    "snowflake.localhost.localstack.cloud:host-gateway",
  ];
  if (AUTH_TOKEN_ENV in env) args.push("-e", AUTH_TOKEN_ENV);
  args.push("-e", "LOCALSTACK_HOSTNAME=host.docker.internal");

  // Extra config vars are forwarded into the server container from the env
  // block; values stay out of the args so client UIs don't display them.
  for (const key of Object.keys(extraEnv)) {
    args.push("-e", key);
  }

  if (options.workspaceDir) {
    args.push("-v", `${options.workspaceDir}:${options.workspaceDir}`);
  }

  args.push(`${DOCKER_IMAGE}:${options.imageTag}`);

  return { command: "docker", args, env };
}
