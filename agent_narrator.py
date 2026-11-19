from __future__ import annotations

import asyncio
import hashlib
from collections import deque
from typing import Any, Mapping

class GalgameNarratorMixin:
    def _ensure_narrator_hashes(self) -> deque[str]:
        if not hasattr(self, "_narrator_recent_hashes"):
            self._narrator_recent_hashes = deque(maxlen=256)
        return self._narrator_recent_hashes

    def _narrator_config(self) -> dict[str, Any]:
        cfg = getattr(self, "_cfg", None)
        if cfg is None:
            return {}
        return {
            "enabled": bool(getattr(cfg, "narrator_enabled", True)),
            "pipeline": str(getattr(cfg, "tts_output_pipeline", "agent") or "agent").strip().lower(),
            "max_lines": int(getattr(cfg, "narrator_max_lines_per_push", 3) or 3),
            "max_chars": int(getattr(cfg, "narrator_max_chars", 240) or 240),
            "drop_after": float(getattr(cfg, "narrator_drop_after_seconds", 12.0) or 12.0),
            "include_speaker": bool(getattr(cfg, "narrator_include_speaker", True)),
            "direct_audio": bool(getattr(cfg, "narrator_direct_audio_enabled", False)),
            "tts_model": str(getattr(cfg, "narrator_tts_model", "gemini-2.5-flash-preview-tts") or ""),
            "tts_voice": str(getattr(cfg, "narrator_tts_voice", "Leda") or ""),
        }

    async def _maybe_narrate_lines(
        self,
        shared: dict[str, Any],
        lines: list[dict[str, Any]],
        *,
        scene_id: str,
        route_id: str,
    ) -> None:
        mode = str(shared.get("mode") or "")
        if mode != "narrator":
            return
        conf = self._narrator_config()
        if not conf.get("enabled", True):
            return
        pipeline = conf.get("pipeline", "agent")
        if pipeline == "off":
            return

        now_mono = asyncio.get_running_loop().time()
        max_chars = conf.get("max_chars", 240)
        drop_after = conf.get("drop_after", 12.0)
        max_lines = conf.get("max_lines", 3)
        include_speaker = conf.get("include_speaker", True)

        valid_lines: list[str] = []
        for item in lines:
            if not isinstance(item, Mapping):
                continue
            text = str(item.get("text") or "").strip()
            if not text or len(text) < 2 or len(text) > max_chars:
                continue
            ts = float(item.get("ts") or 0.0)
            if ts > 0.0 and (now_mono - ts) > drop_after:
                continue
            speaker = str(item.get("speaker") or "").strip()
            if speaker and include_speaker:
                formatted = f"【{speaker}】{text}"
            else:
                formatted = text

            h = hashlib.sha256(formatted.encode("utf-8")).hexdigest()[:16]
            hashes = self._ensure_narrator_hashes()
            if h in hashes:
                continue
            hashes.append(h)
            valid_lines.append(formatted)

        if not valid_lines:
            return

        chunk = valid_lines[:max_lines]
        combined = "\n".join(chunk)

        final_text = combined
        if pipeline == "agent":
            gateway = getattr(self, "_llm_gateway", None)
            if gateway is not None and hasattr(gateway, "narrate_line"):
                try:
                    res = await gateway.narrate_line({"lines": chunk, "scene_id": scene_id})
                    narration = str(res.get("narration") or "").strip()
                    if narration:
                        final_text = narration
                except Exception:
                    pass

        if not final_text:
            return

        await self._push_agent_message(
            shared,
            kind="narration",
            content=final_text,
            scene_id=scene_id,
            route_id=route_id,
            priority=7,
            metadata={
                "context_type": "galgame_narration",
                "tts_pipeline": pipeline,
            },
        )
