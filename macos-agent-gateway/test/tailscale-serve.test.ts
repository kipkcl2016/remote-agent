import assert from "node:assert/strict";
import test from "node:test";
import {
  buildServeHttpsUrl,
  extractDnsName,
  extractServeProxyTarget,
  pairingPayload,
  parseArgs,
  HelpRequested,
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
