const port = Number.parseInt(process.env.REMOTE_AGENT_PORT ?? "17821", 10);
const host = process.env.REMOTE_AGENT_HOST === "0.0.0.0" ? "127.0.0.1" : process.env.REMOTE_AGENT_HOST ?? "127.0.0.1";

const response = await fetch(`http://${host}:${port}/v1/pairing/start`, { method: "POST" });
const body = (await response.json()) as {
  data?: { code?: string; expiresAt?: string };
  error?: { message?: string };
};

if (!response.ok || !body.data?.code) {
  process.stderr.write(`${body.error?.message ?? `Pairing request failed (${response.status})`}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Pairing code: ${body.data.code}\nExpires at: ${body.data.expiresAt}\n`);
}
