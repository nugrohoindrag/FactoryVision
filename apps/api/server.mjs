/**
 * Production entry point — the file a host is pointed at.
 *
 * Why this exists instead of `node dist/src/main.js`:
 *
 * `tsc --outDir dist` compiles this app's own source, but it does not rewrite
 * the bare specifiers it emits. `import { uuidv7 } from '@fv/contracts'` stays
 * exactly that, and `@fv/contracts` publishes TypeScript — its `exports` field
 * points at `./src/index.ts`, because every consumer until now compiled TS
 * itself. Plain Node reaches that file and stops with
 * `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".ts"`, after a build that
 * reported success.
 *
 * So the compiled output is a typecheck artefact, not something runnable, and
 * this boots the way `dev` and `start` already do: through tsx, which resolves
 * and transpiles the workspace sources on the way in.
 *
 * The cost is a second or two of transpilation at start-up and tsx in the
 * production dependencies. The alternative — making `@fv/contracts` and
 * `@fv/domain` emit JavaScript and pointing their `exports` at it — is the
 * better long-term answer and belongs with the VPS move, alongside the return
 * to PostgreSQL. It changes how the client consumes them too, which is not a
 * change to make while the deploy is the thing being debugged.
 *
 * Decorator metadata is not a concern here: `app.module.ts` registers
 * everything by explicit token, which is why tsx has always been able to run
 * this app at all.
 */

import { fileURLToPath } from 'node:url';

/**
 * Point tsx at THIS package's tsconfig, not at whatever it finds beside the
 * working directory.
 *
 * NestJS is built on parameter decorators, and `experimentalDecorators` lives
 * in `apps/api/tsconfig.json` — not in the root config. A host that starts the
 * app from the repository root leaves tsx looking at the root, and every
 * controller fails to transpile with `Parameter decorators only work when
 * experimental decorators are enabled`. Resolving from `import.meta.url` makes
 * the choice independent of where the process was launched.
 */
process.env.TSX_TSCONFIG_PATH ??= fileURLToPath(new URL('./tsconfig.json', import.meta.url));

const { register } = await import('tsx/esm/api');
register();

await import('./src/main.ts');
