# A failed background reload publishes the error match over the committed successful one

Client-only `@tanstack/solid-router` — no Start, no SSR, no server functions, no query client. A
route loads successfully, then a **background** `router.invalidate()` re-runs its loader, which
rejects. The committed successful match is replaced by an error match and the error component takes
over the page, which is the opposite of the stale-while-revalidate contract a background reload
advertises.

```sh
pnpm install
pnpm dev # http://localhost:5596
```

Press **fail the next load, then router.invalidate() (background)**. The button sets a flag that
makes the loader throw a plain `Error`, calls `router.invalidate()` **without `sync`**, waits for
the reload to settle, and prints the match snapshot before and after plus the rendered heading.

## What it shows

```
before:   {"routeId":"/","status":"success","invalid":false,"hasLoaderData":true,"isFetching":false}
after:    {"routeId":"/","status":"error","invalid":true,"hasLoaderData":true,"isFetching":false,"error":"loader failed"}
rendered: ERROR COMPONENT: loader failed
```

Both halves matter:

- **State** — the leaf goes `status: 'error'` while still holding the `loaderData` its page was
  rendering from. Nothing was lost; it was replaced.
- **UI** — the route's `errorComponent` renders in place of its `component`, so a reader watching
  the page sees it swapped out for an error screen while a background refresh they never asked for
  is in flight.

The console also carries `Warning: Error in route match: /` from the router itself.

`defaultStaleReloadMode: 'background'` is set explicitly rather than left to the default, so there
is no question about which mode is under test. `defaultStaleTime: 0` mirrors the app this was found
in; it is not what makes the invalidated match re-run — router-core's reload predicate is
`match.invalid || …`, so an explicit `invalidate()` re-runs the loader whatever the stale age says.

## The wait is a settlement check, not a sleep

It has to be, in both directions. `invalidate()` resolves before a background reload finishes — that
is what makes it background — so the promise cannot be the signal; and on a FIXED router the status
would stay `success`, so the status cannot be the signal either. The harness waits for the loader to
have re-run (a counter it bumps before it decides to throw) and then for the router to have stopped
fetching, each bounded by a timeout that reports `INCONCLUSIVE` rather than a verdict measured too
early. Unchanged at 1x, 6x and 20x CPU throttling.

## Why a plain loader rejection

To isolate `runBackground()`. This was found in a Start app where the same failure arrives as a lost
`fetch` during a refresh nobody asked for, but the transport is incidental: a loader that rejects
for any reason takes the page down the same path. A transport-level, server-function, SSR or query
integration reproduction is straightforward to add on top of this if that would help.

## Versions

The same result on each of these, so there is nothing to upgrade into:

- `@tanstack/solid-router` 2.0.0-rc.4 / `@tanstack/router-core` 1.171.22 (what the lockfile pins)
- `@tanstack/solid-router` 2.0.0-rc.5 / `@tanstack/router-core` 1.171.22 (what rc.5 resolves)
- `@tanstack/solid-router` 2.0.0-rc.5 / `@tanstack/router-core` 1.171.27, forced through a pnpm
  override — rc.5 depends on 1.171.22, so the newest router-core has to be asked for
