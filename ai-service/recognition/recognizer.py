"""
Handwriting recognition engine.

The synopsis proposes a CNN + BiLSTM + CTC deep-learning model trained on
prescription-style handwriting (Section 4.2.3). Training that model needs a
labelled dataset (IAM + a purpose-built prescription dataset) and a GPU, which
is outside the scope of a starter codebase.

This module is written so that part can be dropped in later without touching
the rest of the app:

  1. BaselineRecognizer  -> works right now, uses Tesseract OCR
                             (the synopsis lists Tesseract as the fallback/
                             comparison baseline in Section 2.1 and the tools
                             table).
  2. CRNNRecognizer       -> stub showing exactly where to load a trained
                             CNN-BiLSTM-CTC Keras/PyTorch model and how its
                             predict() output should be shaped, so the rest
                             of the pipeline (drug_correction.py, app.py)
                             does not need to change when you plug it in.

Set RECOGNIZER = "crnn" in app.py once you have a trained model checkpoint.
"""

from abc import ABC, abstractmethod

import pytesseract
from PIL import Image


class BaseRecognizer(ABC):
    @abstractmethod
    def recognize(self, image_path: str) -> str:
        """Return recognized raw text for the given image path."""
        raise NotImplementedError


class BaselineRecognizer(BaseRecognizer):
    """Tesseract-based baseline. Works out of the box once the Tesseract
    binary is installed on the machine (see README setup steps)."""

    def __init__(self, tesseract_cmd: str = None):
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

    def recognize(self, image_path: str) -> str:
        image = Image.open(image_path)
        # --psm 6: assume a uniform block of text (works reasonably for a
        # prescription pad photo). --oem 3: default LSTM OCR engine.
        config = "--oem 3 --psm 6"
        text = pytesseract.image_to_string(image, config=config)
        return text.strip()


class CRNNRecognizer(BaseRecognizer):
    """Placeholder for the CNN + BiLSTM + CTC model described in the
    synopsis (Section 4.2.3). Fill this in once a model is trained:

        self.model = keras.models.load_model("path/to/model.h5")
        ...
        preds = self.model.predict(preprocessed_word_images)
        text = ctc_decode(preds)

    Keeping the same recognize(image_path) -> str signature means nothing
    else in the app has to change.
    """

    def __init__(self, model_path: str = None):
        self.model_path = model_path
        self.model = None  # load your trained model here

    def recognize(self, image_path: str) -> str:
        if self.model is None:
            raise NotImplementedError(
                "CRNNRecognizer.model is not loaded yet. Train the CNN-BiLSTM-CTC "
                "model described in the synopsis and load it in __init__, or use "
                "BaselineRecognizer in the meantime."
            )
        # segmentation -> per-word inference -> CTC decode -> join -> return
        raise NotImplementedError


def get_recognizer(kind: str = "baseline", **kwargs) -> BaseRecognizer:
    if kind == "baseline":
        return BaselineRecognizer(**kwargs)
    if kind == "crnn":
        return CRNNRecognizer(**kwargs)
    raise ValueError(f"Unknown recognizer kind: {kind}")
