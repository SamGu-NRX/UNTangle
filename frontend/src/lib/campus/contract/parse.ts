import { err, ValidationError } from "./errors";
import {
  ACCESS_VALUES,
  Dataset,
  EDGE_KINDS,
  EVIDENCE_VALUES,
  GraphEdge,
  GraphNode,
  MapFeature,
  SCHEMA_VERSION,
  SourceRecord,
} from "./model";

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// The ISO_UTC regex also matches impossible calendar dates ("2026-02-30T00:00:00Z").
// Round-trip the parsed fields through the constructed Date and compare the UTC
// components: setUTC* normalizes out-of-range values by rolling them over, so any
// field mismatch proves the timestamp names no real moment.
// Date.UTC(year, ...) cannot be used here: it maps years 0-99 onto 1900-1999,
// which wrongly rejected valid ISO years 0000-0099.
function isRealTimestamp(v: string): boolean {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(h, mi, s, 0);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && dt.getUTCHours() === h && dt.getUTCMinutes() === mi && dt.getUTCSeconds() === s;
}

function checkTimestamp(v: unknown, path: string, errors: ValidationError[]): boolean {
  if (v === null) return true;
  if (typeof v !== "string" || !ISO_UTC.test(v) || !isRealTimestamp(v)) {
    errors.push(err("INVALID_TIMESTAMP", path, "must be null or a real ISO 8601 UTC timestamp ending in Z (impossible calendar dates like 2026-02-30T00:00:00Z are rejected, not just pattern-matched)"));
    return false;
  }
  return true;
}

function checkFiniteNumber(
  v: unknown,
  path: string,
  errors: ValidationError[],
  opts: { nullable: boolean; allowNegative: boolean }
): boolean {
  if (v === null && opts.nullable) return true;
  if (typeof v !== "number") {
    errors.push(err("INVALID_TYPE", path, `must be a number${opts.nullable ? " or null" : ""}`));
    return false;
  }
  if (!Number.isFinite(v)) {
    errors.push(err("NONFINITE_MEASUREMENT", path, "measurement must be finite (NaN and Infinity are rejected; unknown values must be null)"));
    return false;
  }
  if (!opts.allowNegative && v < 0) {
    errors.push(err("NEGATIVE_LENGTH", path, "must be nonnegative"));
    return false;
  }
  return true;
}

function checkPosition(v: unknown, path: string, errors: ValidationError[]): boolean {
  if (!Array.isArray(v) || v.length !== 2) {
    errors.push(err("INVALID_COORDINATE", path, "position must be [longitude, latitude] with exactly two numbers"));
    return false;
  }
  const lon = v[0];
  const lat = v[1];
  if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    errors.push(err("INVALID_COORDINATE", path, "longitude and latitude must be finite numbers"));
    return false;
  }
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    errors.push(err("INVALID_COORDINATE", path, `coordinate out of WGS84 range: lon=${lon} lat=${lat}`));
    return false;
  }
  return true;
}

function checkGeometry(g: unknown, path: string, errors: ValidationError[]): boolean {
  if (g === null) return true;
  if (!isObj(g)) {
    errors.push(err("INVALID_GEOMETRY", path, "geometry must be an object or null"));
    return false;
  }
  const type = g["type"];
  const coords = g["coordinates"];
  if (type === "Point") {
    return checkPosition(coords, `${path}.coordinates`, errors);
  }
  if (type === "LineString") {
    if (!Array.isArray(coords) || coords.length < 2) {
      errors.push(err("INVALID_GEOMETRY", path, "LineString needs at least two positions"));
      return false;
    }
    let ok = true;
    (coords as unknown[]).forEach((p, i) => {
      if (!checkPosition(p, `${path}.coordinates[${i}]`, errors)) ok = false;
    });
    return ok;
  }
  if (type === "MultiLineString") {
    if (!Array.isArray(coords) || coords.length < 1) {
      errors.push(err("INVALID_GEOMETRY", path, "MultiLineString needs at least one line"));
      return false;
    }
    let ok = true;
    (coords as unknown[]).forEach((line, li) => {
      if (!Array.isArray(line) || (line as unknown[]).length < 2) {
        errors.push(err("INVALID_GEOMETRY", `${path}.coordinates[${li}]`, "each MultiLineString line needs at least two positions"));
        ok = false;
        return;
      }
      (line as unknown[]).forEach((p, pi) => {
        if (!checkPosition(p, `${path}.coordinates[${li}][${pi}]`, errors)) ok = false;
      });
    });
    return ok;
  }
  if (type === "Polygon") {
    if (!Array.isArray(coords) || coords.length < 1) {
      errors.push(err("INVALID_GEOMETRY", path, "Polygon needs at least one ring"));
      return false;
    }
    let ok = true;
    (coords as unknown[]).forEach((ring, ri) => {
      if (!Array.isArray(ring) || (ring as unknown[]).length < 4) {
        errors.push(err("INVALID_GEOMETRY", `${path}.coordinates[${ri}]`, "polygon ring needs at least four positions"));
        ok = false;
        return;
      }
      (ring as unknown[]).forEach((p, pi) => {
        if (!checkPosition(p, `${path}.coordinates[${ri}][${pi}]`, errors)) ok = false;
      });
      const r = ring as unknown[];
      const first = JSON.stringify(r[0]);
      const last = JSON.stringify(r[r.length - 1]);
      if (first !== last) {
        errors.push(err("INVALID_GEOMETRY", `${path}.coordinates[${ri}]`, "polygon ring must be closed"));
        ok = false;
      }
    });
    return ok;
  }
  errors.push(err("INVALID_GEOMETRY", path, "geometry.type must be Point, LineString, MultiLineString or Polygon"));
  return false;
}

