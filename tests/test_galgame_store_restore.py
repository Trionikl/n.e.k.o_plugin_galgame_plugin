from __future__ import annotations

import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

from market_plugins.galgame_plugin.models import (
    MODE_COMPANION,
    MODE_SILENT,
    MODES,
    STORE_MODE,
    STORE_TTS_OUTPUT_PIPELINE,
    TTS_OUTPUT_PIPELINES,
)
from market_plugins.galgame_plugin.plugin_core import GalgamePlugin
from market_plugins.galgame_plugin.service import build_config
from market_plugins.galgame_plugin.store import GalgameStore


def _logger() -> SimpleNamespace:
    return SimpleNamespace(warning=lambda *_, **__: None)


def _plugin(tmp_path: Path, *, cfg_overrides: dict | None = None) -> SimpleNamespace:
    store = GalgameStore(tmp_path / "store.json", _logger())
    plugin = SimpleNamespace(
        _cfg=build_config(cfg_overrides or {}),
        _persist=store,
        _state=SimpleNamespace(),
        _state_lock=threading.RLock(),
        _state_dirty=False,
        _cached_snapshot=None,
        _load_context_snapshot_for_state=lambda: {},
    )
    plugin._apply_config_overrides_from_store = lambda: GalgamePlugin._apply_config_overrides_from_store(
        plugin
    )
    return plugin


def _restore(plugin: SimpleNamespace) -> tuple[dict, list]:
    # Mirrors GalgamePlugin.startup(): config is loaded before the store
    # restore, so the default mode is available for fresh stores.
    return plugin._persist.load(default_mode=plugin._cfg.default_mode)


def test_fresh_store_restores_default_mode_and_tts_pipeline_from_config(
    tmp_path: Path,
) -> None:
    plugin = _plugin(tmp_path)
    restored, warnings = _restore(plugin)

    GalgamePlugin._set_runtime_from_store(plugin, restored, warnings)

    assert warnings == []
    assert plugin._cfg.default_mode in MODES
    # Fresh store: no saved mode -> config default_mode (narrator), not the
    # legacy hardcoded companion fallback.
    assert plugin._state.mode == plugin._cfg.default_mode
    assert plugin._state.mode == "narrator"
    assert plugin._cfg.tts_output_pipeline == "agent"
    assert plugin._state.last_error == {}


@pytest.mark.parametrize("pipeline", ["direct", "off"])
def test_fresh_store_with_stored_tts_pipeline_restores_pipeline_value(
    tmp_path: Path, pipeline: str
) -> None:
    assert pipeline in TTS_OUTPUT_PIPELINES
    plugin = _plugin(tmp_path)
    plugin._persist.persist_config_override(STORE_TTS_OUTPUT_PIPELINE, pipeline)
    restored, warnings = _restore(plugin)

    GalgamePlugin._set_runtime_from_store(plugin, restored, warnings)

    assert plugin._state.mode == "narrator"
    assert plugin._cfg.tts_output_pipeline == pipeline


def test_saved_mode_is_not_overwritten_by_config_default(tmp_path: Path) -> None:
    plugin = _plugin(tmp_path)
    plugin._persist.persist_mode_settings(
        bound_game_id="",
        mode=MODE_COMPANION,
        push_notifications=True,
        advance_speed="medium",
        reader_mode="auto",
    )
    restored, warnings = _restore(plugin)
    assert restored[STORE_MODE] == MODE_COMPANION

    GalgamePlugin._set_runtime_from_store(plugin, restored, warnings)

    assert plugin._state.mode == MODE_COMPANION


def test_invalid_stored_tts_pipeline_falls_back_to_config_default(
    tmp_path: Path,
) -> None:
    plugin = _plugin(tmp_path)
    plugin._persist.persist_config_override(STORE_TTS_OUTPUT_PIPELINE, "garbage")
    restored, warnings = _restore(plugin)

    GalgamePlugin._set_runtime_from_store(plugin, restored, warnings)

    assert plugin._cfg.tts_output_pipeline == "agent"


def test_store_load_silent_mode_restores_silent(tmp_path: Path) -> None:
    plugin = _plugin(tmp_path)
    plugin._persist.persist_mode_settings(
        bound_game_id="",
        mode=MODE_SILENT,
        push_notifications=True,
        advance_speed="medium",
        reader_mode="auto",
    )
    restored, warnings = _restore(plugin)

    GalgamePlugin._set_runtime_from_store(plugin, restored, warnings)

    assert plugin._state.mode == MODE_SILENT


