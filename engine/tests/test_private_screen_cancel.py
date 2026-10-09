from types import SimpleNamespace
import pytest
from splicr import private_screen

@pytest.mark.parametrize('state', [('canceled', None), ('running', 'another-worker'), None])
def test_canceled_or_superseded_worker_does_not_finish_or_retry(monkeypatch, state):
    calls = []
    class Connection:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, sql, args):
            calls.append((sql, args))
            return SimpleNamespace(fetchone=lambda: state)
        def commit(self): pass
    job = private_screen.Job('job', 'run', 'screen', 'org', 1)
    monkeypatch.setattr(private_screen.db, 'connect', Connection)
    monkeypatch.setattr(private_screen, '_claim', lambda *_: job)
    monkeypatch.setattr(private_screen, '_heartbeat', lambda *_: None)
    monkeypatch.setattr(private_screen, '_screen_spec', lambda *_: (None, None))
    monkeypatch.setattr(private_screen, 'run_pipeline', lambda *_args, **_kwargs: SimpleNamespace(ok=True, error=None))
    monkeypatch.setattr(private_screen, '_finish', lambda *_: pytest.fail('lost lease must not finish or retry'))
    out = private_screen.process_one(owner='worker', call_id='fc-test')
    assert not out['ok']
    assert out['canceled'] == bool(state and state[0] == 'canceled')
    assert calls[0][1] == ('fc-test', 'job')
    assert 'for update' in calls[-1][0]
