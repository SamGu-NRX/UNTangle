/**
 * The offline campus walkway graph, built once at first use from the
 * committed OpenStreetMap dataset (data/campus-map.json). No network calls.
 *
 * Committed datasets use directed campus-map-v0 edges. Routing is
 * A* with a straight-line heuristic on haversine edge lengths. Snapping uses
 * the largest weakly connected component; a directed route can still fail.
 *
 * createDatasetGraph validates any campus-map-v0 dataset. The legacy
 * WalkwaysFile input remains for regression fixtures; named exports bind UNT.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0 — see tools/campus-geodata/README.md.
 */
import datasetJson from "./data/campus-map.json";
import { checkDataset } from "./contract/check";
import type { Dataset } from "./contract/model";
import { haversineMeters, type LatLng } from "./geo";
import { SNAP_MAX_METERS, STEPS_SPEED_MPS, WALKING_SPEED_MPS } from "./speeds";

export type WalkwayClass =
  | "crossing"
  | "sidewalk"
  | "footway"
  | "steps"
  | "path"
  | "pedestrian"
  | "corridor"
  | "living_street"
  | "service"
  | "residential"
  | "unclassified"
  | "tertiary"
  | "secondary"
  | "primary"
  | "tertiary_link"
  | "secondary_link"
  | "primary_link"
  | "track"
  | "road";

export type WalkwaysFile = {
  meta: {
    attribution: string;
    source: string;
    license: string;
    bbox: { south: number; west: number; north: number; east: number };
    fetchedAt: string | null;
    nodeCount: number;
    wayCount: number;
    edgeCount: number;
    classes: WalkwayClass[];
    generatedBy: string;
    wayFilter: string;
  };
  nodes: [number, number][];
  ways: { i: number; c: number; n: number[] }[];
};

type Edge = {
  to: number;
  meters: number;
  steps: boolean;
  crossing: boolean;
};

type UndirectedEdge = {
  from: number;
  to: number;
  meters: number;
  steps: boolean;
  crossing: boolean;
};

export type CampusRouteGeometry = {
  geometry: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  networkDistanceMeters: number;
  connectorDistanceMeters: number;
  stepsMeters: number;
  roadCrossings: number;
  snapStart: LatLng;
  snapEnd: LatLng;
};

export type GraphRoute = {
  nodePath: number[];
  networkMeters: number;
  durationSeconds: number;
  stepsMeters: number;
  roadCrossings: number;
};

