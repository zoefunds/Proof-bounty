/**
 * Independent, off-chain evidence archival.
 *
 * Closes the gap between the contract's on-chain `evidence_content_hash`
 * (a fast, consensus-safe FNV-1a fingerprint -- deliberately NOT
 * cryptographically strong, see that field's docstring in
 * contracts/proof_bounty.py) and genuine evidence provenance: this fetches
 * the same evidence URL independently, server-side, computes a REAL
 * SHA-256 digest via Node's `crypto` module, and stores the actual
 * content alongside it. Node's crypto module has no sandbox-availability
 * uncertainty the way the contract's constrained Python runtime did (see
 * memory/MEMORY.md for why the contract itself uses a pure-Python
 * fallback instead of `hashlib`) -- this is the correct architectural
 * layer for a real cryptographic archive, since neither the contract nor
 * this backend has access to a decentralized store (IPFS/Arweave) without
 * additional infrastructure this project doesn't have configured yet;
 * Postgres is a real, working, independently-queryable archive today.
 *
 * SSRF protections, since this fetches a URL a user (any bounty
 * challenger) supplied: blocks private/loopback/link-local IP ranges and
 * cloud metadata endpoints, blocks non-http(s) schemes, bounds response
 * size and fetch timeout, and never fetches after following excessive
 * redirects.
 *
 * DNS-rebinding fix (audit-driven): the original version resolved the
 * hostname once to validate its IPs, then called the global `fetch()`
 * with the ORIGINAL hostname -- which re-resolves DNS itself at connect
 * time. An attacker controlling the DNS record could pass the safety
 * check with a public IP and then rebind the same name to a private
 * address before `fetch()`'s own resolution landed a moment later. The
 * fix removes that whole window: `assertSafeUrl` returns the validated IP
 * itself, and the actual connection is opened directly against that IP
 * (via `node:http`/`node:https`, with `Host`/SNI still set to the
 * original hostname so virtual-hosting and TLS certificate validation
 * both still work correctly) -- there is no second DNS lookup for an
 * attacker to race.
 */

import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { prisma } from "../lib/prisma.js";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2_000_000; // 2MB cap on what we archive
const ARCHIVE_MAX_CHARS = 500_000; // bounded storage per row
const MAX_REDIRECTS = 5;

/**
 * Exact TypeScript port of the contract's `_content_digest` (64-bit
 * FNV-1a over Unicode code points -- see contracts/proof_bounty.py for
 * why it's a hand-rolled algorithm rather than a real hash function).
 * Iterating with `for...of` (not indexing) matches Python's `for ch in
 * content: ord(ch)`, since both walk Unicode code points rather than
 * UTF-16 code units, so surrogate pairs are handled identically.
 */
export function contentDigestFnv1a(content: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (const ch of content) {
    const codePoint = BigInt(ch.codePointAt(0) ?? 0);
    h = (h ^ codePoint) & mask;
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

function isPrivateOrReservedIp(ip: string): boolean {
  // IPv4 private/reserved ranges + loopback + link-local + cloud metadata.
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 cloud metadata
    if (a === 0) return true; // 0.0.0.0/8
    return false;
  }
  // IPv6 loopback / unique-local / link-local.
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
  if (lower.startsWith("fe80:")) return true; // link-local
  return false;
}

interface SafeTarget {
  url: URL;
  /** The single validated IP the connection will actually be opened
   * against -- pinned here specifically so nothing re-resolves DNS
   * between the safety check and the connection (see module docstring,
   * "DNS-rebinding fix"). */
  ip: string;
  family: 4 | 6;
}

async function assertSafeUrl(rawUrl: string): Promise<SafeTarget> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }
  const hostname = url.hostname;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Refusing to fetch localhost");
  }
  const addresses = await dns.lookup(hostname, { all: true });
  if (addresses.length === 0) {
    throw new Error(`Could not resolve host: ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new Error(`Refusing to fetch private/reserved address: ${address}`);
    }
  }
  const chosen = addresses[0];
  return { url, ip: chosen.address, family: chosen.family as 4 | 6 };
}

/** One HTTP(S) request, connected directly to `target.ip` -- never to
 * `target.url.hostname` -- with `Host` and TLS SNI still set to the
 * original hostname so the request is indistinguishable from a normal
 * one at the application layer. */
function requestPinned(
  target: SafeTarget,
  timeoutMs: number
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const isHttps = target.url.protocol === "https:";
    const transport = isHttps ? https : http;
    const req = transport.request({
      host: target.ip,
      port: target.url.port ? Number(target.url.port) : isHttps ? 443 : 80,
      path: target.url.pathname + target.url.search,
      method: "GET",
      headers: {
        Host: target.url.hostname,
        "User-Agent": "ProofBounty-EvidenceArchiver/1.0",
      },
      timeout: timeoutMs,
      // TLS still validates the certificate against the real hostname
      // via SNI/servername, even though the socket connects to the pinned IP.
      ...(isHttps ? { servername: target.url.hostname } : {}),
    });

    const chunks: Buffer[] = [];
    let received = 0;
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.on("response", (res) => {
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          req.destroy(new Error(`Response too large: exceeded ${MAX_RESPONSE_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
      });
      res.on("error", reject);
    });
    req.end();
  });
}

