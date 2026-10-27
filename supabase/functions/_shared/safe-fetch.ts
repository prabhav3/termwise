// SSRF-hardened fetch for URLs a student typed in (Canvas base URL, LMS iCal feeds).
//
// Every request URL, and every redirect target, must be https, name a public host (no bare
// hostnames, localhost, *.local / *.internal, or private / loopback / link-local / metadata /
// multicast / reserved IP literals), and — when DNS resolution is available — resolve only to
// public addresses. Redirects are followed manually (at most 3) and re-validated; credentials
// are dropped when a redirect leaves the original origin. The whole exchange has a deadline and
// the body is read up to a byte cap.
//
// Runtime-agnostic: name resolution uses `Deno.resolveDns` when the runtime has it (looked up
// dynamically, so Node-based unit tests run without it) or an injected resolver.

export type SafeFetchErrorCode = 'unsafe_url' | 'too_many_redirects' | 'timeout' | 'too_large' | 'network';

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

export type HostResolver = (hostname: string) => Promise<string[]>;

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  /** Deadline for the whole exchange including redirects and the body. Default 15 s. */
  timeoutMs?: number;
  /** Maximum response body size. Default 5 MiB. */
  maxBytes?: number;
  /** Maximum redirects to follow. Default 3. */
  maxRedirects?: number;
  /** Resolver used to reject hosts that point at private addresses; null disables the DNS check. */
  resolveHost?: HostResolver | null;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

export interface SafeResponse {
  status: number;
  ok: boolean;
  /** Final URL after redirects. */
  url: string;
  headers: Headers;
  body: Uint8Array;
  text(): string;
  json<T>(): T;
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa', '.lan', '.intranet'];
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

// ---------------------------------------------------------------------------
// IP classification
// ---------------------------------------------------------------------------

export function parseIPv4(text: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return null;
  return [octets[0], octets[1], octets[2], octets[3]];
}

/** Parses an IPv6 address (optionally bracketed, with an embedded IPv4 tail) into 8 hextets. */
export function parseIPv6(text: string): number[] | null {
  let s = text.trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(':')) return null;

  let tail: number[] = [];
  const lastColon = s.lastIndexOf(':');
  const last = s.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = parseIPv4(last);
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    const prefix = s.slice(0, lastColon + 1);
    s = prefix.endsWith('::') ? prefix : s.slice(0, lastColon);
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    const out: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = parseGroups(halves[0]);
  const rest = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !rest) return null;
  const explicit = head.length + rest.length + tail.length;
  if (halves.length === 1) {
    return explicit === 8 ? [...head, ...tail] : null;
  }
  if (explicit > 7) return null;
  return [...head, ...new Array<number>(8 - explicit).fill(0), ...rest, ...tail];
}

