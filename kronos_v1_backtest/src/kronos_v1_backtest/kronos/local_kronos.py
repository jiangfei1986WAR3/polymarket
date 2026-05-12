from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from ..data.candles import Candle
from ..matching.selector import PredPath


@dataclass(frozen=True)
class LocalKronosConfig:
    kronos_repo_dir: str
    tokenizer_dir: str
    model_dir: str
    device: str = "cpu"
    max_context: int = 512
    clip: float = 5.0


class LocalKronosClient:
    def __init__(self, cfg: LocalKronosConfig):
        self._cfg = cfg

        import sys

        repo = Path(cfg.kronos_repo_dir).resolve()
        if not repo.exists():
            raise FileNotFoundError('kronos_repo_dir not found: ' + str(repo))

        if str(repo) not in sys.path:
            sys.path.insert(0, str(repo))

        from model import Kronos, KronosTokenizer
        from model.kronos import auto_regressive_inference, calc_time_stamps

        self._auto_regressive_inference = auto_regressive_inference
        self._calc_time_stamps = calc_time_stamps

        self._tokenizer = KronosTokenizer.from_pretrained(cfg.tokenizer_dir)
        self._model = Kronos.from_pretrained(cfg.model_dir)

        # Device is used in tensors + model modules.
        self._device = cfg.device
        self._max_context = cfg.max_context
        self._clip = cfg.clip

        self._tokenizer = self._tokenizer.to(self._device)
        self._model = self._model.to(self._device)

    def predict_paths(
        self,
        model_input: list[Candle],
        horizon: int,
        n_paths: int,
        T: float = 1.0,
        top_p: float = 0.9,
        top_k: int = 0,
        verbose: bool = False,
    ) -> list[PredPath]:
        import numpy as np
        import torch

        # Build df + timestamps
        df = pd.DataFrame(
            {
                'open': [c.open for c in model_input],
                'high': [c.high for c in model_input],
                'low': [c.low for c in model_input],
                'close': [c.close for c in model_input],
            }
        )

        x_ts = pd.to_datetime([c.open_time_ms for c in model_input], unit='ms', utc=True)
        last = x_ts[-1]
        y_ts = pd.date_range(last + pd.Timedelta(hours=1), periods=horizon, freq='h', tz='UTC')

        # Ensure volume/amount columns exist
        vol_col = 'volume'
        amt_col = 'amount'
        if vol_col not in df.columns:
            df[vol_col] = 0.0
            df[amt_col] = 0.0
        if amt_col not in df.columns and vol_col in df.columns:
            df[amt_col] = df[vol_col] * df[['open', 'high', 'low', 'close']].mean(axis=1)

        x_time_df = self._calc_time_stamps(pd.Series(x_ts))
        y_time_df = self._calc_time_stamps(pd.Series(y_ts))

        x = df[['open', 'high', 'low', 'close', vol_col, amt_col]].values.astype(np.float32)
        x_stamp = x_time_df.values.astype(np.float32)
        y_stamp = y_time_df.values.astype(np.float32)

        x_mean, x_std = np.mean(x, axis=0), np.std(x, axis=0)
        x = (x - x_mean) / (x_std + 1e-5)
        x = np.clip(x, -self._clip, self._clip)

        x = x[np.newaxis, :]
        x_stamp = x_stamp[np.newaxis, :]
        y_stamp = y_stamp[np.newaxis, :]

        x_tensor = torch.from_numpy(x).to(self._device)
        x_stamp_tensor = torch.from_numpy(x_stamp).to(self._device)
        y_stamp_tensor = torch.from_numpy(y_stamp).to(self._device)

        preds_raw = self._auto_regressive_inference(
            self._tokenizer,
            self._model,
            x_tensor,
            x_stamp_tensor,
            y_stamp_tensor,
            self._max_context,
            horizon,
            self._clip,
            T,
            top_k,
            top_p,
            n_paths,
            verbose,
            return_raw=True,
        )

        # preds_raw: (B=1, sample_count, seq_len, d_in)
        preds_raw = preds_raw[0]
        preds_raw = preds_raw[:, -horizon:, :]
        preds_raw = preds_raw * (x_std + 1e-5) + x_mean

        # Convert to PredPath
        paths: list[PredPath] = []
        for k in range(n_paths):
            cs: list[Candle] = []
            for h in range(horizon):
                ts = y_ts[h]
                open_time_ms = int(ts.to_pydatetime().timestamp() * 1000)
                o, hi, lo, cl = preds_raw[k, h, 0], preds_raw[k, h, 1], preds_raw[k, h, 2], preds_raw[k, h, 3]
                vol = preds_raw[k, h, 4]
                cs.append(
                    Candle(
                        open_time_ms=open_time_ms,
                        open=float(o),
                        high=float(hi),
                        low=float(lo),
                        close=float(cl),
                        volume=float(vol),
                    )
                )
            paths.append(PredPath(candles=cs))

        return paths