/** Minimal binary min-heap for A*. */
class MinHeap {
  private items: { index: number; priority: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(index: number, priority: number): void {
    this.items.push({ index, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop(): { index: number; priority: number } | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left;
        if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/** A router over one campus's walkways file. The graph is built on first use. */
type RoutingMetadata = Pick<WalkwaysFile["meta"], "attribution" | "fetchedAt" | "edgeCount" | "classes">;

export function createWalkwayGraph(input: WalkwaysFile | (Dataset & { walking: RoutingMetadata })) {
  const dataset = "schema_version" in input ? input : null;
  const data: {meta: RoutingMetadata;nodes:WalkwaysFile["nodes"];ways:WalkwaysFile["ways"]} =
    "schema_version" in input
      ? {
          meta: input.walking,
          nodes: input.graph.nodes.map((n) => [n.position[1], n.position[0]]),
          ways: [],
        }
      : input;
  let adjacency: Edge[][] | null = null;
  let largestComponentNodes: number[] | null = null;
  let componentShare = 0;
  let heuristicScale = 1;

  function buildGraph() {
    if (adjacency && largestComponentNodes) return;

    const nodeCount = data.nodes.length;
    const adj: Edge[][] = new Array(nodeCount);
    for (let i = 0; i < nodeCount; i += 1) adj[i] = [];

    // Deduplicate undirected edges: when two mapped ways share a node pair,
    // keep the shortest one (with its class flags).
    const bestEdge = new Map<number, UndirectedEdge>();
    for (const way of data.ways) {
      const isSteps = data.meta.classes[way.c] === "steps";
      const isCrossing = data.meta.classes[way.c] === "crossing";
      for (let i = 0; i < way.n.length - 1; i += 1) {
        const a = way.n[i];
        const b = way.n[i + 1];
        if (a === b) continue;
        const [aLat, aLng] = data.nodes[a];
        const [bLat, bLng] = data.nodes[b];
        const meters = haversineMeters(aLat, aLng, bLat, bLng);
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const key = lo * nodeCount + hi;
        const existing = bestEdge.get(key);
        if (!existing || meters < existing.meters) {
          bestEdge.set(key, { from: a, to: b, meters, steps: isSteps, crossing: isCrossing });
        }
      }
    }
    if (dataset) {
      const indices = new Map(dataset.graph.nodes.map((n, i) => [n.id, i]));
      const features = new Map(dataset.features.features.map((f) => [f.id, f]));
      for (const edge of dataset.graph.edges) {
        if (edge.access === "restricted") continue;
        const from = indices.get(edge.from),
          to = indices.get(edge.to);
        if (from === undefined || to === undefined) throw new Error(`Broken routing edge ${edge.id}`);
        const steps = edge.kind === "stairs";
        const crossing = features.get(edge.feature_id)?.properties.crossing === true;
        // Contract lengths can be shorter than the geographic chord. Scale
        // the heuristic by the smallest ratio so it never overestimates.
        const chord = haversineMeters(...data.nodes[from], ...data.nodes[to]);
        if (chord > 0) heuristicScale = Math.min(heuristicScale, edge.length_m / chord);
        const key = from * nodeCount + to;
        const existing = bestEdge.get(key);
        if (existing && existing.meters <= edge.length_m) continue;
        bestEdge.set(key, {
          from,
          to,
          meters: edge.length_m,
          steps,
          crossing,
        });
      }
      // Both search and reconstruction use the shortest directed parallel edge.
      for (const edge of bestEdge.values()) {
        adj[edge.from].push({ to: edge.to, meters: edge.meters, steps: edge.steps, crossing: edge.crossing });
      }
    } else {
      for (const edge of bestEdge.values()) {
        adj[edge.from].push({ to: edge.to, meters: edge.meters, steps: edge.steps, crossing: edge.crossing });
        adj[edge.to].push({ to: edge.from, meters: edge.meters, steps: edge.steps, crossing: edge.crossing });
      }
    }

    // Union-find over edges to find the largest connected component.
    const parent = new Int32Array(nodeCount);
    for (let i = 0; i < nodeCount; i += 1) parent[i] = i;
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    for (const edge of bestEdge.values()) {
      const ra = find(edge.from);
      const rb = find(edge.to);
      if (ra !== rb) parent[ra] = rb;
    }
    const size = new Map<number, number>();
    for (let i = 0; i < nodeCount; i += 1) {
      const root = find(i);
      size.set(root, (size.get(root) ?? 0) + 1);
    }
    let largestRoot = 0;
    let largestSize = 0;
    for (const [root, count] of size) {
      if (count > largestSize) {
        largestSize = count;
        largestRoot = root;
      }
    }
    const nodes: number[] = [];
    for (let i = 0; i < nodeCount; i += 1) {
      if (find(i) === largestRoot) nodes.push(i);
    }

    adjacency = adj;
    largestComponentNodes = nodes;
    componentShare = nodeCount === 0 ? 0 : largestSize / nodeCount;
  }

  /**
   * Nearest walkway node to a point, searching only the largest connected
   * component, or null when nothing is within `maxMeters` (default 250 m —
   * the same cap as evals/fixtures/METHOD.md).
   */
  function nearestWalkwayNode(point: LatLng, maxMeters: number = SNAP_MAX_METERS): number | null {
    buildGraph();
    let bestIndex: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const index of largestComponentNodes!) {
      const [lat, lng] = data.nodes[index];
      const d = haversineMeters(point.lat, point.lng, lat, lng);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = index;
      }
    }
    if (bestIndex === null || bestDistance > maxMeters) return null;
    return bestIndex;
  }

  /**
   * A* from node to node over the walkway graph with an admissible haversine
   * heuristic. Returns the node path (inclusive) or null when no path exists.
   */
  function astarPath(start: number, goal: number): number[] | null {
    buildGraph();
    const nodeCount = data.nodes.length;
    const [goalLat, goalLng] = data.nodes[goal];
    const gScore = new Float64Array(nodeCount).fill(Number.POSITIVE_INFINITY);
    const cameFrom = new Int32Array(nodeCount).fill(-1);
    const closed = new Uint8Array(nodeCount);
    const heap = new MinHeap();
    const h = (index: number): number => {
      const [lat, lng] = data.nodes[index];
      return haversineMeters(lat, lng, goalLat, goalLng) * heuristicScale;
    };
    gScore[start] = 0;
    heap.push(start, h(start));
    while (heap.size > 0) {
      const current = heap.pop()!;
      if (current.index === goal) break;
      if (closed[current.index]) continue;
      closed[current.index] = 1;
      for (const edge of adjacency![current.index]) {
        if (closed[edge.to]) continue;
        const tentative = gScore[current.index] + edge.meters;
        if (tentative < gScore[edge.to]) {
          gScore[edge.to] = tentative;
          cameFrom[edge.to] = current.index;
          heap.push(edge.to, tentative + h(edge.to));
        }
      }
    }
    if (gScore[goal] === Number.POSITIVE_INFINITY) return null;
    const path: number[] = [];
    for (let at = goal; at !== -1; at = cameFrom[at]) {
      path.push(at);
      if (at === start) break;
    }
    path.reverse();
    return path[0] === start ? path : null;
  }

  /** Shortest walkway path between two graph nodes, with distance and time. */
  function routeBetweenNodes(start: number, goal: number): GraphRoute | null {
    const path = astarPath(start, goal);
    if (!path) return null;
    let meters = 0;
    let seconds = 0;
    let stepsMeters = 0;
    let crossings = 0;
    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      const edge = adjacency![a].find((candidate) => candidate.to === b);
      if (!edge) return null;
      meters += edge.meters;
      seconds += edge.meters / (edge.steps ? STEPS_SPEED_MPS : WALKING_SPEED_MPS);
      if (edge.steps) stepsMeters += edge.meters;
      if (edge.crossing) crossings += 1;
    }
    return {
      nodePath: path,
      networkMeters: meters,
      durationSeconds: seconds,
      stepsMeters,
      roadCrossings: crossings,
    };
  }

  /**
   * Full route between two arbitrary in-bounds points: each point snaps to the
   * nearest walkway node (250 m cap), and the straight connector on both ends
   * is included in the distance and the time.
   */
  function routeBetweenPoints(a: LatLng, b: LatLng): CampusRouteGeometry | null {
    buildGraph();
    const startNode = nearestWalkwayNode(a);
    const endNode = nearestWalkwayNode(b);
    if (startNode === null || endNode === null) return null;
    const route = routeBetweenNodes(startNode, endNode);
    if (!route) return null;

    const [startLat, startLng] = data.nodes[startNode];
    const [endLat, endLng] = data.nodes[endNode];
    const snapStart: LatLng = { lat: startLat, lng: startLng };
    const snapEnd: LatLng = { lat: endLat, lng: endLng };
    const connectorStart = haversineMeters(a.lat, a.lng, startLat, startLng);
    const connectorEnd = haversineMeters(b.lat, b.lng, endLat, endLng);
    const connectorMeters = connectorStart + connectorEnd;
    const connectorSeconds = (connectorStart + connectorEnd) / WALKING_SPEED_MPS;

    const geometry: LatLng[] = [a, snapStart];
    for (let i = 1; i < route.nodePath.length - 1; i += 1) {
      const [lat, lng] = data.nodes[route.nodePath[i]];
      geometry.push({ lat, lng });
    }
    geometry.push(snapEnd, b);

    return {
      geometry,
      // Tenths, rounded with toFixed like the matrix's meters.
      distanceMeters: Number((route.networkMeters + connectorMeters).toFixed(1)),
      // Tenths of a second, rounded as build-matrix.ts stores the matrix, so a
      // route between two anchors has exactly the matrix's seconds. Rounding
      // to whole seconds here used to flip minutes (CHEM to ENV: 2 vs 3).
      durationSeconds: Number((route.durationSeconds + connectorSeconds).toFixed(1)),
      networkDistanceMeters: Math.round(route.networkMeters * 10) / 10,
      connectorDistanceMeters: Math.round(connectorMeters * 10) / 10,
      stepsMeters: Math.round(route.stepsMeters * 10) / 10,
      roadCrossings: route.roadCrossings,
      snapStart,
      snapEnd,
    };
  }

  /** Connectivity statistics for verification (largest component share). */
  function walkwayGraphStats(): {
    nodeCount: number;
    edgeCount: number;
    largestComponentShare: number;
    attribution: string;
    fetchedAt: string | null;
  } {
    buildGraph();
    return {
      nodeCount: data.nodes.length,
      edgeCount: data.meta.edgeCount,
      largestComponentShare: componentShare,
      attribution: data.meta.attribution,
      fetchedAt: data.meta.fetchedAt,
    };
  }

  return { nearestWalkwayNode, astarPath, routeBetweenNodes, routeBetweenPoints, walkwayGraphStats };
}

export type WalkwayGraph = ReturnType<typeof createWalkwayGraph>;

export function createDatasetGraph(input: unknown): WalkwayGraph {
  const checked = checkDataset(input);
  if (!checked.dataset) throw new Error(`Invalid campus-map-v0: ${JSON.stringify(checked.errors)}`);
  const dataset = checked.dataset;
  return createWalkwayGraph({
    ...dataset,
    walking: {
      attribution: "© OpenStreetMap contributors (data: ODbL 1.0)",
      fetchedAt: dataset.sources[0]?.retrieved_at ?? null,
      edgeCount: dataset.graph.edges.length,
      classes: [],
    },
  });
}

const untDentonGraph = createDatasetGraph(datasetJson);

export const { nearestWalkwayNode, astarPath, routeBetweenNodes, routeBetweenPoints, walkwayGraphStats } =
  untDentonGraph;
