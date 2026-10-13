export const EVIDENCE_VALUES = ["source", "field_verified", "synthetic", "unknown"] as const;
export type Evidence = (typeof EVIDENCE_VALUES)[number];

export const EDGE_KINDS = ["path", "door", "ramp", "stairs", "elevator"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const ACCESS_VALUES = ["allowed", "restricted", "unknown"] as const;
export type Access = (typeof ACCESS_VALUES)[number];

export const OUTDOOR_LEVEL_ID = "outdoor";
export const SCHEMA_VERSION = "0.1";

export interface SourceRecord {
  id: string;
  url: string;
  license: string | null;
  retrieved_at: string | null;
  notes: string;
}

export interface FeatureProperties {
  kind: string;
  name: string | null;
  source_ids: string[];
  observed_at: string | null;
  evidence: Evidence;
  [key: string]: unknown;
}

export type Position = [number, number];

// MultiLineString carries a way whose member nodes are partly missing from the
// extract: each line is one unbroken run of known members, so no segment is
// drawn across a gap.
export type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] };

export interface MapFeature {
  type: "Feature";
  id: string;
  properties: FeatureProperties;
  geometry: Geometry | null;
}

export interface GraphNode {
  id: string;
  feature_id: string;
  position: Position;
  building_id: string | null;
  level_id: string;
}

export interface GraphEdge {
  id: string;
  feature_id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  length_m: number;
  width_m: number | null;
  slope: number | null;
  cross_slope: number | null;
  step_height_m: number | null;
  surface: string | null;
  access: Access;
  evidence: Evidence;
  observed_at: string | null;
}

export interface Dataset {
  schema_version: "0.1";
  dataset_id: string;
  revision: string;
  demo: boolean;
  sources: SourceRecord[];
  features: { type: "FeatureCollection"; features: MapFeature[] };
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
}
