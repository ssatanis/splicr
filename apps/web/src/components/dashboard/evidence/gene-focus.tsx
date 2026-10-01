"use client";

/**
 * One focused gene, shared by the plot and the table on a screen page.
 *
 * A reader who opens PARG in the table wants to know where PARG sits in the
 * cloud, and a reader who finds a dot wants its row. Two components each
 * holding their own idea of "the gene I am looking at" is how a page ends up
 * showing two different answers, so there is one value and both read it.
 *
 * It is deliberately not in the address. Expanding a row is not navigation, and
 * routing every expansion through the server would make a click cost a request
 * to re-read a twenty thousand row run. The plot's own search box, which is a
 * view a reader might send to a colleague, writes to the address instead.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface GeneFocus {
  /** Upper-cased symbol, or null when nothing is focused. */
  gene: string | null;
  focus: (gene: string | null) => void;
}

const Context = createContext<GeneFocus>({ gene: null, focus: () => {} });

export function GeneFocusProvider({ children }: { children: ReactNode }) {
  const [gene, setGene] = useState<string | null>(null);
  const focus = useCallback((next: string | null) => {
    setGene(next === null ? null : next.trim().toUpperCase() || null);
  }, []);
  const value = useMemo(() => ({ gene, focus }), [gene, focus]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useGeneFocus(): GeneFocus {
  return useContext(Context);
}
