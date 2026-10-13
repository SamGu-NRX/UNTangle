const directionKeys = ["oneway", "oneway:foot", "foot:forward", "foot:backward", "access:forward", "access:backward"];
const allowedAccess = new Set(["yes", "designated", "permissive"]);
const deniedAccess = new Set(["no", "private"]);

/**
 * Explicit pedestrian restrictions, relative to the OSM way's node order.
 * @param {Record<string, string>} tags
 * @param {number} wayId
 */
export function pedestrianDirections(tags, wayId) {
  const source = Object.fromEntries(directionKeys.filter(key => tags[key] !== undefined).map(key => [key, tags[key]]));
  for (const key of Object.keys(tags)) {
    if (/^(?:foot:conditional|access:conditional)(?::|$)/.test(key) || /^(oneway:foot|foot:(forward|backward)|access:(forward|backward)):/.test(key)) {
      throw new Error(`OSM way ${wayId}: unsupported pedestrian direction tag ${key}=${tags[key]}`);
    }
  }
  const oneway = tags["oneway:foot"];
  let forward = true;
  let backward = true;
  if (["yes", "1", "true"].includes(oneway)) backward = false;
  else if (oneway === "-1") forward = false;
  else if (oneway !== undefined && !["no", "0", "false"].includes(oneway)) {
    throw new Error(`OSM way ${wayId}: unsupported oneway:foot=${oneway}`);
  }
  /** @param {"forward" | "backward"} direction */
  const directionAllowed = direction => {
    for (const key of [`foot:${direction}`, `access:${direction}`]) {
      const value = tags[key];
      if (value !== undefined && !allowedAccess.has(value) && !deniedAccess.has(value)) {
        throw new Error(`OSM way ${wayId}: unsupported ${key}=${value}`);
      }
    }
    const foot = tags[`foot:${direction}`] ?? tags.foot;
    const access = tags[`access:${direction}`] ?? tags.access;
    if (deniedAccess.has(foot)) return false;
    if (allowedAccess.has(foot)) return true;
    return !deniedAccess.has(access);
  };
  const forwardAccess = directionAllowed("forward");
  const backwardAccess = directionAllowed("backward");
  return { forward: forward && forwardAccess, backward: backward && backwardAccess, tags: source };
}
