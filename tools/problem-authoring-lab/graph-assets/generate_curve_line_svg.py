import argparse
import hashlib
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_number(value: object, name: str) -> float:
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    return float(value)


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a deterministic curve/line intersection SVG.")
    parser.add_argument("--spec", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--preview-png")
    args = parser.parse_args()

    spec_path = Path(args.spec).resolve()
    output_path = Path(args.output).resolve()
    metadata_path = Path(args.metadata).resolve()
    spec_bytes = spec_path.read_bytes()
    spec = json.loads(spec_bytes)
    if spec.get("schemaVersion") != "curve-line-graph-v1" or spec.get("style") != "monochrome-exam":
        raise ValueError("unsupported graph spec")

    a = safe_number(spec["curve"]["a"], "curve.a")
    b = safe_number(spec["curve"]["b"], "curve.b")
    c = safe_number(spec["curve"]["c"], "curve.c")
    m = safe_number(spec["line"]["m"], "line.m")
    line_b = safe_number(spec["line"]["b"], "line.b")
    if a == 0:
        raise ValueError("curve.a must not be zero")
    discriminant = (b - m) ** 2 - 4 * a * (c - line_b)
    if discriminant <= 0:
        raise ValueError("the graphs must have two distinct real intersections")
    roots = sorted([
        (-(b - m) - math.sqrt(discriminant)) / (2 * a),
        (-(b - m) + math.sqrt(discriminant)) / (2 * a),
    ])
    points = [(x, m * x + line_b) for x in roots]

    domain = spec["domain"]
    x_min = safe_number(domain["xMin"], "domain.xMin")
    x_max = safe_number(domain["xMax"], "domain.xMax")
    y_min = safe_number(domain["yMin"], "domain.yMin")
    y_max = safe_number(domain["yMax"], "domain.yMax")
    if not (x_min < roots[0] < roots[1] < x_max and y_min < y_max):
        raise ValueError("domain must contain both intersections")

    matplotlib.rcParams.update({
        "font.family": "DejaVu Sans",
        "font.size": 10,
        "svg.fonttype": "path",
        "svg.hashsalt": str(spec["id"]),
    })
    x_values = np.linspace(x_min, x_max, 700)
    curve_values = a * x_values ** 2 + b * x_values + c
    line_values = m * x_values + line_b
    figure, axis = plt.subplots(figsize=(6.4, 4.2), constrained_layout=True)
    figure.patch.set_facecolor("white")
    axis.set_facecolor("white")
    axis.plot(x_values, curve_values, color="#111111", linewidth=2.0, label=str(spec["curve"]["label"]))
    axis.plot(x_values, line_values, color="#4b5563", linewidth=1.7, linestyle=(0, (6, 3)), label=str(spec["line"]["label"]))
    axis.scatter([point[0] for point in points], [point[1] for point in points], s=42, facecolor="white", edgecolor="#111111", linewidth=1.6, zorder=5)
    labels = spec["intersectionLabels"]
    if not isinstance(labels, list) or len(labels) != 2 or not all(isinstance(label, str) and label for label in labels):
        raise ValueError("intersectionLabels must contain two names")
    for index, ((x_value, y_value), label) in enumerate(zip(points, labels)):
        axis.annotate(label, (x_value, y_value), xytext=((-14, -18) if index == 0 else (8, 8)), textcoords="offset points", fontsize=11, fontweight="bold")

    axis.spines["left"].set_position("zero")
    axis.spines["bottom"].set_position("zero")
    axis.spines["right"].set_visible(False)
    axis.spines["top"].set_visible(False)
    axis.spines["left"].set_linewidth(1.1)
    axis.spines["bottom"].set_linewidth(1.1)
    axis.set_xlim(x_min, x_max)
    axis.set_ylim(y_min, y_max)
    axis.set_xticks(range(math.ceil(x_min), math.floor(x_max) + 1))
    axis.set_yticks(range(math.ceil(y_min), math.floor(y_max) + 1, 2))
    axis.tick_params(axis="both", colors="#374151", labelsize=9, length=4)
    axis.grid(True, color="#d1d5db", linewidth=0.55, alpha=0.65)
    axis.set_axisbelow(True)
    axis.text(x_max - 0.15, -0.65, "x", fontsize=11, fontstyle="italic")
    axis.text(0.16, y_max - 0.65, "y", fontsize=11, fontstyle="italic")
    axis.legend(loc="upper left", frameon=False, fontsize=10)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, format="svg", metadata={"Date": None, "Creator": "Study Forge problem-authoring lab"})
    if args.preview_png:
        preview_path = Path(args.preview_png).resolve()
        preview_path.parent.mkdir(parents=True, exist_ok=True)
        figure.savefig(preview_path, format="png", dpi=160, facecolor="white")
    plt.close(figure)
    svg_bytes = output_path.read_bytes()
    metadata_path.write_text(json.dumps({
        "assetId": spec["id"],
        "mimeType": "image/svg+xml",
        "generator": "python-matplotlib",
        "generatorVersion": matplotlib.__version__,
        "scriptPath": "tools/problem-authoring-lab/graph-assets/generate_curve_line_svg.py",
        "specPath": "tools/problem-authoring-lab/fixtures/graph-one-spec.json",
        "specSha256": sha256(spec_bytes),
        "sha256": sha256(svg_bytes),
        "intersections": [{"label": label, "x": x_value, "y": y_value} for label, (x_value, y_value) in zip(labels, points)],
    }, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
