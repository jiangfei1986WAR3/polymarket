from __future__ import annotations

from .client import HttpKronosClient, MockKronosClient
from .local_kronos import LocalKronosClient, LocalKronosConfig


def make_kronos_client(
    mode: str,
    *,
    seed: int,
    http_url: str,
    kronos_repo_dir: str,
    tokenizer_dir: str,
    model_dir: str,
    device: str,
):
    if mode == 'mock':
        return MockKronosClient(seed=seed)
    if mode == 'http':
        return HttpKronosClient(http_url)
    if mode == 'local':
        cfg = LocalKronosConfig(
            kronos_repo_dir=kronos_repo_dir,
            tokenizer_dir=tokenizer_dir,
            model_dir=model_dir,
            device=device,
        )
        return LocalKronosClient(cfg)

    raise ValueError('unknown kronos mode: ' + mode)
