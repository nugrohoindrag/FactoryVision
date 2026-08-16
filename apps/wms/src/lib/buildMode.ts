/**
 * Is this an INTERNAL build?
 *
 * Not the same question as "is this a development server". The Sprint 1 field
 * test happens on real phones in real warehouses, running an installed PWA —
 * a production build in every technical sense. The timing instrument (T-025)
 * and the temporary role picker (T-020) have to be present there, or the
 * measurement that Gate S1 depends on cannot be taken where it matters.
 *
 * Built with `--mode demo` (VITE_DEMO=1) or run from the dev server.
 * A customer build sets neither, and the internal affordances disappear.
 */
export const isInternalBuild: boolean =
  import.meta.env.DEV || import.meta.env.VITE_DEMO === '1';
