"""
Image pre-processing pipeline for handwritten prescription images.

Steps (matches Section 4.2.2 of the synopsis):
1. Grayscale conversion
2. Noise removal
3. Skew correction (deskew)
4. Binarization (ink vs paper)
"""

import cv2
import numpy as np


def to_grayscale(image: np.ndarray) -> np.ndarray:
    if len(image.shape) == 2:
        return image
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def remove_noise(gray: np.ndarray) -> np.ndarray:
    return cv2.medianBlur(gray, 3)


def deskew(gray: np.ndarray) -> np.ndarray:
    """Estimate and correct small rotation angles from a phone photo."""
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    if coords.shape[0] < 20:
        return gray  # not enough ink pixels to estimate angle reliably

    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle

    (h, w) = gray.shape[:2]
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(
        gray, matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )
    return rotated


def binarize(gray: np.ndarray) -> np.ndarray:
    """Adaptive threshold works better than a global one on uneven paper lighting."""
    return cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
    )


def preprocess_image(image_path: str) -> np.ndarray:
    """Full pipeline: returns a cleaned, binarized image ready for the
    recognition engine / segmentation step."""
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Could not read image at {image_path}")

    gray = to_grayscale(image)
    denoised = remove_noise(gray)
    deskewed = deskew(denoised)
    binary = binarize(deskewed)
    return binary


def segment_lines(binary_image: np.ndarray, min_line_height: int = 10):
    """Very lightweight line segmentation using horizontal projection profile.
    Returns a list of (y_start, y_end) tuples for each detected text line.
    This is a placeholder for a more robust segmentation model and is used
    to feed individual lines to the recognizer one at a time.
    """
    inverted = 255 - binary_image
    row_sums = np.sum(inverted, axis=1)
    threshold = row_sums.max() * 0.02 if row_sums.max() > 0 else 0

    lines = []
    in_line = False
    start = 0
    for y, value in enumerate(row_sums):
        if value > threshold and not in_line:
            in_line = True
            start = y
        elif value <= threshold and in_line:
            in_line = False
            if y - start >= min_line_height:
                lines.append((start, y))
    if in_line and binary_image.shape[0] - start >= min_line_height:
        lines.append((start, binary_image.shape[0]))

    return lines
