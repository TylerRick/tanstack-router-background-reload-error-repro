import { createSignal } from 'solid-js';
import { render } from '@solidjs/web';
import {
	Outlet,
	RouterProvider,
	createRootRoute,
	createRoute,
	createRouter,
} from '@tanstack/solid-router';

// Repro state on globalThis, not module scope: the dev server instantiates a route module twice, so
// a module-scoped flag is written in one copy and read in the other — which reads convincingly as
// "the loader won't publish new data".
const state = ((globalThis as Record<string, unknown>).__repro ??= {
	value: 'FIRST',
	failNext: false,
	runs: 0,
}) as { value: string; failNext: boolean; runs: number };

// The controls live in the root component so the page under test and the harness share one tree.
// `router` is referenced only from callbacks, so declaring it below is fine.
function Harness() {
	const [log, setLog] = createSignal<Array<string>>([]);
	const [verdict, setVerdict] = createSignal('—');

	const snapshot = () =>
		router.stores.matches.get().map((match) => ({
			routeId: match.routeId,
			status: match.status,
			invalid: match.invalid,
			hasLoaderData: match.loaderData !== undefined,
			isFetching: match.isFetching,
			error: match.error instanceof Error ? match.error.message : undefined,
		}));

	const snapshotIsFetching = () => router.stores.matches.get().some((match) => match.isFetching);

	/** Poll until `done()`, or give up after `timeoutMs` and say so rather than reporting a verdict
	 * that was measured too early. */
	const until = async (label: string, done: () => boolean, timeoutMs = 5_000) => {
		const deadline = Date.now() + timeoutMs;
		while (!done()) {
			if (Date.now() > deadline) return `TIMED OUT waiting for ${label}`;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		return undefined;
	};

	const run = async () => {
		setLog([]);
		setVerdict('running…');
		setLog((lines) => [...lines, `before:   ${JSON.stringify(snapshot())}`]);

		// The loader succeeded once and its page is on screen. Now make the next read fail and ask
		// for a BACKGROUND reload — no `sync`, so this is stale-while-revalidate, not a barrier.
		const runsBefore = state.runs;
		state.failNext = true;
		state.value = 'SECOND';
		await router.invalidate();

		// Settlement, not a sleep. `invalidate()` resolves before a BACKGROUND reload finishes (that
		// is what makes it background), and a fixed router would leave the match `success`, so
		// neither the promise nor the status can be the signal. Wait for the loader to have re-run
		// and for the router to have stopped fetching — true on a router that publishes the failure
		// and on one that discards it alike.
		const timeout =
			(await until('the loader to re-run', () => state.runs > runsBefore)) ??
			(await until('the reload to settle', () => !snapshotIsFetching()));
		// One frame, so a publish that happens in an effect has landed in the DOM before the
		// rendered heading is read.
		await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

		const after = snapshot();
		const leaf = after.at(-1);
		const rendered = document.getElementById('rendered')?.textContent ?? '';
		setLog((lines) => [...lines, `after:    ${JSON.stringify(after)}`, `rendered: ${rendered}`]);
		if (timeout) {
			setLog((lines) => [...lines, timeout]);
			setVerdict(`INCONCLUSIVE — ${timeout}`);
			return;
		}
		setVerdict(
			leaf?.status === 'error' || rendered.startsWith('ERROR COMPONENT')
				? `REPLACED — leaf status ${String(leaf?.status)}, rendered "${rendered}"`
				: `RETAINED — leaf status ${String(leaf?.status)}, rendered "${rendered}"`,
		);
	};

	return (
		<div style={{ 'font-family': 'monospace' }}>
			<Outlet />
			<hr />
			<button id="run" onClick={() => void run()}>
				fail the next load, then router.invalidate() (background)
			</button>
			<p>
				verdict: <span id="verdict">{verdict()}</span>
			</p>
			<pre id="log">{log().join('\n')}</pre>
		</div>
	);
}

const rootRoute = createRootRoute({ component: Harness });

const dataRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/',
	loader: async () => {
		await new Promise((resolve) => setTimeout(resolve, 10));
		// Counted BEFORE the decision, so it counts runs that fail as well as runs that succeed:
		// the harness waits on this rather than on a timer.
		state.runs += 1;
		// A plain rejection, so nothing but the loader's own failure is in play: no transport, no
		// server functions, no SSR, no query client.
		if (state.failNext) throw new Error('loader failed');
		return { value: state.value };
	},
	errorComponent: (props) => (
		<h1 id="rendered">ERROR COMPONENT: {(props.error as Error).message}</h1>
	),
	component: () => {
		const data = dataRoute.useLoaderData();
		return <h1 id="rendered">PAGE: {data().value}</h1>;
	},
});

const router = createRouter({
	routeTree: rootRoute.addChildren([dataRoute]),
	// Mirrors the app this was found in. It is NOT what makes the invalidated match re-run below —
	// router-core's reload predicate is `match.invalid || …`, so an explicit invalidate() re-runs the
	// loader whatever the stale age says.
	defaultStaleTime: 0,
	// The mode under test, set explicitly rather than left to the default so the intent is
	// unambiguous.
	defaultStaleReloadMode: 'background',
});

render(() => <RouterProvider router={router} />, document.getElementById('root'));
