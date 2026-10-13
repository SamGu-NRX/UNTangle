export type ValidationCode =
  | "INVALID_SCHEMA_VERSION"
  | "MISSING_FIELD"
  | "INVALID_TYPE"
  | "INVALID_COORDINATE"
  | "INVALID_GEOMETRY"
  | "INVALID_TIMESTAMP"
  | "INVALID_ENUM"
  | "NONFINITE_MEASUREMENT"
  | "NEGATIVE_LENGTH"
  | "DUPLICATE_ID"
  | "BROKEN_REFERENCE"
  | "UNKNOWN_SOURCE_REFERENCE"
  | "IMPOSSIBLE_LEVEL_TRANSITION"
  | "INDOOR_NODE_MISSING_BUILDING"
  | "OUTDOOR_NODE_WITH_BUILDING"
  | "SELF_LOOP";

export interface ValidationError {
  code: ValidationCode;
  path: string;
  message: string;
}

export function err(code: ValidationCode, path: string, message: string): ValidationError {
  return { code, path, message };
}