function nonEmptyString(v: unknown, path: string, errors: ValidationError[]): boolean {
  if (typeof v !== "string" || v.length === 0) {
    errors.push(err("INVALID_TYPE", path, "must be a nonempty string"));
    return false;
  }
  return true;
}

function checkEnum(v: unknown, allowed: readonly string[], path: string, errors: ValidationError[]): boolean {
  if (typeof v !== "string" || !allowed.includes(v)) {
    errors.push(err("INVALID_ENUM", path, `must be one of: ${allowed.join(", ")}`));
    return false;
  }
  return true;
}

export function parseDataset(input: unknown): { dataset: Dataset | null; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  if (!isObj(input)) {
    return { dataset: null, errors: [err("INVALID_TYPE", "$", "dataset must be a JSON object")] };
  }
  if (input["schema_version"] !== SCHEMA_VERSION) {
    errors.push(err("INVALID_SCHEMA_VERSION", "$.schema_version", `unsupported schema version: ${JSON.stringify(input["schema_version"])}; expected "${SCHEMA_VERSION}"`));
    return { dataset: null, errors };
  }
  nonEmptyString(input["dataset_id"], "$.dataset_id", errors);
  nonEmptyString(input["revision"], "$.revision", errors);
  if (typeof input["demo"] !== "boolean") {
    errors.push(err("INVALID_TYPE", "$.demo", "must be a boolean"));
  }

  const sources: SourceRecord[] = [];
  if (!Array.isArray(input["sources"])) {
    errors.push(err("INVALID_TYPE", "$.sources", "must be an array"));
  } else {
    input["sources"].forEach((s, i) => {
      const p = `$.sources[${i}]`;
      if (!isObj(s)) {
        errors.push(err("INVALID_TYPE", p, "source must be an object"));
        return;
      }
      const before = errors.length;
      nonEmptyString(s["id"], `${p}.id`, errors);
      if (typeof s["url"] !== "string") errors.push(err("INVALID_TYPE", `${p}.url`, "must be a string"));
      if (s["license"] !== null && typeof s["license"] !== "string") {
        errors.push(err("INVALID_TYPE", `${p}.license`, "must be a string or null (unknown license is null, never a reuse grant)"));
      }
      checkTimestamp(s["retrieved_at"], `${p}.retrieved_at`, errors);
      if (typeof s["notes"] !== "string") errors.push(err("INVALID_TYPE", `${p}.notes`, "must be a string"));
      if (errors.length === before) sources.push(s as unknown as SourceRecord);
    });
  }

  const features: MapFeature[] = [];
  const fc = input["features"];
  if (!isObj(fc) || fc["type"] !== "FeatureCollection" || !Array.isArray(fc["features"])) {
    errors.push(err("INVALID_TYPE", "$.features", "must be a GeoJSON FeatureCollection"));
  } else {
    fc["features"].forEach((f, i) => {
      const p = `$.features.features[${i}]`;
      if (!isObj(f)) {
        errors.push(err("INVALID_TYPE", p, "feature must be an object"));
        return;
      }
      const before = errors.length;
      if (f["type"] !== "Feature") {
        errors.push(err("INVALID_TYPE", `${p}.type`, `must be "Feature"`));
      }
      nonEmptyString(f["id"], `${p}.id`, errors);
      const props = f["properties"];
      if (!isObj(props)) {
        errors.push(err("INVALID_TYPE", `${p}.properties`, "must be an object"));
        return;
      }
      nonEmptyString(props["kind"], `${p}.properties.kind`, errors);
      if (props["name"] !== null && typeof props["name"] !== "string") {
        errors.push(err("INVALID_TYPE", `${p}.properties.name`, "must be a string or null"));
      }
      if (!Array.isArray(props["source_ids"]) || !props["source_ids"].every((x) => typeof x === "string" && x.length > 0)) {
        errors.push(err("INVALID_TYPE", `${p}.properties.source_ids`, "must be an array of nonempty strings"));
      }
      checkTimestamp(props["observed_at"], `${p}.properties.observed_at`, errors);
      checkEnum(props["evidence"], EVIDENCE_VALUES, `${p}.properties.evidence`, errors);
      checkGeometry(f["geometry"], `${p}.geometry`, errors);
      if (errors.length === before) features.push(f as unknown as MapFeature);
    });
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const graph = input["graph"];
  if (!isObj(graph) || !Array.isArray(graph["nodes"]) || !Array.isArray(graph["edges"])) {
    errors.push(err("INVALID_TYPE", "$.graph", "must be an object with nodes and edges arrays"));
  } else {
    graph["nodes"].forEach((n, i) => {
      const p = `$.graph.nodes[${i}]`;
      if (!isObj(n)) {
        errors.push(err("INVALID_TYPE", p, "node must be an object"));
        return;
      }
      const before = errors.length;
      nonEmptyString(n["id"], `${p}.id`, errors);
      nonEmptyString(n["feature_id"], `${p}.feature_id`, errors);
      checkPosition(n["position"], `${p}.position`, errors);
      if (n["building_id"] !== null && typeof n["building_id"] !== "string") {
        errors.push(err("INVALID_TYPE", `${p}.building_id`, "must be a string or null"));
      }
      nonEmptyString(n["level_id"], `${p}.level_id`, errors);
      if (errors.length === before) nodes.push(n as unknown as GraphNode);
    });
    graph["edges"].forEach((e, i) => {
      const p = `$.graph.edges[${i}]`;
      if (!isObj(e)) {
        errors.push(err("INVALID_TYPE", p, "edge must be an object"));
        return;
      }
      const before = errors.length;
      nonEmptyString(e["id"], `${p}.id`, errors);
      nonEmptyString(e["feature_id"], `${p}.feature_id`, errors);
      nonEmptyString(e["from"], `${p}.from`, errors);
      nonEmptyString(e["to"], `${p}.to`, errors);
      checkEnum(e["kind"], EDGE_KINDS, `${p}.kind`, errors);
      checkFiniteNumber(e["length_m"], `${p}.length_m`, errors, { nullable: false, allowNegative: false });
      checkFiniteNumber(e["width_m"], `${p}.width_m`, errors, { nullable: true, allowNegative: false });
      checkFiniteNumber(e["slope"], `${p}.slope`, errors, { nullable: true, allowNegative: true });
      checkFiniteNumber(e["cross_slope"], `${p}.cross_slope`, errors, { nullable: true, allowNegative: false });
      checkFiniteNumber(e["step_height_m"], `${p}.step_height_m`, errors, { nullable: true, allowNegative: false });
      if (e["surface"] !== null && typeof e["surface"] !== "string") {
        errors.push(err("INVALID_TYPE", `${p}.surface`, "must be a string or null"));
      }
      checkEnum(e["access"], ACCESS_VALUES, `${p}.access`, errors);
      checkEnum(e["evidence"], EVIDENCE_VALUES, `${p}.evidence`, errors);
      checkTimestamp(e["observed_at"], `${p}.observed_at`, errors);
      if (errors.length === before) edges.push(e as unknown as GraphEdge);
    });
  }

  if (errors.length > 0) {
    return { dataset: null, errors };
  }
  const dataset: Dataset = {
    schema_version: SCHEMA_VERSION,
    dataset_id: input["dataset_id"] as string,
    revision: input["revision"] as string,
    demo: input["demo"] as boolean,
    sources,
    features: { type: "FeatureCollection", features },
    graph: { nodes, edges },
  };
  return { dataset, errors };
}
