/**
 * One app, two products (docs/design/untangle-v3.md, "One app, branded by
 * host"): on vsb.untgrades.app the schedule builder is the standalone "UNT
 * Schedule Builder", with no account, a term picker and a line saying when
 * the section data was updated. Everywhere else it is UNTangle. `?host=vsb`
 * (or `?host=untangle`) picks one explicitly, so both can be checked on any
 * deployment.
 */

export type HostId = "untangle" | "vsb";

export type Brand = {
  id: HostId;
  name: string;
  /** The build button: "Auto" in UNTangle, vsb's own name in the standalone builder. */
  primaryLabel: string;
  /** The same button where space is tight (the phone action bar). */
  primaryShort: string;
  /** Sign-in and sync. The standalone builder saves on the device only. */
  accounts: boolean;
  /** A term control in the header, and the data-freshness line beside it. */
  termPicker: boolean;
  freshness: boolean;
  /** Search opens on "You can take", read from the student's transcript. */
  suggestions: boolean;
};

const BRANDS: Record<HostId, Brand> = {
  untangle: {
    id: "untangle",
    name: "UNTangle",
    primaryLabel: "Auto",
    primaryShort: "Auto",
    accounts: true,
    termPicker: false,
    freshness: false,
    suggestions: true,
  },
  vsb: {
    id: "vsb",
    name: "UNT Schedule Builder",
    primaryLabel: "Build my schedule",
    primaryShort: "Build",
    accounts: false,
    termPicker: true,
    freshness: true,
    suggestions: false,
  },
};

/** Hostnames that serve the standalone builder. */
export const VSB_HOSTNAMES: readonly string[] = ["vsb.untgrades.app"];

function isHostId(value: string | null | undefined): value is HostId {
  return value === "untangle" || value === "vsb";
}

/**
 * The product for a request. `host` is the Host header (a port is ignored);
 * `override` is the `?host=` query value, which wins when it names a product
 * and is ignored otherwise.
 */
export function hostIdFor(host: string | null | undefined, override?: string | null): HostId {
  const named = override?.toLowerCase();
  if (isHostId(named)) return named;
  const hostname = (host ?? "").split(":")[0].toLowerCase();
  return VSB_HOSTNAMES.includes(hostname) ? "vsb" : "untangle";
}

export function brandFor(id: HostId): Brand {
  return BRANDS[id];
}
