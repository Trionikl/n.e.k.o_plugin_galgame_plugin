from __future__ import annotations

import asyncio
import pytest
from typing import Any
from market_plugins.galgame_plugin.plugin_core import GalgamePlugin
from market_plugins.galgame_plugin.models.constants import (
    MODE_NARRATOR,
    TTS_PIPELINE_DIRECT,
    TTS_PIPELINE_AGENT,
    TTS_PIPELINE_OFF,
)
from market_plugins.galgame_plugin.plugin_entries.galgame_set_tts_pipeline import GalgameSetTtsPipelineEntry

# Note: We use a simplified mock for the plugin for unit tests of the entry
class MockPlugin:
    def __init__(self):
        self.ctx = type("Ctx", (), {"plugin_dir": "dir", "raw": {}})()
        self.cfg = type("Cfg", (), {"tts_output_pipeline": "agent"})()
        self._persist = type("Persist", (), {
            "persist_config_override": lambda k, v: True
        })()

@pytest.mark.asyncio
async def test_tts_pipeline_entry_logic() -> None:
    plugin = MockPlugin()
    entry = GalgameSetTtsPipelineEntry(plugin)
    
    # Test valid value
    result = await entry.run("direct")
    assert result.value["tts_output_pipeline"] == "direct"
    
    # Test invalid value
    with pytest.raises(Exception):
        await entry.run("invalid_value")
