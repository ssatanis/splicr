# Analysis wizard verification — October 6, 2026

Production: https://www.splicr.org/dashboard/new
Deployment: dpl_GwW6dGieNvV1FE9s1NmY28kpoyZf (READY).

All three browser regression checks passed locally and on production. The live run, including authentication setup, finished in 43.5 seconds.

- Click Step 1: the drag-and-drop zone and enabled Browse files button render; the comparisons empty state is absent. File selection, mode switching, and mobile layout work.
- Upload counts and advance: Steps 1–4 each display only their own body. Step 4 has pipeline settings and Initialize; returning to Step 1 restores uploads. Plan confirmation resets after returning to edit comparisons.
- Upload the actual Jacquere counts and gene map: both files finish uploading, the 60,550-guide library imports, comparisons render in Step 3, pipeline parameters render in Step 4, and clicking Step 1 restores the upload zone with both files attached. No browser errors were recorded.

The screenshots were captured during the production check. The analysis was not launched.

Build and TypeScript checks passed. Focused ESLint checks reported no errors and unused-code warnings. The sequence-ID library alias regression passed at 60,550 guides. Two existing comparison-generation assertions in experiment-import.test.mjs still fail; the same failures were reproduced using committed HEAD sources before these changes.

Source hashes and check details are in verification.json.
