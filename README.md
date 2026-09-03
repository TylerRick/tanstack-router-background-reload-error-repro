# A failed background reload publishes the error match over the committed successful one

Client-only `@tanstack/solid-router` app — no Start, no SSR, no server functions, no query client. A
route loads successfully, then a **background** `router.invalidate()` re-runs its loader, which
rejects. The committed successful match is replaced by an error match and the error component takes
over the page, which is the opposite of the stale-while-revalidate contract a background reload
advertises.

Written for
[../../failed_background_reload_publishes_error_match.md](../../failed_background_reload_publishes_error_match.md),
where the app-side symptom (a `500 — Internal Error` tab-title flash on a staging reload) and the
`runBackground()` reading are recorded.

```sh
pnpm install
npx vite dev # http://localhost:5596
```

Press **fail the next load, then router.invalidate() (background)**. The button sets a flag that
makes the loader throw a plain `Error`, calls `router.invalidate()` **without `sync`**, waits for
the reload to settle, and prints the match snapshot before and after plus the rendered heading.

The wait is a settlement check, not a sleep, and that matters in both directions. `invalidate()`
resolves before a background reload finishes — that is what makes it background — so the promise
cannot be the signal; and on a FIXED router the status would stay `success`, so the status cannot be
the signal either. The harness waits for the loader to have re-run (a counter it bumps before it
decides to throw) and then for the router to have stopped fetching, each bounded by a timeout that
reports `INCONCLUSIVE` rather than a verdict measured too early. Verified unchanged at 1x, 6x and
20x CPU throttling.

## What it shows

Measured 2026-09-03 on `@tanstack/solid-router` 2.0.0-rc.4 / `@tanstack/router-core` 1.171.22 (the
versions the app pins) and again on 2.0.0-rc.5 / 1.171.27 (the newest published of each) —
identical:

```
before:   [{"routeId":"__root__","status":"success",…},
           {"routeId":"/","status":"success","invalid":false,"hasLoaderData":true}]
after:    [{"routeId":"__root__","status":"success",…},
           {"routeId":"/","status":"error","invalid":true,"hasLoaderData":true,"error":"loader failed"}]
rendered: ERROR COMPONENT: loader failed
```

Both halves matter:

- **State** — the leaf goes `status: 'error'` while still holding the `loaderData` its page was
  rendering from. Nothing was lost; it was replaced.
- **UI** — the route's `errorComponent` renders in place of its `component`, so a reader watching
  the page sees it swapped out for an error screen while a background refresh they never asked for
  is in flight.

`defaultStaleReloadMode: 'background'` is set explicitly rather than left to the default, so there
is no question about which mode is under test. `defaultStaleTime: 0` makes the invalidated match
actually re-run.

## Publishing it as the reproducer repo

TanStack's bug template requires a reproducer that runs straight after clone + install, so this gets
copied out and pushed public before filing (the convention is in
[../../Readme.md](../Readme.md#conventions)):

```sh
# Tracked files only — `cp -r .` would drag node_modules/ along, and this project's own
# .gitignore (node_modules/, dist/) is the only ignore file that survives the copy. mktemp,
# not a fixed path: a directory left over from a previous attempt would be published too.
repro_dir=$(mktemp -d /tmp/tanstack-router-background-reload-error-repro.XXXXXX)
git archive HEAD:docs/upstream_issues/repros/background_reload_publishes_error \
	| tar -x -C "$repro_dir"
cd "$repro_dir"
pnpm install # generates the lockfile the public repo carries
git init && git add -A && git commit -m "repro: a failed background reload publishes the error match"
gh repo create tanstack-router-background-reload-error-repro --public --source=. --push
```

The lockfile is deliberately absent HERE — [.gitignore](../../../../.gitignore) excludes
`docs/upstream_issues/repros/*/pnpm-lock.yaml` for every repro in this directory — and present
THERE, so a maintainer's clean clone installs exactly what was measured. Prove it reproduces from
that clean clone, not from this directory.

## Why a plain loader rejection

To isolate `runBackground()`. In the app the same failure arrives as a lost `fetch` (a reset
connection during an SSE-reconnect refresh), but the transport is incidental: a loader that rejects
for any reason takes the page down the same path. A transport-level, server-function, SSR or query
integration reproduction is straightforward to add on top of this if maintainers ask for one.
