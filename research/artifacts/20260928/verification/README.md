# Independent historical replay — 2026-09-28

This is an offline verification of previously frozen public-test rankings. It is **not new model selection, a superiority result, or prospective validation**.

## Results

All 334 test screens and all 63 publication identifiers are retained. Three fresh official evaluator instances produce byte-identical per-screen JSON for each of ten ranking files: the ensemble, router, and eight fixed legacy seeds. The existing ensemble, router and legacy-seed-0 score tables also match exactly on eight metrics at every screen. The legacy reported result averages eight seeds within each screen before publication resampling.

| Method | Mean AnDCG@100 | 95% publication bootstrap interval |
|---|---:|---:|
| Published ensemble | 0.16309105341547825 | [0.12422098526839172, 0.2135155410844061] |
| Frozen metadata-only router | 0.16036947764886397 | [0.11957178538033873, 0.21269502154407907] |
| Historical eight-seed legacy average | 0.13605235245977712 | [0.08109519782206469, 0.21987260720466345] |

Router minus ensemble: **−0.002721575766614277**, paired 95% interval **[−0.015136650774725346, +0.00639272366235794]**. The interval includes zero. The new bootstrap seed is 20260928, so finite-resample interval endpoints differ from the September 27 report; the point estimates reproduce.

The legacy estimator has different inputs: 1,567 train-plus-validation screens and the target measured library. The router's historical fit used 1,349 training screens and metadata-only queries. Legacy comparisons are marked `input_comparable: false`; their numerical differences are not fair superiority tests. Published language-model training-data contamination remains unknown.

## Independent calculation

`engine/analysis/independent_verification.py` calls installed `assaybench==0.2.0` `RankingMetrics` directly. It does not call SplicR's score wrapper, optimized metric, or bootstrap helper. It reopens each saved ranking for each replay. Official mapping, duplicate handling, signed relevance, top-k truncation and random-baseline adjustment remain unchanged. No ranking is repaired, library-filtered, padded or backfilled.

The independent bootstrap samples 63 publications with replacement per draw and retains all their screens, using the same 10,000 draws across methods. It computes a screen-weighted ratio, not an unweighted average of study means. Seed variation is reported separately; eight seeds are not treated as eight independent biological observations. Intervals are descriptive and do not correct for historical model exploration.

Non-HGNC symbols are diagnostics, not grounds for rejecting predictions or altering the evaluator. The regression suite explicitly verifies that a non-HGNC symbol present in the target remains measured under official semantics. Coverage totals distinguish measured nonhits, opposite-direction hits, and unmeasured predictions. Fractions in `coverage_diagnostics` use pooled normalized top-100 slots; they are not the older report's mean of screen-specific fractions or validation probabilities.

## Files

- `input_manifest.json`: source/data/mapping hashes, split IDs and declared input boundaries.
- `*_predictions.json`: exact extracted upstream/saved router rankings and reconstructed fixed legacy rankings.
- `replay{1,2,3}_*_screens.json`: complete per-screen official metrics and diagnostics.
- `replays.json`: prediction/result hashes and measured replay runtimes.
- `publication_bootstrap_draws.json`: all 10,000 shared draws for three methods.
- `summary.json`: full-precision results, paired intervals, coverage and limitations.
- `output_manifest.json`: hashes of the 44 JSON inputs/outputs present when the replay finished; excludes itself and later review files.
- `review.json`: post-run input/output hash verification, exact archived-row comparisons, publication overlap, and test result.
- `tests.log`: 13 passing verification regressions. Synthetic tests are software checks, not biological performance evidence.

Measured main-run runtime: 234.881 seconds. Main-run JSON artifacts total approximately 11.9 MB. No external model inference, network fetch, production write, branch operation or new model selection occurred.

## Reproduce without overwriting evidence

From the repository root, using the existing environment and local reference snapshot:

```sh
PYTHONPATH=engine engine/.tools/env/bin/python -m pytest engine/tests/test_independent_verification.py -q
PYTHONPATH=engine engine/.tools/env/bin/python engine/analysis/independent_verification.py --output research/artifacts/20260928/verification_second_run
```

The script refuses a nonempty output directory and uses exclusive-create writes. All existing historical artifacts are read-only inputs. The local manifests record content; they are not trusted external timestamps.
