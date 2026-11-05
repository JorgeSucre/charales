/**
 * Who is the client (S-01, R-1, TRUSTED_PROXIES): one canonical text per address, the bucket its limits count on, and
 * the reverse proxies whose X-Forwarded-For is believed.
 */
import { BlockList, isIP } from 'node:net';

/**
 * One text per address: `2001:DB8::1` and `2001:0db8:0:0:0:0:0:1` are the same client, and so are `203.0.113.7`,
 * `::ffff:203.0.113.7` and `::ffff:cb00:7107`. Anything that isn't an address comes back trimmed (never matches one).
 */
export function canonicalIp(raw: string): string {
  const trimmed = raw.trim();
  const zone = trimmed.indexOf('%');
  const ip = zone < 0 ? trimmed : trimmed.slice(0, zone);
  if (isIP(ip) !== 6) return ip;
  const text = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(text);
  if (!mapped) return text;
  const high = parseInt(mapped[1]!, 16);
  const low = parseInt(mapped[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/**
 * What the attempt limits count on: an IPv4 address, or the /64 of an IPv6 one. A single customer usually holds a whole
 * /64 (R-1), so counting addresses would give one attacker an unlimited number of allowances.
 */
export function limitBucket(raw: string): string {
  const ip = canonicalIp(raw);
  if (isIP(ip) !== 6) return ip;
  const [head = '', tail] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  return `${groups.slice(0, 4).join(':')}::/64`;
}

export interface TrustedProxies {
  has(ip: string): boolean;
}

/** The narrowest prefix accepted: anything wider trusts much of the Internet to say who the client is. */
const MIN_PREFIX = 8;

/** Exact addresses or CIDR ranges, IPv4 or IPv6. A wrong entry throws: a typo must not silently trust nobody. */
export function trustedProxies(entries: readonly string[]): TrustedProxies {
  const list = new BlockList();
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    const [address = '', prefix, extra] = entry.split('/');
    const ip = canonicalIp(address);
    const family = isIP(ip);
    const bits = Number(prefix);
    const valid =
      family !== 0 &&
      extra === undefined &&
      (prefix === undefined ||
        (/^\d+$/.test(prefix) && bits >= MIN_PREFIX && bits <= (family === 4 ? 32 : 128)));
    if (!valid)
      throw new Error(
        `TRUSTED_PROXIES: «${entry}» no es una dirección IP ni un rango CIDR válido (de /${MIN_PREFIX} en adelante; sin nombres).`,
      );
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) list.addAddress(ip, type);
    else list.addSubnet(ip, bits, type);
  }
  return {
    has(raw) {
      const ip = canonicalIp(raw);
      const family = isIP(ip);
      return family !== 0 && list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
    },
  };
}

/** The list of `TRUSTED_PROXIES`. `none` says «no proxy in front» explicitly: production requires one or the other. */
export function trustedProxiesFromEnv(value: string | undefined): string[] {
  const text = (value ?? '').trim();
  return !text || text.toLowerCase() === 'none' ? [] : text.split(',');
}
