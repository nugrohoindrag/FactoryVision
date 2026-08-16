import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_TERMS, type TermKey, type TermOverrides } from './dictionary';

/**
 * Terminology layer (Tech Stack §2.6, PRD §9.2).
 *
 * Deliberately NOT i18next: we have one language and need per-tenant
 * overrides, not multi-language. A dictionary plus this hook covers §9.2
 * today, without waiting for Phase 2.
 *
 * Definition of Done §22.9: no user-facing label is written directly in JSX.
 */

interface TermContextValue {
  overrides: TermOverrides;
}

const TermContext = createContext<TermContextValue>({ overrides: {} });

export function TermProvider({
  overrides = {},
  children,
}: {
  overrides?: TermOverrides;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ overrides }), [overrides]);
  return <TermContext.Provider value={value}>{children}</TermContext.Provider>;
}

/**
 * `const t = useTerm(); t('material_issue')` → "Material Issue", or whatever
 * this tenant calls it.
 */
export function useTerm() {
  const { overrides } = useContext(TermContext);
  return useCallback(
    (key: TermKey): string => overrides[key] ?? DEFAULT_TERMS[key],
    [overrides],
  );
}

/** Non-hook access, for code outside the React tree (toasts, notifications). */
export function term(key: TermKey, overrides: TermOverrides = {}): string {
  return overrides[key] ?? DEFAULT_TERMS[key];
}

export type { TermKey, TermOverrides };
