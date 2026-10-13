import { expect, test } from "bun:test";
import { clientIp } from "@/lib/rate-limit/ip";

const ip = (value: string, header = "x-real-ip") =>
  clientIp(new Request("http://localhost/", { headers: { [header]: value } }), "x-real-ip");

test("only the trusted header counts, and anything unusable is unknown", () => {
  expect(ip("203.0.113.8")).toBe("203.0.113.8");
  expect(ip("203.0.113.8", "x-forwarded-for")).toBe("unknown");
  for (const bad of ["", "nonsense", "203.0.113.8, 10.0.0.1", "fe80::1%eth0"]) expect(ip(bad)).toBe("unknown");
  expect(clientIp(new Request("http://localhost/", { headers: { "x-real-ip": "203.0.113.8" } }), null)).toBe("unknown");
});

test("every address in one IPv6 /64 shares a bucket, however it is spelled", () => {
  for (const spelling of ["2001:db8:0:1::1", "2001:0DB8:0000:0001:ffff:ffff:ffff:ffff", "2001:db8::1:0:0:0:9"]) {
    expect(ip(spelling)).toBe("2001:db8:0:1::/64");
  }
  expect(ip("2001:db8:0:2::1")).toBe("2001:db8:0:2::/64");
  expect(ip("::ffff:203.0.113.8")).toBe("203.0.113.8");
});
