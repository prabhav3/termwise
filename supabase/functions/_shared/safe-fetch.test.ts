import { describe, expect, it } from 'vitest';
import { assertPublicHttpsUrl, isPrivateAddress, parseIPv6, safeFetch, SafeFetchError } from './safe-fetch.ts';

const rejects = (url: string) => {
  expect(() => assertPublicHttpsUrl(url), url).toThrow(SafeFetchError);
};

describe('assertPublicHttpsUrl', () => {
  it('accepts public https hosts', () => {
    expect(assertPublicHttpsUrl('https://school.instructure.com/api/v1').hostname).toBe('school.instructure.com');
    expect(assertPublicHttpsUrl('https://moodle.example.edu:8443/calendar/export_execute.php').port).toBe('8443');
    expect(assertPublicHttpsUrl('https://8.8.8.8/').hostname).toBe('8.8.8.8');
    expect(assertPublicHttpsUrl('https://[2606:4700:4700::1111]/').hostname).toBe('[2606:4700:4700::1111]');
  });

  it('requires https and no credentials', () => {
    rejects('http://school.instructure.com');
    rejects('ftp://school.instructure.com');
    rejects('webcal://school.instructure.com/feed.ics');
    rejects('https://user:pass@school.instructure.com');
    rejects('not a url');
  });

  it('rejects bare and internal hostnames', () => {
    rejects('https://intranet/');
    rejects('https://localhost/');
    rejects('https://localhost./');
    rejects('https://api.localhost/');
    rejects('https://printer.local/');
    rejects('https://metadata.google.internal/computeMetadata/v1/');
    rejects('https://router.home.arpa/');
  });

  it('rejects private, loopback, link-local and metadata IP literals in every spelling', () => {
    for (const url of [
      'https://127.0.0.1/',
      'https://127.1.2.3/',
      'https://2130706433/', // decimal 127.0.0.1
      'https://0x7f.1/', // hex shorthand
      'https://0.0.0.0/',
      'https://10.1.2.3/',
      'https://172.16.0.1/',
      'https://172.31.255.255/',
      'https://192.168.1.1/',
      'https://100.64.0.1/',
      'https://169.254.169.254/latest/meta-data/',
      'https://224.0.0.1/',
      'https://255.255.255.255/',
      'https://[::1]/',
      'https://[::]/',
      'https://[::ffff:127.0.0.1]/',
      'https://[::ffff:a9fe:a9fe]/',
      'https://[fd00:ec2::254]/',
      'https://[fe80::1]/',
      'https://[fc00::1]/',
      'https://[ff02::1]/',
      'https://[64:ff9b::a9fe:a9fe]/',
      'https://[2002:7f00:1::]/',
    ]) {
      rejects(url);
    }
  });

  it('keeps public neighbours of private ranges', () => {
    expect(() => assertPublicHttpsUrl('https://172.32.0.1/')).not.toThrow();
    expect(() => assertPublicHttpsUrl('https://100.128.0.1/')).not.toThrow();
    expect(() => assertPublicHttpsUrl('https://169.253.1.1/')).not.toThrow();
  });
});

describe('address parsing', () => {
  it('parses IPv6 forms', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('[2001:db8::8:800:200c:417a]')).toEqual([0x2001, 0xdb8, 0, 0, 8, 0x800, 0x200c, 0x417a]);
    expect(parseIPv6('::ffff:192.168.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0001]);
    expect(parseIPv6('::1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0, 0x0102, 0x0304]);
    expect(parseIPv6('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(parseIPv6('1::2::3')).toBeNull();
  });

  it('classifies addresses', () => {
    expect(isPrivateAddress('10.0.0.1')).toBe(true);
    expect(isPrivateAddress('fe80::abcd')).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(isPrivateAddress('2606:4700::6810:84e5')).toBe(false);
  });
});

describe('safeFetch', () => {
  const okHeaders = (extra: Record<string, string> = {}) => new Headers({ 'content-type': 'text/plain', ...extra });

  it('follows redirects, re-validates each hop, and drops credentials across origins', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
      if (url === 'https://a.example.com/start') return new Response(null, { status: 302, headers: { location: '/next' } });
      if (url === 'https://a.example.com/next') return new Response(null, { status: 301, headers: { location: 'https://b.example.com/end' } });
      return new Response('done', { status: 200, headers: okHeaders() });
    }) as typeof fetch;
    const res = await safeFetch('https://a.example.com/start', { headers: { Authorization: 'Bearer t' }, fetchImpl, resolveHost: null });
    expect(res.text()).toBe('done');
    expect(res.url).toBe('https://b.example.com/end');
    expect(seen.map((s) => s.auth)).toEqual(['Bearer t', 'Bearer t', null]);
  });

  it('refuses redirects into private space and redirect loops', async () => {
    const toPrivate = (async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/admin' } })) as typeof fetch;
    await expect(safeFetch('https://a.example.com/', { fetchImpl: toPrivate, resolveHost: null })).rejects.toMatchObject({ code: 'unsafe_url' });
    const loop = (async () => new Response(null, { status: 302, headers: { location: 'https://a.example.com/again' } })) as typeof fetch;
    await expect(safeFetch('https://a.example.com/', { fetchImpl: loop, resolveHost: null })).rejects.toMatchObject({ code: 'too_many_redirects' });
  });

  it('caps the body size', async () => {
    const big = (async () => new Response('x'.repeat(2048), { status: 200 })) as typeof fetch;
    await expect(safeFetch('https://a.example.com/', { fetchImpl: big, maxBytes: 1024, resolveHost: null })).rejects.toMatchObject({ code: 'too_large' });
  });

  it('rejects hosts that resolve to private addresses', async () => {
    const fetchImpl = (async () => new Response('nope')) as typeof fetch;
    await expect(
      safeFetch('https://rebind.example.com/', { fetchImpl, resolveHost: async () => ['93.184.216.34', '10.0.0.5'] }),
    ).rejects.toMatchObject({ code: 'unsafe_url' });
    const ok = await safeFetch('https://public.example.com/', { fetchImpl, resolveHost: async () => ['93.184.216.34'] });
    expect(ok.status).toBe(200);
  });

  it('maps timeouts', async () => {
    const slow = ((_: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;
    await expect(safeFetch('https://a.example.com/', { fetchImpl: slow, timeoutMs: 20, resolveHost: null })).rejects.toMatchObject({ code: 'timeout' });
  });
});
