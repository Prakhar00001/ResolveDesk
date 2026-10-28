# Product observations from live Chromium E2E

The original live Chromium functional suite uses no network mocks. The two
product defects below have since been fixed in `src`; the original observations
are retained alongside the verification scope. The initial focused browser checks
used intercepted API fixtures. Both fixes have now also passed the full live
backend/frontend suite without interception, including the new overflow assertions
and synchronous rapid-filter regression.

## Resolved: dashboard document overflows at 768px

### Original live-browser observation

- Open `/tickets` with seeded tickets at viewport **768x1024**.
- Observed `window.innerWidth === 768`, but
  `document.documentElement.scrollWidth === 885`: **117px of document-level
  horizontal overflow**, in addition to the expected inbox table scroll area.
- The inbox table is 900px wide, with its right bound at 933px. Its scroll
  container was intended to clip it. The original observation did not yet
  establish the source; the subsequent root-cause finding is documented below.
- Conversation and history pages measured 768px document width at the same
  viewport. All three measured 1440px document width at 1440x1000.
- Evidence is in `test-results/` under the lifecycle test's
  `dashboard-768x1024.png` and `dashboard-768-layout.json` artifacts. Widths are
  recorded on every run; screenshots alone do not expose offscreen page width.

### Fix and verified result

- Root cause reproduced in Chromium: the `sr-only` span in the last table header
  was absolutely positioned relative to a containing block outside the table's
  unpositioned scroll container. Its right edge was **885px**, matching the
  document overflow. The visible 900px table itself was already inside the
  intended scroll area.
- `src/components/TicketTable.tsx` now gives that scroll container `relative
  min-w-0`, containing the absolutely positioned accessible labels without
  hiding overflow on the document or removing table accessibility.
- A focused Chromium check with one API-fixture ticket measured
  `document.documentElement.scrollWidth === window.innerWidth === 768` at
  **768x1024**. The 900px table retained a **702px** scroll viewport and scrolled
  horizontally to `scrollLeft === 198`.
- At **1440x1024**, document width remained **1440px** and table scrolling was
  unnecessary. These were the initial focused measurements, not a full live run.
- The extended live suite now asserts document width for dashboard, conversation
  and history screenshots at **1440x1000** and **768x1024**. All six passed, with
  document widths exactly **1440px** and **768px** respectively. The dashboard's
  internal table remains 900px wide at the narrower viewport without increasing
  document width. Current screenshot/layout artifacts replace the original
  overflowing captures.

## Resolved: successive filter changes can lose earlier selections

### Original live-browser observation

In multiple fast browser runs, changing search/status/priority/assignee in
succession dropped a previous filter. One run lost `priority=High` when setting
assignee, leaving three filters and admitting the Low-priority decoy. Another
lost the search term when selecting Priority sort, which became visible after
reload. Merely waiting for the browser URL to contain each new parameter did
not consistently prevent this: the URL can update before the controlled filter
UI has committed that navigation.

The original functional test waited for each expected active-filter summary to
render before the next interaction, validating settled AND behavior and URL
persistence. That scenario remains, but it is no longer the only coverage: the
new live rapid-change step described below does not wait between input events.
The original race was not claimed to reproduce at ordinary human interaction speed.

### Fix and verified result

- `src/pages/TicketDashboardPage.tsx` now merges filter changes against a
  synchronously advanced pending-params ref instead of a router callback's stale
  snapshot. A layout effect synchronizes it with committed URL parameters,
  including back/forward navigation. Both reset actions and summary cards update
  the same merge base; search retains replace-history behavior.
- `src/App.test.tsx` adds three regressions: batched search/status/priority/
  assignee/sort changes before a router commit; reset/summary followed immediately
  by another selection; and back/forward/reset/clear-search followed by edits.
  The rapid-change regression failed before the fix (search was lost) and passed
  afterward.
- A focused Chromium check with intercepted API responses also passed rapid
  status/priority/assignee/sort changes following search. The URL and outgoing API
  query retained all five values. Reload, reset, browser back, and an additional
  selection after back preserved the expected filters.
- Validation after the changes: `npm run typecheck`, `npm run build`, and
  `npm test -- --reporter=dot` all passed (**31 unit tests**, three files).
- Those product fixes changed source/unit tests under `src` and this document.
  The subsequent E2E-only extension did not edit product source.
- `e2e/rapid-filters.ts`, invoked as a named step in the existing filter test,
  dispatches search input, status, priority, assignee and sort changes in one
  synchronous `page.evaluate` call. The real API query retained all five values,
  and its exact results excluded each one-field-mismatch decoy. Controls and URL
  parameters survived reload, reset plus immediate edits, back/forward, further
  rapid edits after Back, and reset/Back restoration.
- The input value is changed using the native prototype setter before dispatching
  an `input` event. The reset batch uses a case-changed search term so React's
  tracker sees an actual value change rather than ignoring a duplicate event.
  No sleeps, network interception or product implementation calls are used.

## Current validation

- `npm run typecheck:e2e`: passed with strict `tsconfig.e2e.json` and `@types/node`.
- `npm run build`: passed.
- `npm test`: **31 passed** across three files.
- `npm run test:e2e -- --reporter=list`: **3 passed**, including both settled
  and synchronous rapid-filter scenarios; complete suite exited successfully.
- `npm audit`: **0 vulnerabilities**.
- After the completed live run, the isolated runtime directory was empty and
  ports 5173/8000 were closed. No product source was edited by the E2E extension.

## Harness/environment issues, not product defects

- Backend Python selection now uses `Scripts/python.exe` on Windows and
  `bin/python` elsewhere, with an optional literal `E2E_PYTHON` executable path.
  Windows execution is verified; the non-Windows branch has not run locally.
- Browser download/extraction exceeded 120 seconds on the first attempts;
  Chromium and its headless shell were ultimately installed successfully.
- Initial traced full-suite runs exceeded the suite/terminal deadlines. Tracing
  is now opt-in. Forced runner termination bypassed graceful teardown, so the
  isolated leftovers from those attempts were explicitly removed after checking
  that no Python/browser processes remained. Normal completed runs clean up the
  database automatically, including runs with assertion failures.
- This 4 GB Windows machine was observed with about 450 MB free RAM during
  validation. Some full attempts hit the bounded 120-second command timeout;
  one HTML-report attempt printed `3 passed` before the outer timeout. The final
  list-reporter full run completed successfully. Chromium GPU use is disabled
  to reduce resource demand and browser launch has a 20-second timeout.
