"""
Post-processing & Medical NLP (Section 4.2.4 of the synopsis).

- Corrects recognized drug names against a curated dictionary using
  string-similarity (difflib, stdlib - no extra native build dependency,
  unlike python-Levenshtein, which keeps setup simple on Windows/macOS).
- Extracts dosage (e.g. "500 mg") and frequency short-forms (OD/BD/TDS/SOS)
  using simple regex rules, turning free text into structured fields.
"""

import csv
import difflib
import re
from dataclasses import dataclass, field
from typing import List, Optional

FREQUENCY_MAP = {
    "OD": "Once a day",
    "BD": "Twice a day",
    "TDS": "Three times a day",
    "TID": "Three times a day",
    "QID": "Four times a day",
    "SOS": "As needed",
    "HS": "At bedtime",
    "STAT": "Immediately",
}

DOSAGE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(mg|ml|mcg|g|iu)\b", re.IGNORECASE)
FREQUENCY_RE = re.compile(
    r"\b(" + "|".join(FREQUENCY_MAP.keys()) + r")\b", re.IGNORECASE
)
DURATION_RE = re.compile(r"(\d+)\s*(day|days|week|weeks|month|months)\b", re.IGNORECASE)


@dataclass
class ParsedLine:
    raw_text: str
    drug_name: Optional[str] = None
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    duration: Optional[str] = None
    confidence: float = 0.0


def load_drug_dictionary(csv_path: str) -> List[str]:
    names = []
    try:
        with open(csv_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get("name"):
                    names.append(row["name"].strip())
    except FileNotFoundError:
        pass
    return names


def best_drug_match(word: str, dictionary: List[str], threshold: float = 0.72):
    """Return (matched_name, confidence) or (original_word, 0.0) if nothing
    is close enough. Uses difflib's SequenceMatcher ratio as the similarity
    score (a normalized edit-distance-like measure)."""
    if not word:
        return word, 0.0

    matches = difflib.get_close_matches(word, dictionary, n=1, cutoff=threshold)
    if matches:
        ratio = difflib.SequenceMatcher(None, word.lower(), matches[0].lower()).ratio()
        return matches[0], round(ratio, 2)
    return word, 0.0


def parse_line(raw_line: str, drug_dictionary: List[str], threshold: float = 0.72) -> ParsedLine:
    """Turn one recognized line of text into a structured prescription item."""
    line = raw_line.strip()
    if not line:
        return ParsedLine(raw_text=raw_line)

    dosage_match = DOSAGE_RE.search(line)
    dosage = f"{dosage_match.group(1)}{dosage_match.group(2)}" if dosage_match else None

    freq_match = FREQUENCY_RE.search(line)
    frequency = freq_match.group(1).upper() if freq_match else None

    duration_match = DURATION_RE.search(line)
    duration = f"{duration_match.group(1)} {duration_match.group(2)}" if duration_match else None

    # Whatever is left after stripping dosage/frequency/duration tokens is
    # treated as the candidate drug name.
    candidate = line
    for m in (dosage_match, freq_match, duration_match):
        if m:
            candidate = candidate.replace(m.group(0), "")
    candidate = candidate.strip(" -,.\t")
    first_word = candidate.split(" ")[0] if candidate else ""

    matched_name, confidence = best_drug_match(first_word, drug_dictionary, threshold)

    return ParsedLine(
        raw_text=raw_line,
        drug_name=matched_name or first_word,
        dosage=dosage,
        frequency=frequency,
        duration=duration,
        confidence=confidence,
    )


def parse_prescription_text(raw_text: str, drug_dictionary: List[str], threshold: float = 0.72) -> List[ParsedLine]:
    lines = [l for l in raw_text.splitlines() if l.strip()]
    return [parse_line(l, drug_dictionary, threshold) for l in lines]
