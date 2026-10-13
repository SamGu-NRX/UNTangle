import { ValidationError } from "./errors";
import { Dataset } from "./model";
import { parseDataset } from "./parse";
import { validateDataset } from "./validate";

export function checkDataset(input: unknown): { errors: ValidationError[]; dataset: Dataset | null } {
  const { errors, dataset } = parseDataset(input);
  if (dataset === null) {
    return { errors, dataset: null };
  }
  const semantic: ValidationError[] = [];
  validateDataset(dataset, semantic);
  if (semantic.length > 0) {
    return { errors: [...errors, ...semantic], dataset: null };
  }
  return { errors, dataset };
}
