// Starts the app (or a tunnel to it) on the port from the environment, so
// the port is configuration, not something hardcoded in package.json.
//
//   node scripts/run.mjs dev | start | tunnel | tunnel:cloudflare
//   (normally via `npm run dev`, `npm start`, `npm run tunnel`, ...)
//
// Why a launcher: Next.js only reads a PORT variable already present in the
// process environment - its .env loading happens inside the app, after the
// CLI has picked the port - so PORT=... in .env alone would be ignored.
// This loads .env files first, the same precedence Next uses:
//   real environment  >  .env.local  >  .env
//
// PORT  - port to listen on / tunnel to. Default 9005.
// HOST  - optional address to bind (dev/start only), e.g. 0.0.0.0 for all
//         interfaces or 127.0.0.1 for this machine only. Default: Next's own.
import { spawn } from "node:child_process";
import dotenv from "dotenv";

// dotenv never overrides a variable that's already set, so loading
// .env.local before .env gives: real env > .env.local > .env.
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

const DEFAULT_PORT = "9005";
const port = (process.env.PORT ?? "").trim() || DEFAULT_PORT;
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error(`Invalid PORT "${port}" - use a number from 1 to 65535.`);
  process.exit(1);
}
const host = (process.env.HOST ?? "").trim();
// Only hostname / IPv4 / IPv6 characters - the command below runs through a
// shell, so nothing else from the environment may reach it.
if (host && !/^[A-Za-z0-9.:\-[\]]+$/.test(host)) {
  console.error(`Invalid HOST "${host}" - use a hostname or IP address, e.g. 0.0.0.0 or 127.0.0.1.`);
  process.exit(1);
}
const hostArgs = host ? ["-H", host] : [];

const commands = {
  dev: ["next", "dev", "-p", port, ...hostArgs],
  start: ["next", "start", "-p", port, ...hostArgs],
  tunnel: ["lt", "--port", port],
  "tunnel:cloudflare": ["cloudflared", "tunnel", "--url", `http://localhost:${port}`],
};

const mode = process.argv[2];
const command = commands[mode];
if (!command) {
  console.error(`Usage: node scripts/run.mjs <${Object.keys(commands).join(" | ")}>`);
  process.exit(1);
}

const commandLine = command.join(" ");
console.log(`> ${commandLine}   (PORT=${port}${host ? `, HOST=${host}` : ""})`);
// Local binaries (next, lt) resolve from node_modules/.bin via npm's PATH;
// a shell lets Windows find their .cmd shims. Safe as one string: every
// part is a fixed word or a validated PORT/HOST value (checked above).
const child = spawn(commandLine, { stdio: "inherit", shell: true, env: { ...process.env, PORT: port } });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
