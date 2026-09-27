"""Compatibility shim required to use `rs3` (Rule Set 3) in this environment.

Why this exists
---------------
`rs3` 0.0.18 pins ``lightgbm<=3.3.5`` and ``scikit-learn<=1.0.2``. Neither pin is
satisfiable here:

* lightgbm 3.3.5 ships no macOS arm64 wheel (only macOS x86_64), and
* scikit-learn 1.0.2 has no cp311 wheel and fails to build from source on
  Python 3.11 (Cython error in ``_hist_gradient_boosting/splitting.pyx``).

So rs3 is installed with ``--no-deps`` against lightgbm 4.x / scikit-learn 1.9.x.
The scikit-learn pickles (``target_model.pkl``, ``target_lite_model.pkl``) load
fine on 1.9.x. The lightgbm pickle (``RuleSet3.pkl``) does not: it was written by
lightgbm 3.x, where ``LGBMModel._n_classes`` did not exist as instance state, so
on unpickling it stays ``None``. lightgbm 4.x's ``_process_params`` then does
``if self._n_classes > 2`` and raises::

    TypeError: '>' not supported between instances of 'NoneType' and 'int'

``RuleSet3.pkl`` is an ``LGBMRegressor``, and in lightgbm 4.x a fitted regressor
carries the sentinel ``_n_classes == -1``. Restoring that sentinel on unpickle is
therefore the correct repair, not a guess: it takes the same branch the model was
trained under.

Usage
-----
Import this module (or call :func:`patch_lightgbm_pickles`) once, before the
first ``rs3`` call::

    from splicr import rs3_compat  # noqa: F401  (patches on import)
    from rs3.seq import predict_seq
    predict_seq(["GGGCTTTCACCGACTTCGGGTGGCTCCCCC"])

Verified on lightgbm 4.7.0 / scikit-learn 1.9.1 / numpy 1.26.4: ``predict_seq``
returns the expected z-scored range, and a poly-T guide scores lowest.

Remove this shim if rs3 is ever updated for lightgbm >= 4.
"""

from __future__ import annotations

_PATCHED = False

# lightgbm 4.x sentinel for "this estimator is not a classifier".
_REGRESSOR_N_CLASSES = -1


def patch_lightgbm_pickles() -> bool:
    """Teach lightgbm 4.x how to unpickle a lightgbm 3.x estimator.

    Idempotent. Returns True if the patch is in effect, False if lightgbm is not
    importable.
    """
    global _PATCHED
    if _PATCHED:
        return True

    try:
        from lightgbm.sklearn import LGBMModel
    except ImportError:
        return False

    def __setstate__(self, state):  # noqa: N807
        self.__dict__.update(state)
        # Absent in lightgbm 3.x pickles; None breaks the `> 2` comparison in
        # lightgbm 4.x _process_params().
        if getattr(self, "_n_classes", None) is None:
            self._n_classes = _REGRESSOR_N_CLASSES

    LGBMModel.__setstate__ = __setstate__
    _PATCHED = True
    return True


patch_lightgbm_pickles()
