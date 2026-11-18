"""Тюнинг RapidOCR-рантайма: DirectML GPU, отключение Cls, лимиты Det.

Скрипт идемпотентен и работает в двух режимах:

  python tools\tune_rapidocr_runtime.py --check
      - печатает версию onnxruntime и доступные провайдеры;
      - печатает текущие значения ключей в config.yaml пакета
        rapidocr_onnxruntime (use_cls, use_dml, limit_side_len, limit_type,
        intra_op_num_threads, rec_keys_path);
      - ничего не изменяет.

  python tools\tune_rapidocr_runtime.py --apply
      1. При отсутствии DmlExecutionProvider заменяет пакет onnxruntime на
         onnxruntime-directml той же версии (через pip в том же интерпретаторе).
      2. Патчит config.yaml пакета rapidocr_onnxruntime:
           Global.use_cls = False          (горизонтальный текст VN — Cls не нужен)
           Global.intra_op_num_threads = 4 (мягкий лимит CPU-фолбэка)
           Det.use_dml / Cls.use_dml / Rec.use_dml = True
           Det.limit_side_len = 960, Det.limit_type = "max"
         Перед правкой создаётся бэкап config.yaml.bak-directml
         (только если бэкапа ещё нет — идемпотентность).
      3. Верификация: создаёт RapidOCR, прогоняет тестовое изображение,
         печатает фактические провайдеры сессии детектора и латентность.

Только Windows. На других платформах скрипт ничего не делает и завершается
с кодом 2.

Использовать с целевым интерпретатором рантайма:
  F:\\PR\\N.E.K.O\\.venv\\Scripts\\python.exe tools\\tune_rapidocr_runtime.py --check
  F:\\PR\\N.E.K.O\\.venv\\Scripts\\python.exe tools\\tune_rapidocr_runtime.py --apply
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

DML_PROVIDER = "DmlExecutionProvider"
CPU_PROVIDER = "CPUExecutionProvider"

# Цель: детектор не раздувает кропы до 1920+ пикселей; мобильные PP-OCRv4
# модели на 960px сохраняют читаемость мелкого шрифта в UI игр (GW2/HoMM4).
TARGET_YAML_PATCH = {
    "Global": {
        "use_cls": False,
        "intra_op_num_threads": 4,
    },
    "Det": {
        "use_dml": True,
        "limit_side_len": 960,
        "limit_type": "max",
    },
    "Cls": {"use_dml": True},
    "Rec": {"use_dml": True},
}


def _fail(message: str, code: int = 1) -> "NoReturn":  # noqa: F821
    print(f"[tune] ОШИБКА: {message}", file=sys.stderr)
    sys.exit(code)


def _require_windows() -> None:
    if platform.system() != "Windows":
        print(
            "[tune] Пропущено: DirectML поддерживается только в Windows "
            f"(текущая ОС: {platform.system()})."
        )
        sys.exit(2)
    major = int(platform.release().split(".")[0])
    if major < 10:
        print(
            "[tune] Пропущено: DirectML требует Windows 10+ "
            f"(текущая версия: {platform.version()})."
        )
        sys.exit(2)


def _import_onnxruntime():
    try:
        import onnxruntime as ort  # type: ignore
    except ImportError as exc:
        _fail(f"onnxruntime не импортируется: {exc}")
    return ort


def _ort_package_info() -> tuple[str, str]:
    """(имя пакета, версия) из уже импортированного onnxruntime."""
    import importlib.metadata as md

    import onnxruntime as ort

    version = str(getattr(ort, "__version__", "") or "")
    package = "onnxruntime"
    try:
        dist = md.distribution("onnxruntime-directml")
        package = dist.metadata["Name"] or "onnxruntime-directml"
        version = dist.version or version
    except md.PackageNotFoundError:
        pass
    return package, version


def _rapidocr_config_path() -> Path | None:
    try:
        import rapidocr_onnxruntime  # type: ignore
    except ImportError:
        return None
    module_file = str(getattr(rapidocr_onnxruntime, "__file__", "") or "")
    if not module_file:
        return None
    config = Path(module_file).resolve().parent / "config.yaml"
    return config if config.is_file() else None


def _load_yaml(config_path: Path) -> dict:
    import yaml

    with config_path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        _fail(f"неожиданный формат YAML: {config_path}")
    return data


def _print_current_state(ort) -> None:
    package, version = _ort_package_info()
    print(f"[tune] onnxruntime: пакет={package!r} версия={version}")
    try:
        providers = list(ort.get_available_providers())
    except Exception as exc:  # noqa: BLE001 - диагностический вызов
        print(f"[tune] get_available_providers() не удалось: {exc}")
        providers = []
    print(f"[tune] доступные провайдеры: {providers}")
    if DML_PROVIDER in providers:
        print("[tune] DirectML ДОСТУПЕН")
    else:
        print("[tune] DirectML НЕ ДОСТУПЕН (нужен пакет onnxruntime-directml)")

    config_path = _rapidocr_config_path()
    print(f"[tune] config.yaml: {config_path or 'не найден'}")
    if config_path is None:
        return
    data = _load_yaml(config_path)
    global_cfg = data.get("Global") or {}
    det_cfg = data.get("Det") or {}
    cls_cfg = data.get("Cls") or {}
    rec_cfg = data.get("Rec") or {}
    rec_keys_path = (data.get("Rec") or {}).get("rec_keys_path", "")
    print("[tune] текущие значения:")
    print(f"  Global.use_cls              = {global_cfg.get('use_cls')}")
    print(f"  Global.intra_op_num_threads = {global_cfg.get('intra_op_num_threads')}")
    print(f"  Det.use_dml                 = {det_cfg.get('use_dml')}")
    print(f"  Det.limit_side_len          = {det_cfg.get('limit_side_len')}")
    print(f"  Det.limit_type              = {det_cfg.get('limit_type')}")
    print(f"  Cls.use_dml                 = {cls_cfg.get('use_dml')}")
    print(f"  Rec.use_dml                 = {rec_cfg.get('use_dml')}")
    print(f"  Rec.rec_keys_path           = {rec_keys_path!r}")

    needed: list[str] = []
    for section, patch in TARGET_YAML_PATCH.items():
        current = data.get(section) or {}
        for key, value in patch.items():
            if current.get(key) != value:
                needed.append(f"{section}.{key}: {current.get(key)!r} -> {value!r}")
    if needed:
        print("[tune] требуется патч YAML:")
        for item in needed:
            print(f"  {item}")
    else:
        print("[tune] YAML уже настроен по цели — патч не требуется")


def _ensure_dml_provider(ort) -> None:
    providers = list(ort.get_available_providers())
    if DML_PROVIDER in providers:
        print("[tune] DmlExecutionProvider уже доступен, установка не требуется")
        return

    package, version = _ort_package_info()
    print(f"[tune] DML недоступен. Замена пакета: {package} -> onnxruntime-directml")
    if not version:
        _fail("не удалось определить версию onnxruntime для замены")

    def _pip(*args: str) -> None:
        cmd = [sys.executable, "-m", "pip", *args]
        print(f"[tune] $ {' '.join(cmd)}")
        completed = subprocess.run(cmd, check=False, capture_output=True, text=True)
        if completed.returncode == 0:
            if completed.stdout:
                print(completed.stdout.rstrip())
            return
        combined = f"{completed.stdout or ''}\n{completed.stderr or ''}"
        if "No module named pip" in combined:
            # venv без pip (создан uv): ставим pip через ensurepip и повторяем раз.
            print("[tune] pip отсутствует в venv — устанавливаю через ensurepip")
            bootstrap = subprocess.run(
                [sys.executable, "-m", "ensurepip", "--upgrade"],
                check=False,
                capture_output=True,
                text=True,
            )
            if bootstrap.returncode != 0:
                raise RuntimeError(
                    f"ensurepip не смог поставить pip в venv: "
                    f"{(bootstrap.stderr or '').strip()[-300:]}"
                )
            retry = subprocess.run(cmd, check=False, capture_output=True, text=True)
            if retry.returncode != 0:
                raise RuntimeError(
                    f"pip завершился с кодом {retry.returncode} после ensurepip: "
                    f"{(retry.stderr or '').strip()[-300:]}"
                )
            if retry.stdout:
                print(retry.stdout.rstrip())
            return
        raise RuntimeError(
            f"pip завершился с кодом {completed.returncode}: {combined.strip()[-300:]}"
        )

    if package != "onnxruntime":
        print(f"[tune] Пакет {package!r} не похож на onnxruntime — не трогаем его, "
              "попытаемся установить onnxruntime-directml поверх (возможны конфликты)")
    else:
        _pip("uninstall", "-y", "onnxruntime")

    # onnxruntime-directml выпускается в sustained engineering: релизы есть
    # только до 1.24.4. Если точной версии нет — ставим последнюю доступную
    # <1.25. Требование numpy<2.1 для 1.24.x уже выполняется в рантайме (1.26).
    try:
        _pip("install", "--no-deps", f"onnxruntime-directml=={version}")
    except RuntimeError:
        print(f"[tune] точной версии {version} нет у onnxruntime-directml — "
              "ставлю последнюю <1.25")
        _pip("install", "--no-deps", "onnxruntime-directml<1.25")
    import importlib.metadata as md

    try:
        md.distribution("onnxruntime-directml")
    except md.PackageNotFoundError:
        _fail("onnxruntime-directml не установлен после pip install")
    dist = md.distribution("onnxruntime-directml")
    print(f"[tune] установлен onnxruntime-directml {dist.version}")
    print("[tune] ВАЖНО: после замены пакета перезапустите рантайм N.E.K.O")


def _patch_yaml(config_path: Path) -> None:
    import yaml

    data = _load_yaml(config_path)
    changed = False
    for section, patch in TARGET_YAML_PATCH.items():
        if not isinstance(data.get(section), dict):
            data[section] = {}
        for key, value in patch.items():
            if data[section].get(key) != value:
                data[section][key] = value
                changed = True

    if not changed:
        print("[tune] YAML уже соответствует целевым значениям — правка не требуется")
        return

    backup = config_path.with_name(config_path.name + ".bak-directml")
    if not backup.exists():
        shutil.copy2(config_path, backup)
        print(f"[tune] создан бэкап: {backup}")
    else:
        print(f"[tune] бэкап уже существует, не трогаю: {backup}")

    tmp = config_path.with_name(config_path.name + ".tmp-tune")
    with tmp.open("w", encoding="utf-8") as handle:
        yaml.safe_dump(data, handle, sort_keys=False, allow_unicode=True)
    os.replace(tmp, config_path)
    print(f"[tune] patched: {config_path}")


def _verify_in_process(ort) -> None:
    """Проверка в текущем процессе: провайдеры сессии + латентность прогона."""
    print("[tune] === верификация: прогон RapidOCR с новой конфигурацией ===")
    config_path = _rapidocr_config_path()
    if config_path is None:
        print("[tune] SKIP: rapidocr_onnxruntime не найден")
        return
    try:
        import numpy as np  # type: ignore
        from PIL import Image  # type: ignore

        from rapidocr_onnxruntime import RapidOCR  # type: ignore
    except ImportError as exc:
        print(f"[tune] SKIP: не удалось импортировать RapidOCR: {exc}")
        return

    started_at = time.monotonic()
    runtime = RapidOCR()
    load_elapsed = max(0.0, time.monotonic() - started_at)

    det_session = getattr(getattr(getattr(runtime, "text_det", None), "infer", None), "session", None)
    get_providers = getattr(det_session, "get_providers", None)
    providers: list[str] = []
    if callable(get_providers):
        try:
            providers = [str(p) for p in (get_providers() or [])]
        except Exception as exc:  # noqa: BLE001
            print(f"[tune] get_providers() на сессии детектора не удалось: {exc}")
    print(f"[tune] время создания рантайма: {load_elapsed:.2f}s")
    print(f"[tune] фактические провайдеры сессии детектора: {providers}")

    frame = np.asarray(Image.new("RGB", (640, 360), "white"))
    infer_started_at = time.monotonic()
    try:
        runtime(frame, use_cls=False)
    except Exception as exc:  # noqa: BLE001 - на пустом кадре допустимы ошибки postprocess
        print(f"[tune] inference на пустом кадре завершился ошибкой (не критично): {exc}")
        return
    infer_elapsed = max(0.0, time.monotonic() - infer_started_at)
    print(f"[tune] латентность одного OCR-прогона (пустой кадр): {infer_elapsed * 1000:.0f}ms")

    if DML_PROVIDER in providers:
        print("[tune] УСПЕХ: инференс идёт через DirectML (GPU)")
    elif CPU_PROVIDER in providers:
        print("[tune] ВНИМАНИЕ: сессия откатилась на CPU. Проверьте, доступен ли DML в этом интерпретаторе.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true", help="только диагностика")
    group.add_argument("--apply", action="store_true", help="установка DML + патч YAML + верификация")
    group.add_argument("--verify", action="store_true", help="верификация в этом процессе (новый интерпретатор)")
    args = parser.parse_args()

    _require_windows()
    ort = _import_onnxruntime()

    if args.check:
        _print_current_state(ort)
        print("[tune] режим --check завершён, ничего не изменено")
        return

    if args.verify:
        _print_current_state(ort)
        _verify_in_process(ort)
        return

    _print_current_state(ort)
    _ensure_dml_provider(ort)
    config_path = _rapidocr_config_path()
    if config_path is None:
        _fail("config.yaml пакета rapidocr_onnxruntime не найден — патч пропущен")
    _patch_yaml(config_path)
    # Верификация в НОВОМ процессе: текущий держит старую native-DLL в памяти.
    print("[tune] запуск верификации в новом процессе...")
    verify = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--verify"],
        check=False,
    )
    if verify.returncode != 0:
        print("[tune] верификация завершилась с ошибкой", file=sys.stderr)
        sys.exit(verify.returncode)
    print("[tune] --apply завершён. Перезапустите рантайм N.E.K.O, чтобы подхватить новые библиотеки.")


if __name__ == "__main__":
    main()
