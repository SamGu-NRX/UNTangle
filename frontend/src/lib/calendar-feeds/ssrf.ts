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

function isBlockedIpv6(value: bigint): boolean {
  if (value === BigInt(0) || value === BigInt(1)) return true; // :: and ::1
  if (value >> BigInt(121) === BigInt(126)) return true; // fc00::/7 unique local
  if (value >> BigInt(118) === BigInt(1018)) return true; // fe80::/10 link-local
  if (value >> BigInt(120) === BigInt(255)) return true; // ff00::/8 multicast
  if (value >> BigInt(96) === BigInt("0x20010db8")) return true; // 2001:db8::/32 documentation
  const low32 = value & LOW32;
  // Address forms that carry an IPv4 address inside them are judged by it:
  // ::ffff:0:0/96 v4-mapped, 64:ff9b::/96 NAT64, ::/96 IPv4-compatible, 2002::/16 6to4.
  if (value >> BigInt(96) === BigInt(0xffff)) return isBlockedIpv4(Number(low32));
  if (value >> BigInt(96) === BigInt("0x64ff9b")) return isBlockedIpv4(Number(low32));
  if (value >> BigInt(64) === BigInt(0)) return isBlockedIpv4(Number(low32));
  if (value >> BigInt(112) === BigInt("0x2002")) return isBlockedIpv4(Number((value >> BigInt(80)) & LOW32));
  return false;
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
    text = text.slice(0, -1);
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
