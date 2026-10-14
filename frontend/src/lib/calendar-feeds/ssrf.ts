/**
 * Pure checks that decide whether a feed URL or address may be fetched at all.
 * Everything here fails closed: an address that does not parse counts as
 * blocked, so a parser bug can never turn into an intranet request.
 */

/** True when the address must never be fetched: loopback, private, link-local, or reserved. */
export function isBlockedAddress(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4 !== null) return isBlockedIpv4(v4);
  const v6 = parseIpv6(ip);
  if (v6 !== null) return isBlockedIpv6(v6);
  return true;
}

/** URL hostnames that must be rejected before DNS: loopback and local-suffix names. */
function isBlockedHostname(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".localhost.") ||
    host === "localhost." ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host.endsWith(".local.")
  );
}

function parseIpv4(input: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(input);
  if (match === null) return null;
  const octets = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  if (octets.some((octet) => octet > 255)) return null;
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function isBlockedIpv4(ip: number): boolean {
  return (
    (ip >>> 24) === 0 || // 0.0.0.0/8 "this network"
    (ip >>> 24) === 10 || // 10.0.0.0/8 private
    (ip >>> 22) === 401 || // 100.64.0.0/10 carrier-grade NAT
    (ip >>> 24) === 127 || // 127.0.0.0/8 loopback
    (ip >>> 16) === 0xa9fe || // 169.254.0.0/16 link-local, including 169.254.169.254 metadata
    (ip >>> 20) === 0xac1 || // 172.16.0.0/12 private
    (ip >>> 16) === 49320 || // 192.168.0.0/16 private (RFC 1918)
    (ip >>> 8) === 0xc00000 || // 192.0.0.0/24
    (ip >>> 8) === 0xc00002 || // 192.0.2.0/24 TEST-NET-1
    (ip >>> 15) === 101412 || // 198.18.0.0/15 benchmarking
    (ip >>> 8) === 0xc63364 || // 198.51.100.0/24 TEST-NET-2
    (ip >>> 8) === 0xcb0071 || // 203.0.113.0/24 TEST-NET-3
    (ip >>> 28) === 0xe || // 224.0.0.0/4 multicast
    (ip >>> 28) === 0xf // 240.0.0.0/4 reserved, including the broadcast address
  );
}

const LOW32 = BigInt("0xffffffff");

/** The top 96 bits of the IPv6 forms that carry an IPv4 address in their low 32 bits. */
const EMBEDDED_IPV4_PREFIXES = [
  BigInt(0), // ::/96 IPv4-compatible (this also covers :: and ::1, whose IPv4 lands in 0.0.0.0/8)
  BigInt("0xffff"), // ::ffff:0:0/96 IPv4-mapped
  BigInt("0x0064ff9b0000000000000000"), // 64:ff9b::/96 NAT64 well-known prefix
];

/**
 * An allowlist, not a blocklist: IPv6 has too many reserved and
 * locally-routed ranges (fec0::/10 site-local is one a blocklist missed) to
 * enumerate safely. Only global unicast 2000::/3 passes, minus its
 * special-purpose ranges; the IPv4-carrying forms above are judged by their
 * embedded address under the IPv4 rules. Everything else is blocked,
 * including fec0::/10, fc00::/7, fe80::/10, ff00::/8 and ::1.
 */
function isBlockedIpv6(value: bigint): boolean {
  const top96 = value >> BigInt(32);
  if (EMBEDDED_IPV4_PREFIXES.some((prefix) => prefix === top96)) return isBlockedIpv4(Number(value & LOW32));
  if (value >> BigInt(125) !== BigInt(1)) return true; // outside 2000::/3 global unicast
  return (
    value >> BigInt(105) === BigInt("0x100080") || // 2001::/23 IETF protocol assignments, including Teredo 2001::/32
    value >> BigInt(96) === BigInt("0x20010db8") || // 2001:db8::/32 documentation
    value >> BigInt(112) === BigInt("0x2002") || // 2002::/16 6to4
    value >> BigInt(108) === BigInt("0x3fff0") // 3fff::/20 documentation (RFC 9637)
  );
}

/**
 * Parses an IPv6 address, including the zone-index and embedded-IPv4 forms, to
 * its 128-bit value. Returns null when the input is not an IPv6 literal.
 */
function parseIpv6(input: string): bigint | null {
  let text = input;
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone); // strip an IPv6 zone index
  text = text.toLowerCase();
  if (text === "") return null;

  let v4Tail: number | null = null;
  const dotted = /\d+\.\d+\.\d+\.\d+$/.exec(text);
  if (dotted !== null) {
    const parsed = parseIpv4(dotted[0]);
    if (parsed === null) return null;
    v4Tail = parsed;
    text = text.slice(0, text.length - dotted[0].length);
    if (!text.endsWith(":")) return null;
    // Drop the separator before the IPv4 part, unless it belongs to "::" (as in ::8.8.8.8).
    if (!text.endsWith("::")) text = text.slice(0, -1);
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 && halves[1] !== "" ? halves[1].split(":") : [];
  const isHexGroup = (group: string) => /^[0-9a-f]{1,4}$/.test(group);
  if (!head.every(isHexGroup) || !tail.every(isHexGroup)) return null;
  const headValues = head.map((group) => parseInt(group, 16));
  const tailValues = tail.map((group) => parseInt(group, 16));
  const fill = 8 - headValues.length - tailValues.length - (v4Tail !== null ? 2 : 0);
  if (fill < 0) return null;
  if (halves.length === 1 && fill !== 0) return null; // no "::" seen: exactly eight groups
  if (halves.length === 2 && fill < 1) return null; // "::" must cover at least one group

  const groups = [...headValues, ...new Array<number>(fill).fill(0), ...tailValues];
  let value = BigInt(0);
  for (const group of groups) value = (value << BigInt(16)) | BigInt(group);
  if (v4Tail !== null) value = (value << BigInt(32)) | BigInt(v4Tail);
  return value;
}

/** The host of a parsed URL when it is an IP literal (IPv6 keeps its brackets in url.hostname). */
export function ipLiteralHost(hostname: string): string | null {
  if (hostname.startsWith("[")) {
    const end = hostname.lastIndexOf("]");
    return end > 0 ? hostname.slice(1, end) : hostname.slice(1);
  }
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) ? hostname : null;
}

/** The longest URL accepted for a feed, in characters. */
export const MAX_FEED_URL_LENGTH = 2048;

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Validates a caller-supplied feed URL before anything network happens:
 * https only, no credentials, at most 2048 characters, no loopback or
 * local-suffix hostnames, and no blocked IP literal. Hostnames are checked
 * again at DNS resolution time, where rebinding-style tricks land.
 */
export function validateCalendarUrl(raw: string): UrlCheck {
  if (raw.length > MAX_FEED_URL_LENGTH) return { ok: false, reason: "the URL is longer than 2048 characters" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "the URL did not parse" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "only https URLs are allowed" };
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "URL credentials are not allowed" };
  }
  // A trailing dot is an FQDN root hint, not part of the name; judge the bare host.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isBlockedHostname(host)) return { ok: false, reason: "local hostnames are not allowed" };
  const literal = ipLiteralHost(host);
  if (literal !== null && isBlockedAddress(literal)) {
    return { ok: false, reason: "the URL points at a blocked address" };
  }
  return { ok: true, url };
}