/**
 * Fetch and archive one piece of evidence. Never throws -- a failed
 * archive attempt is itself recorded (fetchError set) rather than
 * blocking the caller, since archival is a best-effort provenance layer,
 * never a payment-critical path.
 */
export async function archiveEvidence(
  bountyId: number,
  attemptIndex: number,
  rawUrl: string
): Promise<void> {
  let content = "";
  let contentType = "";
  let byteLength = 0;
  let truncated = false;
  let fetchError: string | null = null;

  try {
    let target = await assertSafeUrl(rawUrl);
    let redirects = 0;

    while (true) {
      const res = await requestPinned(target, FETCH_TIMEOUT_MS);

      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        redirects += 1;
        if (redirects > MAX_REDIRECTS) throw new Error("Too many redirects");
        // Re-validate (and re-pin) the redirect target from scratch --
        // a redirect chain is exactly the kind of attacker-controlled
        // input SSRF checks exist for, so it gets the same treatment as
        // the original URL, not a shortcut.
        const next = new URL(res.headers.location, target.url);
        target = await assertSafeUrl(next.toString());
        continue;
      }

      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);

      contentType = res.headers["content-type"] ?? "";
      byteLength = res.body.byteLength;
      const text = res.body.toString("utf-8");
      content = text.length > ARCHIVE_MAX_CHARS ? text.slice(0, ARCHIVE_MAX_CHARS) : text;
      truncated = text.length > ARCHIVE_MAX_CHARS;
      break;
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
  }

  const contentSha256 = createHash("sha256").update(content, "utf-8").digest("hex");
  // Mirror the contract's own truncation (`WEB_FETCH_CHAR_LIMIT`) before
  // fingerprinting, so this digest is computed over the same-length
  // window the contract judged -- otherwise a match would be impossible
  // by construction even when the underlying page is unchanged. Still
  // not a guaranteed match: `gl.nondet.web.render(mode="text")` strips
  // HTML/markup on the contract side, while this archive stores the raw
  // HTTP body -- for markup-heavy pages a mismatch here is EXPECTED and
  // is not itself evidence of tampering. See the on-chain-hash-match
  // fields' docstrings in schema.prisma.
  const WEB_FETCH_CHAR_LIMIT = 12_000;
  const localContentDigest = contentDigestFnv1a(content.slice(0, WEB_FETCH_CHAR_LIMIT));

  let onChainHashMatch: boolean | null = null;
  let onChainHashCheckedAt: Date | null = null;
  try {
    const attempt = await prisma.attempt.findUnique({
      where: { bountyId_attemptIndex: { bountyId, attemptIndex } },
      select: { evidenceContentHash: true },
    });
    if (attempt?.evidenceContentHash) {
      onChainHashMatch = attempt.evidenceContentHash === localContentDigest;
      onChainHashCheckedAt = new Date();
    }
  } catch (err) {
    console.error("[evidence-archiver] failed to read cached on-chain hash for comparison:", err);
  }

  await prisma.evidenceArchive
    .upsert({
      where: {
        bountyId_attemptIndex_contentSha256: { bountyId, attemptIndex, contentSha256 },
      },
      create: {
        bountyId,
        attemptIndex,
        url: rawUrl,
        contentSha256,
        contentType,
        byteLength,
        content,
        truncated,
        fetchError,
        localContentDigest,
        onChainHashMatch,
        onChainHashCheckedAt,
      },
      update:
        onChainHashMatch !== null
          ? { onChainHashMatch, onChainHashCheckedAt }
          : {}, // identical content already archived — nothing new to record
    })
    .catch((err) => {
      console.error("[evidence-archiver] failed to persist archive row:", err);
    });
}
