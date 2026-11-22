import { useCallback, useReducer } from "react";
import type { Topology } from "@netsim/engine";

type State = { past: Topology[]; present: Topology; future: Topology[]; version: number };
type Action =
  | { type: "commit"; next: Topology }
  | { type: "preview"; next: Topology }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; next: Topology };

const LIMIT = 100;

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "commit":
      if (a.next === s.present) return s;
      return { past: [...s.past, s.present].slice(-LIMIT), present: a.next, future: [], version: s.version + 1 };
    case "preview":
      // Live change during a drag: shown, not yet in the undo history.
      return { ...s, present: a.next };
    case "undo": {
      const prev = s.past.at(-1);
      if (!prev) return s;
      return { past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future], version: s.version + 1 };
    }
    case "redo": {
      const next = s.future[0];
      if (!next) return s;
      return { past: [...s.past, s.present], present: next, future: s.future.slice(1), version: s.version + 1 };
    }
    case "reset":
      return { past: [], present: a.next, future: [], version: 0 };
  }
}

/** Topology state with undo/redo. `version` increases on every committed change (used for autosave). */
export function useTopologyHistory(initial: Topology) {
  const [state, dispatch] = useReducer(reducer, { past: [], present: initial, future: [], version: 0 });
  return {
    topology: state.present,
    version: state.version,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit: useCallback((next: Topology) => dispatch({ type: "commit", next }), []),
    preview: useCallback((next: Topology) => dispatch({ type: "preview", next }), []),
    /** Commits a previewed state: `base` is the state before the preview started. */
    commitFrom: useCallback((base: Topology, next: Topology) => {
      dispatch({ type: "preview", next: base });
      dispatch({ type: "commit", next });
    }, []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
    reset: useCallback((next: Topology) => dispatch({ type: "reset", next }), []),
  };
}
