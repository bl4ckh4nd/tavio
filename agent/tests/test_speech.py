from tavio_assistant.speech import KEYTERMS, language_for


def test_each_person_is_listened_to_in_the_language_of_their_app():
    assert language_for("de") == "de"
    assert language_for("en") == "en"
    assert language_for("fr-CA") == "fr"
    assert language_for(" ES ") == "es"


def test_an_unknown_or_missing_language_falls_back_to_the_configured_one(monkeypatch):
    monkeypatch.delenv("ASSISTANT_LANGUAGE", raising=False)
    assert language_for(None) == "de"
    assert language_for("tlh") == "de"
    monkeypatch.setenv("ASSISTANT_LANGUAGE", "en")
    assert language_for("") == "en"
    monkeypatch.setenv("ASSISTANT_LANGUAGE", "nonsense")
    assert language_for(None) == "de"


def test_the_name_is_a_key_term():
    assert "Vivo" in KEYTERMS
