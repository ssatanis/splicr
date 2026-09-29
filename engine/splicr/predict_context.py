"""Run a frozen experimental context ranker on a new experiment.

No network calls, target library, target measurements, or automatic promotion.
The bundle binds the training records, implementation and optional text model.
External experts must be supplied with provenance; unavailable inputs fail closed.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import inspect
from importlib.resources import files
import json
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np

from .context_ranking import ContextEvidence, ContextRanker, ExposureConfig, EXPERTS, reciprocal_rank
from .prescreen import FIELDS, ScreenContext
from .research_protocol import freeze_predictions, sha256_file


def training_digest(records: Sequence[Mapping]) -> str:
    """Ordered, complete training inputs; irrelevant post-hoc prose is excluded."""
    digest = hashlib.sha256()
    for record in records:
        row = {key: record.get(key) for key in (*FIELDS, 'dataset_name', 'source_id',
                                                'relevance_genes', 'relevance_scores')}
        digest.update(json.dumps(row, sort_keys=True, separators=(',', ':'), allow_nan=False).encode())
        digest.update(b'\n')
    return digest.hexdigest()


def _bound_training_digest(provenance: Mapping) -> str:
    """Verify the frozen benchmark corpus before exporting its fitted model."""
    from .assaybench_io import ASSAYBENCH_SNAPSHOT, load_split
    source = Path(ASSAYBENCH_SNAPSHOT) / 'biogrid/train-00000-of-00001.parquet'
    if sha256_file(source) != provenance['data_sha256']:
        raise ValueError('frozen training snapshot differs')
    return training_digest(load_split('train'))


def export_bundle(path: Path, *, training, experiment_freeze: Path, name: str,
                  configuration: dict, model_directory: Path):
    """Create a reviewable manifest alongside existing, hash-bound text models."""
    frozen = json.loads(experiment_freeze.read_text())
    if frozen.get('promotion_status') != 'research_only':
        raise ValueError('only explicitly experimental freezes are supported')
    if (name not in frozen['final_replay_candidates']
            or configuration != frozen['validation_results'][name]['config']):
        raise ValueError('configuration differs from the frozen candidate')
    if training_digest(training) != _bound_training_digest(frozen['provenance']):
        raise ValueError('supplied training records differ from the experiment training corpus')
    if path.parent.resolve() != model_directory.resolve():
        raise ValueError('bundle and text models must share a directory')
    models = {}
    if configuration['kind'] == 'ranker':
        for role, suffix in [('ranker', '_model.txt'), ('coverage', '_coverage.txt')]:
            source = model_directory / (name + suffix)
            if role == 'ranker' or configuration['config'].get('coverage'):
                models[role] = {'file': source.name, 'sha256': sha256_file(source)}
    payload = {'schema': 'splicr.context-bundle.v1', 'name': name,
               'promotion_status': 'research_only', 'validation_probability': None,
               'configuration': configuration, 'training_sha256': training_digest(training),
               'serving_code_sha256': sha256_file(__file__),
               'freeze_sha256': sha256_file(experiment_freeze),
               'provenance': frozen['provenance'], 'models': models}
    with path.open('x') as stream:
        json.dump(payload, stream, sort_keys=True, indent=2, allow_nan=False)
    return payload


class FrozenContextPredictor:
    def __init__(self, bundle: str | Path, training):
        self.path = Path(bundle)
        self.manifest = json.loads(self.path.read_text())
        m = self.manifest
        if (m.get('schema') != 'splicr.context-bundle.v1' or m.get('promotion_status') != 'research_only'
                or m.get('validation_probability') is not None):
            raise ValueError('unsupported bundle or unsupported calibration/promotion claim')
        if training_digest(training) != m['training_sha256']:
            raise ValueError('training data differ from the frozen model')
        if sha256_file(__file__) != m['serving_code_sha256']:
            raise ValueError('frozen serving implementation differs')
        p = m['provenance']
        from assaybench.benchmark.metrics import RankingMetrics
        from assaybench.utils import gene_mapper
        for key, source in [('metric_sha256', inspect.getfile(RankingMetrics)),
                            ('identifier_mapping_sha256', inspect.getfile(gene_mapper))]:
            if sha256_file(source) != p[key]:
                raise ValueError('official metric/identifier implementation differs')
        for name in ('numpy', 'scipy', 'scikit-learn', 'lightgbm'):
            if importlib.metadata.version(name) != p['packages'][name]:
                raise ValueError('frozen numerical environment differs')
        for key, filename in [('context_ranking_sha256', 'context_ranking.py'),
                              ('model_code_sha256', 'prescreen.py')]:
            if sha256_file(Path(__file__).with_name(filename)) != p[key]:
                raise ValueError('frozen implementation differs')
        if set(p['identifier_resources']) != {'all_genes.tsv', 'hgnc_symbols_cache.tsv',
                                              'manual_mappings.json', 'uniprot_protein_to_gene.json'}:
            raise ValueError('incomplete identifier provenance')
        for filename, expected in p['identifier_resources'].items():
            if Path(filename).name != filename:
                raise ValueError('invalid annotation resource')
            if sha256_file(str(files('assaybench.data.hgnc').joinpath(filename))) != expected:
                raise ValueError('gene annotation revision differs')
        self.configuration = m['configuration']
        if self.configuration['kind'] not in {'prior', 'ranker', 'rrf'}:
            raise ValueError('unsupported frozen method')
        self.corpus = ContextEvidence().fit(training)
        self.training_sources = frozenset(self.corpus.corpus.publications)
        self.models = {}
        for role, entry in m['models'].items():
            if Path(entry['file']).name != entry['file']:
                raise ValueError('model file must be local to bundle')
            source = self.path.parent / entry['file']
            if sha256_file(source) != entry['sha256']:
                raise ValueError('model checksum differs')
            import lightgbm as lgb
            self.models[role] = lgb.Booster(model_file=str(source))
        if self.configuration['kind'] == 'ranker':
            required = {'ranker'} | ({'coverage'} if self.configuration['config'].get('coverage') else set())
            if set(self.models) != required:
                raise ValueError('incomplete model bundle')

    def predict(self, context: ScreenContext, expert_document: Mapping | None = None):
        if not isinstance(context, ScreenContext):
            raise TypeError('only pre-experimental ScreenContext is accepted')
        if context.source_id in self.training_sources:
            raise ValueError('query publication overlaps frozen training data')
        kind = self.configuration['kind']
        rankings = None
        if kind != 'prior':
            if not isinstance(expert_document, dict) or set(expert_document) != set(EXPERTS):
                raise ValueError('all five declared external experts are required')
            rankings = {}
            for name, entry in expert_document.items():
                if not isinstance(entry, dict) or not isinstance(entry.get('provenance'), dict) or not entry['provenance']:
                    raise ValueError('each external ranking requires traceable provenance')
                rankings[name] = entry.get('genes')
        if kind == 'prior':
            ranking = self.corpus.rank(context, ExposureConfig(**self.configuration['config']))
        elif kind == 'rrf':
            ranking = reciprocal_rank(rankings, constant=self.configuration['constant'])
        else:
            spec = ContextRanker(**self.configuration['config'])
            genes, features = spec.features(context, rankings, self.corpus)
            scores = self.models['ranker'].predict(features)
            if 'coverage' in self.models:
                scores *= self.models['coverage'].predict(features)
            if not np.isfinite(scores).all():
                raise ArithmeticError('nonfinite frozen model prediction')
            ranking = [genes[i] for i in np.argsort(-scores, kind='stable')[:100]]
        if not ranking or len(ranking) != len(set(ranking)):
            raise ValueError('empty or duplicate model prediction')
        return ranking


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('bundle', 'training', 'context', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--experts', type=Path)
    parser.add_argument('--receipt', type=Path)
    args = parser.parse_args(argv)
    record = json.loads(args.context.read_text())
    permitted = set(FIELDS) | {'dataset_name', 'source_id'}
    if (not isinstance(record, dict) or set(record) - permitted
            or any(not isinstance(v, (str, int, float, type(None))) for v in record.values())
            or any(isinstance(v, (int, float)) and not np.isfinite(v) for v in record.values())):
        parser.error('context contains forbidden target information or invalid metadata')
    model = FrozenContextPredictor(args.bundle, json.loads(args.training.read_text()))
    expert_document = json.loads(args.experts.read_text()) if args.experts else None
    ranking = model.predict(ScreenContext.from_record(record), expert_document)
    manifest = {**model.manifest, 'bundle_sha256': sha256_file(args.bundle),
                'context_sha256': sha256_file(args.context),
                'external_sha256': sha256_file(args.experts) if args.experts else None,
                'external_provenance': {k: v['provenance'] for k, v in expert_document.items()} if expert_document else None}
    result = {'task': 'pre_screen_prediction',
              'input_contract': 'metadata_plus_external_rankings' if expert_document else 'metadata_only',
              'promotion_status': 'research_only', 'model': manifest,
              'genes': ranking, 'validation_probability': None,
              'limitations': ['No independent prospective performance established.',
                              'External provenance is recorded, not independently authenticated.',
                              'External rankings may contain post-publication knowledge or post-hoc prompt information.',
                              'Ranking utility is not a probability of biological validation.']}
    with args.output.open('x') as stream:
        json.dump(result, stream, sort_keys=True, indent=2, allow_nan=False)
    if args.receipt:
        name = str(record.get('dataset_name') or 'new_experiment')
        freeze_predictions(args.receipt, predictions={name: ranking}, model_manifest=manifest,
                           contexts={name: record}, training_publications=sorted(model.training_sources))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
