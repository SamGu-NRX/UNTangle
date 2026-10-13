import { isIP } from "node:net";

/**
 * The caller's address as read from the trusted header, or "unknown", which all such callers share.
 * IPv6 is grouped by /64: one home or phone usually holds a whole /64 and could otherwise
 * change addresses to get a fresh allowance.
 */
export function clientIp(request: Request, header: string | null): string {
  const raw = (header && request.headers.get(header)?.trim()) || "";
  if (isIP(raw) === 4) return raw;
  // A zone id ("fe80::1%eth0") never comes from a proxy, and URL rejects it.
  if (isIP(raw) !== 6 || raw.includes("%")) return "unknown";
  // URL lowercases, compresses and turns a trailing dotted quad into two hex words.
  const words = expand(new URL(`http://[${raw}]`).hostname.slice(1, -1));
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join(".");
  }
  return `${words.slice(0, 4).map((word) => word.toString(16)).join(":")}::/64`;
}

function expand(ip: string): number[] {
  const [head, tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...zeros, ...right].map((word) => parseInt(word, 16));
}
