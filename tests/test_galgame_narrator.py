from __future__ import annotations

import asyncio
import pytest
from pathlib import Path
from market_plugins.galgame_plugin.agent_core import GameLLMAgent
from tests.support.plugin_runtime_stubs import install_plugin_runtime_stubs
from tests.support.entry_flow import EntryContext, GalgamePlugin
from tests.support.memory_flow import _Logger as _Logger, _make_effective_config, _make_plugin_dirs
from market_plugins.galgame_plugin.llm_gateway import LLMGateway
from market_plugins.galgame_plugin.host_agent_adapter import HostAgentAdapter

install_plugin_runtime_stubs()

@pytest.mark.asyncio
async def test_narrator_mode_behavior(tmp_path: Path) -> None:
    plugin_dir, bridge_root = _make_plugin_dirs(tmp_path)
    ctx = EntryContext(plugin_dir, _make_effective_config(bridge_root))
    plugin = GalgamePlugin(ctx)
    logger = _Logger()
    config = _make_effective_config(bridge_root)
    adapter = HostAgentAdapter(logger)
    gateway = LLMGateway(plugin, logger, config)
    agent = GameLLMAgent(
        plugin=plugin,
        logger=logger,
        llm_gateway=gateway,
        host_adapter=adapter,
    )
    
    shared = {"mode": "narrator", "push_notifications": True}
    
    from market_plugins.galgame_plugin.service import (
        mode_allows_agent_actuation,
        mode_allows_scene_push,
        mode_allows_narration,
    )
    assert mode_allows_narration("narrator") is True
    assert mode_allows_agent_actuation("narrator") is False
    assert mode_allows_scene_push("narrator") is False

    pushed = []
    async def fake_push(shared_dict, **kwargs):
        pushed.append(kwargs)
        return True
    agent._push_agent_message = fake_push # type: ignore

    lines = [{"speaker": "Alice", "text": "Hello world", "ts": asyncio.get_running_loop().time()}]
    await agent._maybe_narrate_lines(shared, lines, scene_id="s1", route_id="r1")
    
    assert len(pushed) == 1
    assert "Alice" in pushed[0]["content"]
    assert "Hello world" in pushed[0]["content"]
