from __future__ import annotations

from typing import Any

from ._common import Err, Ok, SdkError, plugin_entry, tr
from ..models import TTS_OUTPUT_PIPELINES, STORE_TTS_OUTPUT_PIPELINE


class _GalgameSetTtsPipelineMixin:
    @plugin_entry(
        id="galgame_set_tts_pipeline",
        name=tr("entries.galgame_set_tts_pipeline.name", default="Канал озвучки"),
        description=tr(
            "entries.galgame_set_tts_pipeline.description",
            default="Установить канал озвучки: через агента (LLM), напрямую (без LLM) или выключить.",
        ),
        input_schema={
            "type": "object",
            "properties": {
                "value": {"type": "string", "enum": sorted(TTS_OUTPUT_PIPELINES)},
            },
            "required": ["value"],
        },
        llm_result_fields=["summary"],
    )
    async def galgame_set_tts_pipeline(self, value: str, **_):
        if self._cfg is None:
            return Err(SdkError(self._not_configured_message()))
        pipeline = str(value or "").strip().lower()
        if pipeline not in TTS_OUTPUT_PIPELINES:
            return Err(SdkError(f"invalid tts pipeline: {value!r}"))

        old = str(getattr(self._cfg, "tts_output_pipeline", "agent") or "agent")
        try:
            setattr(self._cfg, "tts_output_pipeline", pipeline)
            config_service = getattr(self, "_config_service", None)
            if config_service is not None and hasattr(config_service, "persist_tts_output_pipeline"):
                config_service.persist_tts_output_pipeline(pipeline=pipeline)
            else:
                persist = getattr(self, "_persist", None)
                if persist is not None and hasattr(persist, "persist_config_override"):
                    persist.persist_config_override(STORE_TTS_OUTPUT_PIPELINE, pipeline)
        except Exception as exc:
            setattr(self._cfg, "tts_output_pipeline", old)
            return Err(SdkError(f"failed to persist tts pipeline: {exc}"))

        labels = {
            "agent": "через агента (LLM)",
            "direct": "напрямую (без LLM)",
            "off": "выключен",
        }
        return Ok({
            "tts_output_pipeline": pipeline,
            "summary": f"Канал озвучки: {labels.get(pipeline, pipeline)}",
            "changed": pipeline != old,
        })


class GalgameSetTtsPipelineEntry:
    """Compatibility wrapper used by existing unit tests."""

    def __init__(self, plugin: Any) -> None:
        self._plugin = plugin

    async def run(self, value: str) -> Any:
        pipeline = str(value or "").strip().lower()
        if pipeline not in TTS_OUTPUT_PIPELINES:
            raise ValueError(f"Invalid pipeline: {value}. Must be one of {sorted(TTS_OUTPUT_PIPELINES)}")

        cfg = getattr(self._plugin, "cfg", None) or getattr(self._plugin, "_cfg", None)
        if cfg is not None:
            try:
                setattr(cfg, "tts_output_pipeline", pipeline)
            except Exception:
                pass

        persist = getattr(self._plugin, "_persist", None)
        if persist is not None and hasattr(persist, "persist_config_override"):
            try:
                persist.persist_config_override(STORE_TTS_OUTPUT_PIPELINE, pipeline)
            except Exception:
                pass

        return Ok({
            "tts_output_pipeline": pipeline,
            "summary": "Канал озвучки обновлён",
        })
