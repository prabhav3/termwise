// Mutations that change planner inputs (items, courses, weights, readings, term events,
// planner settings) announce it here; src/lib/planner.ts listens and replans (debounced).
// A tiny pub/sub keeps the data layer free of an import cycle with the planner.

type Listener = () => void;

const listeners = new Set<Listener>();

export function notifyPlanInputsChanged(): void {
  for (const listener of listeners) listener();
}

export function onPlanInputsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
