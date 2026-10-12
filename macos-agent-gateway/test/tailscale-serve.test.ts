import assert from "node:assert/strict";
import test from "node:test";
import {
  buildServeHttpsUrl,
  extractDnsName,
  extractServeProxyTarget,
  isOperatorDeniedError,
  operatorDeniedHint,
  pairingPayload,
  parseArgs,
  runTailscaleServe,
  HelpRequested,
  type CommandResult,
  type Runner,
} from "../src/tailscale-serve.js";

test("parseArgs defaults and flags", () => {
  assert.deepEqual(parseArgs([]), {
    gatewayPort: 17_821,
    httpsPort: 443,
    pair: true,
    reset: false,
  });
  assert.deepEqual(parseArgs(["--port", "18000", "--https-port", "8443", "--no-pair"]), {
    gatewayPort: 18_000,
    httpsPort: 8443,
    pair: false,
    reset: false,
  });
  assert.equal(parseArgs(["--reset"]).reset, true);
  assert.throws(() => parseArgs(["--help"]), HelpRequested);
  assert.throws(() => parseArgs(["--port", "nope"]), /正整数/);
});

test("buildServeHttpsUrl strips trailing dot and omits default 443", () => {
  assert.equal(buildServeHttpsUrl("mac.tailnet.ts.net.", 443), "https://mac.tailnet.ts.net");
  assert.equal(buildServeHttpsUrl("mac.tailnet.ts.net", 8443), "https://mac.tailnet.ts.net:8443");
});

test("extractDnsName reads status JSON Self.DNSName", () => {
  assert.equal(
    extractDnsName({ Self: { DNSName: "keithyu.tail123.ts.net." } }),
    "keithyu.tail123.ts.net.",
  );
  assert.equal(extractDnsName({}), undefined);
});

test("extractServeProxyTarget reads common serve status shapes", () => {
  assert.equal(
    extractServeProxyTarget(
      {
        Web: {
          "https://443": {
            Handlers: {
              "/": { Proxy: "http://127.0.0.1:17821" },
            },
          },
        },
      },
      443,
    ),
    "http://127.0.0.1:17821",
  );
  assert.equal(
    extractServeProxyTarget(
      {
        "https://443": {
          "/": "http://127.0.0.1:17821",
        },
      },
      443,
    ),
    "http://127.0.0.1:17821",
  );
});

test("pairingPayload keeps existing auth UX (URL + code text, no new scheme)", () => {
  assert.equal(
    pairingPayload("https://mac.tailnet.ts.net", "01234567"),
    "Remote Agent\nhttps://mac.tailnet.ts.net\ncode=01234567",
  );
  assert.doesNotMatch(pairingPayload("https://example", "1"), /^[a-z]+:\/\//i);
});

test("isOperatorDeniedError detects Access denied / serve config denied", () => {
  assert.equal(isOperatorDeniedError("Access denied: serve config"), true);
  assert.equal(isOperatorDeniedError("failed to set serve config: Access denied"), true);
  assert.equal(isOperatorDeniedError("serve config denied by policy"), true);
  assert.equal(isOperatorDeniedError("HTTPS certificates not enabled"), false);
  assert.match(operatorDeniedHint(), /sudo tailscale set --operator=\$USER/);
  assert.match(operatorDeniedHint(), /npm run serve:tailscale/);
});

test("runTailscaleServe prints operator hint on Access denied", async () => {
  const errs: string[] = [];
  const runner: Runner = (command, args) => {
    if (args.includes("status") && args.includes("--json")) {
      return {
        status: 0,
        stdout: JSON.stringify({
          BackendState: "Running",
          Self: { DNSName: "mac.tailnet.ts.net." },
        }),
        stderr: "",
      };
    }
    if (args[0] === "serve" && args.includes("--bg")) {
      return {
        status: 1,
        stdout: "",
        stderr: "Access denied: failed to set serve config\n",
      };
    }
    return { status: 0, stdout: "", stderr: "" } satisfies CommandResult;
  };
  const fetchImpl = (async () =>
    ({
      ok: true,
      json: async () => ({}),
    }) as Response) as typeof fetch;

  const code = await runTailscaleServe(
    { gatewayPort: 17821, httpsPort: 443, pair: false, reset: false },
    {
      env: { TAILSCALE_BIN: process.execPath },
      platform: "darwin",
      runner,
      fetchImpl,
      write: () => {},
      writeErr: (text) => errs.push(text),
    },
  );
  assert.equal(code, 1);
  const joined = errs.join("");
  assert.match(joined, /Access denied/i);
  assert.match(joined, /sudo tailscale set --operator=\$USER/);
});
