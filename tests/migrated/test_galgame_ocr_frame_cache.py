from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from market_plugins.galgame_plugin.ocr_reader import (
    DetectedGameWindow,
    OcrCaptureProfile,
    OcrReaderManager,
    SelectedOcrBackendPlan,
)
from market_plugins.galgame_plugin.service import build_config
from PIL import Image

pytestmark = pytest.mark.plugin_unit


class _Logger:
    def info(self, *args, **kwargs):
        return None

    def warning(self, *args, **kwargs):
        return None

    def error(self, *args, **kwargs):
        return None

    def debug(self, *args, **kwargs):
        return None

    def exception(self, *args, **kwargs):
        return None


class _FrameCaptureBackend:
    """Захват возвращает управляемое PIL-изображение (хэш по пикселям)."""

    def __init__(self) -> None:
        self.frame: Image.Image = Image.new("RGB", (320, 180), "navy")
        self.capture_calls = 0

    def is_available(self) -> bool:
        return True

    def describe_target(self, target: DetectedGameWindow) -> str:
        return f"{target.process_name}:{target.pid}"

    def capture_frame(self, target: DetectedGameWindow, profile: OcrCaptureProfile) -> Image.Image:
        del profile
        self.capture_calls += 1
        return self.frame


class _CountingOcrBackend:
    def __init__(self, texts: list[str] | None = None) -> None:
        self._texts = list(texts or ["雪乃：第一句台词。"])
        self.calls = 0

    def is_available(self) -> bool:
        return True

    def extract_text(self, image: Any) -> str:
        del image
        self.calls += 1
        if not self._texts:
            return ""
        if len(self._texts) == 1:
            return self._texts[0]
        return self._texts.pop(0)


def _make_config(
    bridge_root: Path,
    *,
    frame_cache_enabled: bool | None = None,
) -> Any:
    ocr_reader: dict[str, object] = {
        "enabled": True,
        "backend_selection": "auto",
        "install_target_dir": "",
        "poll_interval_seconds": 999.0,
        "no_text_takeover_after_seconds": 30.0,
        "background_scene_change_distance": 28,
        "languages": "chi_sim+jpn+eng",
        "screen_templates": [],
        "known_screen_timeout_seconds": 5.0,
    }
    if frame_cache_enabled is not None:
        ocr_reader["frame_cache_enabled"] = frame_cache_enabled
    return build_config(
        {
            "galgame": {
                "bridge_root": str(bridge_root),
                "reader_mode": "auto",
            },
            "llm": {
                "vision_enabled": False,
                "vision_max_image_px": 768,
            },
            "ocr_reader": ocr_reader,
            "rapidocr": {
                "enabled": True,
                "install_target_dir": "",
                "engine_type": "onnxruntime",
                "lang_type": "ch",
                "model_type": "mobile",
                "ocr_version": "PP-OCRv5",
            },
        }
    )


def _window() -> DetectedGameWindow:
    return DetectedGameWindow(
        hwnd=101,
        title="Demo Window",
        process_name="DemoGame.exe",
        pid=4242,
    )


def _make_manager(
    tmp_path: Path,
    *,
    ocr_backend: _CountingOcrBackend,
    frame_cache_enabled: bool | None = None,
) -> tuple[OcrReaderManager, _FrameCaptureBackend]:
    capture_backend = _FrameCaptureBackend()
    manager = OcrReaderManager(
        logger=_Logger(),
        config=_make_config(tmp_path / "bridge", frame_cache_enabled=frame_cache_enabled),
        time_fn=lambda: 1000.0,
        platform_fn=lambda: True,
        window_scanner=lambda: [_window()],
        capture_backend=capture_backend,
        ocr_backend=ocr_backend,
    )
    return manager, capture_backend


def _capture(
    manager: OcrReaderManager,
) -> Any:
    return manager._capture_and_extract_text(
        _window(),
        OcrCaptureProfile(),
        SelectedOcrBackendPlan(),
        collect_background_hash=False,
        allow_separate_background_capture=False,
    )


def test_frame_cache_skips_inference_on_unchanged_frame(tmp_path: Path) -> None:
    ocr_backend = _CountingOcrBackend()
    manager, _capture_backend = _make_manager(tmp_path, ocr_backend=ocr_backend)

    first = _capture(manager)
    second = _capture(manager)

    assert ocr_backend.calls == 1
    assert first.text == "雪乃：第一句台词。"
    assert "ocr_skipped_reason" not in first.timing
    assert second.text == first.text
    assert second.backend_detail == "frame_cache_hit"
    assert second.timing["ocr_skipped_reason"] == "frame_unchanged"
    assert second.capture_image_hash == first.capture_image_hash


def test_frame_cache_invalidates_on_frame_change(tmp_path: Path) -> None:
    ocr_backend = _CountingOcrBackend(
        [
            "雪乃：第一句台词。",
            "雪乃：第二句台词。",
        ]
    )
    manager, capture_backend = _make_manager(tmp_path, ocr_backend=ocr_backend)

    first = _capture(manager)
    capture_backend.frame = Image.new("RGB", (320, 180), "black")
    second = _capture(manager)

    assert ocr_backend.calls == 2
    assert "ocr_skipped_reason" not in first.timing
    assert second.text == "雪乃：第二句台词。"
    assert "ocr_skipped_reason" not in second.timing
    assert second.capture_image_hash != first.capture_image_hash
    # Повторный снимок нового кадра снова идёт из кэша.
    third = _capture(manager)
    assert ocr_backend.calls == 2
    assert third.text == second.text
    assert third.timing["ocr_skipped_reason"] == "frame_unchanged"


def test_frame_cache_disabled_runs_inference_every_time(tmp_path: Path) -> None:
    ocr_backend = _CountingOcrBackend()
    manager, _capture_backend = _make_manager(
        tmp_path,
        ocr_backend=ocr_backend,
        frame_cache_enabled=False,
    )

    first = _capture(manager)
    second = _capture(manager)

    assert ocr_backend.calls == 2
    assert "ocr_skipped_reason" not in first.timing
    assert "ocr_skipped_reason" not in second.timing
    assert second.backend_detail != "frame_cache_hit"
    assert manager._ocr_frame_cache == {}


def test_reset_default_ocr_state_clears_frame_cache(tmp_path: Path) -> None:
    ocr_backend = _CountingOcrBackend()
    manager, capture_backend = _make_manager(tmp_path, ocr_backend=ocr_backend)

    _capture(manager)
    assert len(manager._ocr_frame_cache) == 1
    manager._reset_default_ocr_state()
    assert manager._ocr_frame_cache == {}

    # После сброса кэш пуст: новый инференс на том же кадре.
    capture_backend.frame = Image.new("RGB", (320, 180), "white")
    again = _capture(manager)
    assert ocr_backend.calls == 2
    assert "ocr_skipped_reason" not in again.timing
