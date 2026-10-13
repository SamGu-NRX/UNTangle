import { err, ValidationError } from "./errors";
import { Dataset, GraphNode, OUTDOOR_LEVEL_ID } from "./model";

export function validateDataset(ds: Dataset, errors: ValidationError[]): void {
  const featureIds = new Set<string>();
  for (const f of ds.features.features) {
    if (featureIds.has(f.id)) {
      errors.push(err("DUPLICATE_ID", `$.features.features[id=${f.id}]`, `duplicate feature id "${f.id}"`));
    }
    featureIds.add(f.id);
  }
  const sourceIds = new Set<string>();
  for (const s of ds.sources) {
    if (sourceIds.has(s.id)) {
      errors.push(err("DUPLICATE_ID", `$.sources[id=${s.id}]`, `duplicate source id "${s.id}"`));
    }
    sourceIds.add(s.id);
  }
  const nodeById = new Map<string, GraphNode>();
  for (const n of ds.graph.nodes) {
    if (nodeById.has(n.id)) {
      errors.push(err("DUPLICATE_ID", `$.graph.nodes[id=${n.id}]`, `duplicate node id "${n.id}"`));
    }
    nodeById.set(n.id, n);
    if (!featureIds.has(n.feature_id)) {
      errors.push(err("BROKEN_REFERENCE", `$.graph.nodes[id=${n.id}].feature_id`, `references unknown feature "${n.feature_id}"`));
    }
    if (n.level_id !== OUTDOOR_LEVEL_ID && (n.building_id === null || n.building_id === "")) {
      errors.push(err("INDOOR_NODE_MISSING_BUILDING", `$.graph.nodes[id=${n.id}]`, `indoor node on level "${n.level_id}" must name its building_id (only outdoor ground uses "${OUTDOOR_LEVEL_ID}")`));
    }
    if (n.level_id === OUTDOOR_LEVEL_ID && n.building_id !== null) {
      errors.push(err("OUTDOOR_NODE_WITH_BUILDING", `$.graph.nodes[id=${n.id}]`, "outdoor node must not carry a building_id"));
    }
  }
  const edgeIds = new Set<string>();
  for (const e of ds.graph.edges) {
    if (edgeIds.has(e.id)) {
      errors.push(err("DUPLICATE_ID", `$.graph.edges[id=${e.id}]`, `duplicate edge id "${e.id}"`));
    }
    edgeIds.add(e.id);
    if (!featureIds.has(e.feature_id)) {
      errors.push(err("BROKEN_REFERENCE", `$.graph.edges[id=${e.id}].feature_id`, `references unknown feature "${e.feature_id}"`));
    }
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    if (!a) {
      errors.push(err("BROKEN_REFERENCE", `$.graph.edges[id=${e.id}].from`, `references unknown node "${e.from}"`));
    }
    if (!b) {
      errors.push(err("BROKEN_REFERENCE", `$.graph.edges[id=${e.id}].to`, `references unknown node "${e.to}"`));
    }
    if (!a || !b) continue;
    if (e.from === e.to) {
      errors.push(err("SELF_LOOP", `$.graph.edges[id=${e.id}]`, "edge connects a node to itself"));
      continue;
    }
    const levelChange = a.level_id !== b.level_id;
    // Only the explicit connectors (ramp, stairs, elevator) may change level;
    // doors may still cross the outdoor/indoor boundary, as entrances do.
    const outdoorBoundary = a.level_id === OUTDOOR_LEVEL_ID || b.level_id === OUTDOOR_LEVEL_ID;
    if (
      levelChange &&
      e.kind !== "ramp" &&
      e.kind !== "stairs" &&
      e.kind !== "elevator" &&
      !(e.kind === "door" && outdoorBoundary)
    ) {
      errors.push(err("IMPOSSIBLE_LEVEL_TRANSITION", `$.graph.edges[id=${e.id}]`, `${e.kind} edge must connect nodes on the same level (${a.level_id} -> ${b.level_id}); level changes require an explicit ramp, stairs or elevator edge`));
    }
    if (e.kind === "elevator" && (a.building_id === null || a.building_id !== b.building_id)) {
      errors.push(err("IMPOSSIBLE_LEVEL_TRANSITION", `$.graph.edges[id=${e.id}]`, `elevator must connect nodes of one building (got "${a.building_id}" -> "${b.building_id}")`));
    }
    if ((e.kind === "ramp" || e.kind === "stairs") && levelChange && (a.building_id === null || a.building_id !== b.building_id)) {
      errors.push(err("IMPOSSIBLE_LEVEL_TRANSITION", `$.graph.edges[id=${e.id}]`, `${e.kind} edge changing level must stay inside one building (got "${a.building_id}" -> "${b.building_id}")`));
    }
  }
  for (const f of ds.features.features) {
    for (const sid of f.properties.source_ids) {
      if (!sourceIds.has(sid)) {
        errors.push(err("UNKNOWN_SOURCE_REFERENCE", `$.features.features[id=${f.id}].properties.source_ids`, `references unknown source "${sid}"`));
      }
    }
  }
}
