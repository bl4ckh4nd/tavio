"""The speech-to-text settings, in one place so that the worker and the measurements (evals/wake_eval.py) use the same.

Deepgram's Nova-3 takes "Vivo" as a key term and then writes it correctly, which is what the wake word depends on.
"""

from __future__ import annotations

import os

from livekit.plugins import deepgram

# What speech-to-text should spell right. The name first; more words only if the measurements show they help.
KEYTERMS = ["Vivo"]

# Languages a person may speak to the assistant. Measured with the same sentences: each in its own language beats
# "multi" (Nova-3 follows the speaker between languages) clearly for German, which has the most users, and a single
# "de" for everyone loses most English commands. So each person is listened to in the language of their app.
LANGUAGES = {"de", "en", "es", "fr", "multi"}


def language_for(value: str | None) -> str:
    """The language to listen in: the given one when it is one we know, else the configured default."""
    value = (value or "").strip().lower().split("-")[0]
    if value in LANGUAGES:
        return value
    default = os.environ.get("ASSISTANT_LANGUAGE", "de").strip().lower()
    return default if default in LANGUAGES else "de"


def make_stt(language: str | None = None, http_session=None, **overrides) -> deepgram.STT:
    options = dict(
        model=os.environ.get("DEEPGRAM_MODEL", "nova-3"),
        language=language_for(language),
        keyterm=KEYTERMS,
        smart_format=True,
        interim_results=True,
        # Long enough that a sentence arrives whole, short enough that a command is acted on quickly.
        endpointing_ms=600,
    )
    options.update(overrides)
    if http_session is not None:
        options["http_session"] = http_session
    return deepgram.STT(**options)
