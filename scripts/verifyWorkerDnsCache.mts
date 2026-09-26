import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createCachedDnsLookup,
  createMirrorDnsCachedFetch,
  MIRROR_DNS_CACHE_TTL_MS,
  MIRROR_DNS_HOSTNAME,
} from "../src/lib/worker/dnsCache.mjs";

type Lookup = (hostname: string, options: any, callback: (error: any, ...values: any[]) => void) => void;

function lookupAsync(lookup: Lookup, hostname: string, options: any): Promise<any[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, options, (error, ...values) => (error ? reject(error) : resolve(values)));
  });
}

assert.equal(MIRROR_DNS_CACHE_TTL_MS, 86_400_000, "mirror DNS TTL must be exactly one day");
assert.equal(MIRROR_DNS_HOSTNAME, "auto-hh3d.vercel.app");

{
  let now = 10_000;
  let lookupCount = 0;
  let releaseColdLookup: (() => void) | undefined;
  const coldGate = new Promise<void>((resolve) => { releaseColdLookup = resolve; });
  const lookupImpl = (hostname: string, options: any, callback: (error: any, rows?: any[]) => void) => {
    assert.equal(hostname, MIRROR_DNS_HOSTNAME);
    assert.equal(options.all, true);
    lookupCount += 1;
    coldGate.then(() => callback(null, [
      { address: "2001:db8::10", family: 6 },
      { address: "203.0.113.10", family: 4 },
      { address: "203.0.113.10", family: 4 },
    ]));
  };
  const lookup = createCachedDnsLookup({
    ttlMs: MIRROR_DNS_CACHE_TTL_MS,
    nowImpl: () => now,
    lookupImpl: lookupImpl as any,
  } as any) as Lookup;

  const first = lookupAsync(lookup, MIRROR_DNS_HOSTNAME, { all: true });
  const second = lookupAsync(lookup, MIRROR_DNS_HOSTNAME, { family: 4 });
  releaseColdLookup?.();
  const [allValues, ipv4Values] = await Promise.all([first, second]);
  assert.equal(lookupCount, 1, "concurrent cold lookups must be coalesced");
  assert.deepEqual(allValues[0], [
    { address: "2001:db8::10", family: 6 },
    { address: "203.0.113.10", family: 4 },
  ]);
  assert.deepEqual(ipv4Values, ["203.0.113.10", 4]);

  now += MIRROR_DNS_CACHE_TTL_MS - 1;
  await lookupAsync(lookup, MIRROR_DNS_HOSTNAME, {});
  assert.equal(lookupCount, 1, "an unexpired answer must not trigger another DNS query");

  now += 1;
  await lookupAsync(lookup, MIRROR_DNS_HOSTNAME, {});
  assert.equal(lookupCount, 2, "the answer must refresh exactly at one day");
}

{
  let delegated = 0;
  const delegatedLookup = createCachedDnsLookup({
    lookupImpl: ((hostname: string, options: any, callback: (...args: any[]) => void) => {
      delegated += 1;
      callback(null, "192.0.2.55", 4);
    }) as any,
  } as any) as Lookup;
  assert.deepEqual(await lookupAsync(delegatedLookup, "example.com", { family: 4 }), ["192.0.2.55", 4]);
  assert.equal(delegated, 1, "non-mirror DNS names must use the original resolver");
}

{
  let attempts = 0;
  const lookup = createCachedDnsLookup({
    lookupImpl: ((_hostname: string, _options: any, callback: (error: any, rows?: any[]) => void) => {
      attempts += 1;
      if (attempts === 1) callback(new Error("temporary resolver failure"));
      else callback(null, [{ address: "203.0.113.30", family: 4 }]);
    }) as any,
  } as any) as Lookup;
  await assert.rejects(lookupAsync(lookup, MIRROR_DNS_HOSTNAME, {}), /temporary resolver failure/);
  assert.deepEqual(await lookupAsync(lookup, MIRROR_DNS_HOSTNAME, {}), ["203.0.113.30", 4]);
  assert.equal(attempts, 2, "DNS failures must not be cached");
}

{
  let now = 1_000;
  let lookupCount = 0;
  let delegatedFetch = 0;
  const requests: Array<{ hostname: string; method: string; body: string; authorization?: string }> = [];

  const lookupImpl = (_hostname: string, _options: any, callback: (error: any, rows?: any[]) => void) => {
    lookupCount += 1;
    callback(null, [{ address: "203.0.113.20", family: 4 }]);
  };
  const requestImpl = (url: URL, options: any, callback: (response: any) => void) => {
    const request = new EventEmitter() as any;
    request.end = (body?: Buffer | string) => {
      options.lookup(url.hostname, { all: true }, (error: Error | null, addresses: unknown) => {
        if (error) {
          request.emit("error", error);
          return;
        }
        assert.deepEqual(addresses, [{ address: "203.0.113.20", family: 4 }]);
        requests.push({
          hostname: url.hostname,
          method: options.method,
          body: Buffer.from(body ?? "").toString("utf8"),
          authorization: options.headers.authorization,
        });
        const response = new EventEmitter() as any;
        response.statusCode = 200;
        response.statusMessage = "OK";
        response.headers = { "content-type": "application/json", "x-cache-test": "yes" };
        callback(response);
        queueMicrotask(() => {
          response.emit("data", Buffer.from('{"ok":true}'));
          response.emit("end");
        });
      });
    };
    return request;
  };

  const cachedFetch = createMirrorDnsCachedFetch({
    ttlMs: MIRROR_DNS_CACHE_TTL_MS,
    nowImpl: () => now,
    lookupImpl: lookupImpl as any,
    requestImpl,
    fetchImpl: async () => {
      delegatedFetch += 1;
      return new Response("delegated", { status: 200 });
    },
  } as any);

  for (let index = 0; index < 2; index += 1) {
    const response = await cachedFetch(`https://${MIRROR_DNS_HOSTNAME}/api/worker`, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({ op: "heartbeat", index }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-cache-test"), "yes");
    assert.deepEqual(await response.json(), { ok: true });
  }
  assert.equal(lookupCount, 1, "two mirror HTTPS requests inside the TTL must share one DNS answer");
  assert.equal(requests.length, 2, "DNS caching must not cache HTTP responses");
  assert.ok(requests.every((request) => request.hostname === MIRROR_DNS_HOSTNAME));
  assert.ok(requests.every((request) => request.method === "POST"));
  assert.ok(requests.every((request) => request.authorization === "Bearer token"));
  assert.match(requests[0].body, /heartbeat/);

  const delegatedResponse = await cachedFetch("https://158.180.59.36.sslip.io/api/maintenance");
  assert.equal(await delegatedResponse.text(), "delegated");
  assert.equal(delegatedFetch, 1, "non-mirror hosts must use the original fetch");

  now += MIRROR_DNS_CACHE_TTL_MS;
  await cachedFetch(`https://${MIRROR_DNS_HOSTNAME}/api/maintenance`);
  assert.equal(lookupCount, 2, "the mirror HTTPS path must refresh DNS after one day");
}

console.log("OK: mirror DNS uses a one-day positive cache, cold lookup coalescing, and failure retry");