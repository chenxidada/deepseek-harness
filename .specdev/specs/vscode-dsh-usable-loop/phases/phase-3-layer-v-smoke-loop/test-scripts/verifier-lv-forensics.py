#!/usr/bin/env python3
"""Independent forensic check of the layer-V smoke artifacts.

Answers one question the harness itself never asks: do the five screenshots
actually carry per-step information, or are they byte-identical copies of the
same frame (i.e. evidence of nothing)?

Usage (from the repository root):
    python3 .specdev/specs/vscode-dsh-usable-loop/phases/phase-3-layer-v-smoke-loop/\
test-scripts/verifier-lv-forensics.py [run-dir ...]

With no arguments the script inspects every archived run under
apps/vscode-dsh/test-artifacts/layer-v/.archive/.
"""

from __future__ import annotations

import glob
import hashlib
import json
import os
import struct
import sys


def png_size(path: str) -> tuple[int, int]:
    """Read width/height from the IHDR chunk without decoding pixels."""
    header = open(path, "rb").read(33)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a PNG: {path}")
    return struct.unpack(">II", header[16:24])


def luma_stats(path: str) -> tuple[float, float, int] | None:
    """(mean luma, stddev of row means, distinct value count) or None without PIL."""
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return None
    image = Image.open(path).convert("L")
    width, height = image.size
    pixels = list(image.getdata())
    mean = sum(pixels) / len(pixels)
    row_means = [sum(pixels[r * width : (r + 1) * width]) / width for r in range(height)]
    row_mean = sum(row_means) / len(row_means)
    row_variance = (sum((m - row_mean) ** 2 for m in row_means) / len(row_means)) ** 0.5
    return round(mean, 2), round(row_variance, 2), len(set(pixels))


def luma_diff(a: list[int], b: list[int]) -> float:
    return round(sum(abs(x - y) for x, y in zip(a, b)) / len(a), 3)


def describe(run_dir: str) -> None:
    name = os.path.basename(run_dir.rstrip("/")) or run_dir
    status_path = os.path.join(run_dir, "layer-v-status.json")
    meta_path = os.path.join(run_dir, "layer-v-report-meta.json")
    conclusion = display_mode = "?"
    try:
        conclusion = json.load(open(status_path)).get("conclusion")
    except OSError:
        pass
    try:
        display_mode = (json.load(open(meta_path)).get("display") or {}).get("mode")
    except OSError:
        pass

    shots = sorted(glob.glob(os.path.join(run_dir, "step-*.png")))
    if not shots:
        return
    digests = [hashlib.md5(open(p, "rb").read()).hexdigest() for p in shots]
    print(f"--- {name}  conclusion={conclusion}  display.mode={display_mode}")
    print(f"    screenshots={len(shots)}  distinct_md5={len(set(digests))}")
    previous: list[int] | None = None
    for path, digest in zip(shots, digests):
        size = png_size(path)
        stats = luma_stats(path)
        delta = "-"
        if stats is not None:
            try:
                from PIL import Image  # type: ignore

                pixels = list(Image.open(path).convert("L").getdata())
            except ImportError:
                pixels = None
            if pixels is not None and previous is not None:
                delta = luma_diff(pixels, previous)
            previous = pixels
        print(
            f"    {os.path.basename(path):34} bytes={os.path.getsize(path):7} "
            f"{size} md5={digest[:16]} mean/rowvar/uniq={stats} luma_diff_vs_prev={delta}"
        )


def main(argv: list[str]) -> int:
    runs = argv[1:]
    if not runs:
        base = os.path.join(
            "apps", "vscode-dsh", "test-artifacts", "layer-v", ".archive"
        )
        runs = sorted(glob.glob(os.path.join(base, "*", "")))
    for run in runs:
        describe(run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
