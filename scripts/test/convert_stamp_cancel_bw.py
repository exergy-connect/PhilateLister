#!/usr/bin/env python3
"""Convert a color stamp image to high-contrast B/W for cancel OCR.

The pipeline is tuned for numeral cancel identification:

1. Convert to grayscale.
2. Estimate and remove the stamp/background tone with a broad blur.
3. Stretch contrast using robust percentiles.
4. Smooth small paper/print texture.
5. Apply an adaptive local threshold so dark cancel strokes become black.

Requires Pillow and NumPy.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps, PngImagePlugin

Dpi = tuple[float, float]
DEFAULT_DPI: Dpi = (300.0, 300.0)


@dataclass(frozen=True)
class ProcessingOptions:
    """Image-processing settings for cancel isolation."""

    max_dimension: int | None
    background_radius: int
    smooth_radius: float
    threshold_radius: int
    threshold_bias: float
    low_percentile: float
    high_percentile: float


@dataclass(frozen=True)
class LoadedImage:
    """Input image data and metadata needed for output."""

    gray: Image.Image
    dpi: Dpi


def odd_at_least(value: int, minimum: int = 3) -> int:
    """Return an odd integer greater than or equal to minimum."""

    value = max(value, minimum)
    return value if value % 2 else value + 1


def normalize_dpi(dpi_value: object, assumed_dpi: Dpi) -> Dpi:
    """Return a two-value DPI tuple from Pillow metadata or fallback."""

    if not dpi_value:
        return assumed_dpi
    if isinstance(dpi_value, (int, float)):
        dpi = float(dpi_value)
        return (dpi, dpi)
    if isinstance(dpi_value, tuple) and len(dpi_value) >= 2:
        return (float(dpi_value[0]), float(dpi_value[1]))
    return assumed_dpi


def resize_if_needed(
    image: Image.Image, dpi: Dpi, max_dimension: int | None
) -> tuple[Image.Image, Dpi]:
    """Resize image and DPI if its longest side exceeds max_dimension."""

    if not max_dimension:
        return image, dpi

    width, height = image.size
    longest = max(width, height)
    if longest <= max_dimension:
        return image, dpi

    scale = max_dimension / longest
    new_size = (round(width * scale), round(height * scale))
    scaled_dpi = (dpi[0] * scale, dpi[1] * scale)
    return image.resize(new_size, Image.Resampling.LANCZOS), scaled_dpi


def percentile_stretch(
    values: np.ndarray, low_percentile: float, high_percentile: float
) -> np.ndarray:
    """Stretch image values to full 8-bit contrast using robust percentiles."""

    low = float(np.percentile(values, low_percentile))
    high = float(np.percentile(values, high_percentile))
    if high <= low:
        return np.clip(values, 0, 255).astype(np.uint8)

    stretched = (values - low) * (255.0 / (high - low))
    return np.clip(stretched, 0, 255).astype(np.uint8)


def local_mean(values: np.ndarray, radius: int) -> np.ndarray:
    """Fast box blur via Pillow; enough for local threshold estimation."""

    source = Image.fromarray(np.clip(values, 0, 255).astype(np.uint8))
    blurred = source.filter(ImageFilter.BoxBlur(radius))
    return np.asarray(blurred, dtype=np.float32)


def load_grayscale_image(
    input_path: Path, max_dimension: int | None, assumed_dpi: Dpi
) -> LoadedImage:
    """Load an image, honor EXIF orientation, resize, and convert to grayscale."""

    with Image.open(input_path) as source:
        dpi = normalize_dpi(source.info.get("dpi"), assumed_dpi)
        image = ImageOps.exif_transpose(source).convert("RGB")
    image, dpi = resize_if_needed(image, dpi, max_dimension)
    # Luminance is a good default for cancel marks because black, gray, and blue
    # cancels should all remain darker than the paper and stamp ink around them.
    return LoadedImage(gray=ImageOps.grayscale(image), dpi=dpi)


def normalize_background(
    gray: Image.Image,
    background_radius: int,
    low_percentile: float,
    high_percentile: float,
) -> Image.Image:
    """Suppress stamp coloration and return a contrast-stretched grayscale image."""

    # A broad blur approximates paper/stamp coloration. Dividing by that estimate
    # suppresses gradual color fields while preserving dark cancel strokes.
    background_radius = max(background_radius, 1)
    background = gray.filter(ImageFilter.GaussianBlur(background_radius))
    gray_values = np.asarray(gray, dtype=np.float32)
    background_values = np.asarray(background, dtype=np.float32)
    normalized = (gray_values / np.maximum(background_values, 1.0)) * 255.0
    normalized = percentile_stretch(normalized, low_percentile, high_percentile)

    return ImageOps.autocontrast(Image.fromarray(normalized), cutoff=0.25)


def smooth_image(image: Image.Image, smooth_radius: float) -> Image.Image:
    """Smooth image texture before thresholding."""

    if smooth_radius <= 0:
        return image
    smoothed = image.filter(ImageFilter.GaussianBlur(smooth_radius))
    return smoothed.filter(ImageFilter.MedianFilter(3))


def adaptive_binary_threshold(
    image: Image.Image, threshold_radius: int, threshold_bias: float
) -> Image.Image:
    """Apply local thresholding and return a black/white grayscale image."""

    threshold_radius = odd_at_least(threshold_radius)
    values = np.asarray(image, dtype=np.float32)
    mean = local_mean(values, threshold_radius)
    threshold = mean - threshold_bias
    binary = np.where(values < threshold, 0, 255).astype(np.uint8)

    # Clean isolated specks without erasing the thicker numeral strokes.
    output = Image.fromarray(binary)
    return output.filter(ImageFilter.MedianFilter(3))


def build_png_metadata(dpi: Dpi) -> PngImagePlugin.PngInfo:
    """Build PNG metadata with exact DPI text fields."""

    png_info = PngImagePlugin.PngInfo()
    png_info.add_text("SourceDPI", f"{dpi[0]:.12g},{dpi[1]:.12g}")
    png_info.add_text("SourceDPIX", f"{dpi[0]:.12g}")
    png_info.add_text("SourceDPIY", f"{dpi[1]:.12g}")
    return png_info


def save_png(
    output: Image.Image, output_path: Path, keep_grayscale: bool, dpi: Dpi
) -> None:
    """Save the processed image as PNG."""

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.suffix.lower() != ".png":
        raise ValueError("Output path must end in .png")

    png_info = build_png_metadata(dpi)
    if keep_grayscale:
        output.save(output_path, optimize=True, dpi=dpi, pnginfo=png_info)
    else:
        output.convert("1", dither=Image.Dither.NONE).save(
            output_path, optimize=True, dpi=dpi, pnginfo=png_info
        )


def convert_stamp_cancel_bw(
    input_path: Path,
    output_path: Path,
    options: ProcessingOptions,
    keep_grayscale: bool,
    assumed_dpi: Dpi,
) -> None:
    """Convert a stamp image to grayscale or true black/white PNG."""

    loaded = load_grayscale_image(input_path, options.max_dimension, assumed_dpi)
    enhanced = normalize_background(
        loaded.gray,
        options.background_radius,
        options.low_percentile,
        options.high_percentile,
    )
    enhanced = smooth_image(enhanced, options.smooth_radius)

    if keep_grayscale:
        output = ImageOps.autocontrast(enhanced, cutoff=0.1)
    else:
        output = adaptive_binary_threshold(
            enhanced, options.threshold_radius, options.threshold_bias
        )

    save_png(output, output_path, keep_grayscale, loaded.dpi)


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""

    parser = argparse.ArgumentParser(
        description=(
            "Convert a color stamp image to high-contrast B/W for numeral "
            "cancel identification."
        )
    )
    parser.add_argument("input", type=Path, help="Source stamp image.")
    parser.add_argument(
        "output",
        type=Path,
        nargs="?",
        help="Output PNG path. Defaults to '<input-stem>_cancel_bw.png'.",
    )
    parser.add_argument(
        "--max-dimension",
        type=int,
        default=2400,
        help=(
            "Resize the longest edge before processing. Use 0 to keep "
            "original size. Default: 2400."
        ),
    )
    parser.add_argument(
        "--background-radius",
        type=int,
        default=35,
        help="Broad blur radius used to remove stamp color/background. Default: 35.",
    )
    parser.add_argument(
        "--smooth-radius",
        type=float,
        default=0.8,
        help="Gaussian smoothing radius before thresholding. Default: 0.8.",
    )
    parser.add_argument(
        "--threshold-radius",
        type=int,
        default=41,
        help="Local threshold box radius. Larger values preserve broader strokes. Default: 41.",
    )
    parser.add_argument(
        "--threshold-bias",
        type=float,
        default=8.0,
        help=(
            "How much darker than local average a pixel must be to become "
            "black. Default: 8.0."
        ),
    )
    parser.add_argument(
        "--low-percentile",
        type=float,
        default=1.0,
        help="Low percentile for contrast stretch. Default: 1.0.",
    )
    parser.add_argument(
        "--high-percentile",
        type=float,
        default=99.2,
        help="High percentile for contrast stretch. Default: 99.2.",
    )
    parser.add_argument(
        "--assumed-dpi",
        type=float,
        default=DEFAULT_DPI[0],
        help="DPI to use when the source image has no DPI metadata. Default: 300.",
    )
    parser.add_argument(
        "--grayscale",
        action="store_true",
        help=(
            "Save smoothed high-contrast grayscale instead of hard "
            "black/white thresholding."
        ),
    )
    return parser.parse_args()


def main() -> None:
    """Run the command-line converter."""

    args = parse_args()
    input_path = args.input
    output_path = args.output or input_path.with_name(f"{input_path.stem}_cancel_bw.png")
    max_dimension = args.max_dimension if args.max_dimension > 0 else None
    assumed_dpi = (args.assumed_dpi, args.assumed_dpi)
    options = ProcessingOptions(
        max_dimension=max_dimension,
        background_radius=args.background_radius,
        smooth_radius=args.smooth_radius,
        threshold_radius=args.threshold_radius,
        threshold_bias=args.threshold_bias,
        low_percentile=args.low_percentile,
        high_percentile=args.high_percentile,
    )

    convert_stamp_cancel_bw(input_path, output_path, options, args.grayscale, assumed_dpi)
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