function ipv4IsPrivate([a, b, c]: [number, number, number, number]): boolean {
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

function ipv6IsPrivate(h: number[]): boolean {
  const allZeroPrefix = (n: number) => h.slice(0, n).every((x) => x === 0);
  if (allZeroPrefix(8)) return true; // ::
  if (allZeroPrefix(7) && h[7] === 1) return true; // ::1
  const embedded = (hi: number, lo: number): [number, number, number, number] => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  if (allZeroPrefix(5) && h[5] === 0xffff) return ipv4IsPrivate(embedded(h[6], h[7])); // ::ffff:a.b.c.d
  if (allZeroPrefix(6)) return true; // deprecated IPv4-compatible ::a.b.c.d
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) {
    return ipv4IsPrivate(embedded(h[6], h[7])); // NAT64 64:ff9b::/96
  }
  if (h[0] === 0x2002) return ipv4IsPrivate(embedded(h[1], h[2])); // 6to4
  if (h[0] === 0x0100 && h.slice(1, 4).every((x) => x === 0)) return true; // discard 100::/64
  if (h[0] === 0x2001 && h[1] < 0x0200) return true; // IETF protocol assignments incl. Teredo
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
  if ((h[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7 (incl. fd00:ec2::254 metadata)
  if ((h[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((h[0] & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** True for any IP literal that must never be fetched; false for public addresses and non-IPs. */
export function isPrivateAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return ipv4IsPrivate(v4);
  const v6 = parseIPv6(address);
  if (v6) return ipv6IsPrivate(v6);
  return false;
}

function isIpLiteral(hostname: string): boolean {
  return parseIPv4(hostname) !== null || parseIPv6(hostname) !== null;
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/**
 * Parses and validates a user-supplied URL. Throws SafeFetchError('unsafe_url') with a message
 * that is safe to show to the student.
 */
export function assertPublicHttpsUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    throw new SafeFetchError('unsafe_url', 'That does not look like a valid web address.');
  }
  if (url.protocol !== 'https:') {
    throw new SafeFetchError('unsafe_url', 'The address must start with https://.');
  }
  if (url.username || url.password) {
    throw new SafeFetchError('unsafe_url', 'The address must not contain a username or password.');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) throw new SafeFetchError('unsafe_url', 'The address is missing a host name.');

  if (isIpLiteral(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new SafeFetchError('unsafe_url', 'That address points to a private network.');
    }
    return url;
  }
  if (BLOCKED_HOSTS.has(hostname) || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new SafeFetchError('unsafe_url', 'That address points to a private network.');
  }
  if (!hostname.includes('.')) {
    throw new SafeFetchError('unsafe_url', 'Use the full address, e.g. https://school.instructure.com.');
  }
  const labels = hostname.split('.');
  if (labels.some((label) => label.length === 0 || label.length > 63) || hostname.length > 253) {
    throw new SafeFetchError('unsafe_url', 'That does not look like a valid web address.');
  }
  return url;
}

interface DenoDnsLike {
  resolveDns(query: string, recordType: 'A' | 'AAAA'): Promise<string[]>;
}

function runtimeResolver(): HostResolver | null {
  const deno = (globalThis as unknown as { Deno?: Partial<DenoDnsLike> }).Deno;
  if (!deno || typeof deno.resolveDns !== 'function') return null;
  const resolveDns = deno.resolveDns.bind(deno);
  return async (hostname) => {
    const lookups = await Promise.allSettled([resolveDns(hostname, 'A'), resolveDns(hostname, 'AAAA')]);
    return lookups.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  };
}

async function assertResolvesPublic(url: URL, resolver: HostResolver | null): Promise<void> {
  const hostname = url.hostname.replace(/\.$/, '');
  if (!resolver || isIpLiteral(hostname)) return;
  let addresses: string[];
  try {
    addresses = await resolver(hostname);
  } catch {
    // Resolution unavailable in this runtime: the literal-host checks above still apply and the
    // platform's egress rules cover the rest. A genuinely missing host fails at fetch time.
    return;
  }
  if (addresses.some(isPrivateAddress)) {
    throw new SafeFetchError('unsafe_url', 'That address points to a private network.');
  }
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new SafeFetchError('too_large', 'The response is too large.');
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SafeFetchError('too_large', 'The response is too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

/** GET a user-supplied URL with SSRF protections. Non-2xx responses are returned, not thrown. */
export async function safeFetch(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const {
    timeoutMs = 15_000,
    maxBytes = 5 * 1024 * 1024,
    maxRedirects = 3,
    fetchImpl = fetch,
  } = options;
  const resolver = options.resolveHost === undefined ? runtimeResolver() : options.resolveHost;
  const signal = AbortSignal.timeout(timeoutMs);

  let url = assertPublicHttpsUrl(input);
  const originalOrigin = url.origin;
  let headers: Record<string, string> = { ...(options.headers ?? {}) };

  try {
    for (let hop = 0; ; hop++) {
      await assertResolvesPublic(url, resolver);
      const response = await fetchImpl(url.href, { method: 'GET', headers, redirect: 'manual', signal });

      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw new SafeFetchError('network', 'The server sent a redirect without a location.');
        if (hop >= maxRedirects) throw new SafeFetchError('too_many_redirects', 'The address redirects too many times.');
        url = assertPublicHttpsUrl(new URL(location, url));
        if (url.origin !== originalOrigin) {
          headers = Object.fromEntries(
            Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADERS.includes(name.toLowerCase())),
          );
        }
        continue;
      }

      const body = await readCapped(response, maxBytes);
      const finalUrl = url.href;
      return {
        status: response.status,
        ok: response.ok,
        url: finalUrl,
        headers: response.headers,
        body,
        text: () => new TextDecoder().decode(body),
        json: <T>() => JSON.parse(new TextDecoder().decode(body)) as T,
      };
    }
  } catch (err) {
    if (err instanceof SafeFetchError) throw err;
    if (isAbort(err)) throw new SafeFetchError('timeout', 'The server took too long to answer.');
    throw new SafeFetchError('network', 'Could not reach that server.');
  }
}
