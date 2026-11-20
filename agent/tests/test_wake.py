import pytest

from tavio_assistant.wake import CommandCollector, find_command, find_wake, hears_wake


def test_finds_the_command_after_the_wake_word():
    assert find_command("Vivo, schreib aufs Whiteboard: Release am 3. Dezember.") == "schreib aufs Whiteboard: Release am 3. Dezember."
    assert find_command("Okay, Vivo bitte notier das") == "bitte notier das"
    assert find_command("Hey Vivo, notier bitte die drei Punkte.") == "notier bitte die drei Punkte."
    assert find_command("Äh, Vivo, schreib auf: Rückmeldung bis Montag.") == "schreib auf: Rückmeldung bis Montag."


def test_the_wake_word_last_makes_what_came_before_the_command():
    assert find_command("Notier das bitte, Vivo.") == "Notier das bitte"
    assert find_command("Notier das bitte Vivo.") == "Notier das bitte"
    assert find_command("Kannst du das bitte mal aufschreiben, Vivo?") == "Kannst du das bitte mal aufschreiben"
    # Only the sentence it ends, and a number's full stop is not the end of one.
    assert find_command("Wir sind fertig. Schreib auf: Release am 3. Dezember, Vivo.") == "Schreib auf: Release am 3. Dezember"
    assert find_wake("Notier das bitte, Vivo.").kind == "end"


def test_addressed_in_the_middle_of_the_sentence_joins_both_halves():
    wake = find_wake("Kannst du, Vivo, bitte die Zahlen notieren?")
    assert wake.kind == "middle"
    assert wake.command == "Kannst du bitte die Zahlen notieren"


def test_a_mention_in_the_middle_is_not_a_strong_wake():
    # It still goes on (the model decides, brain.py), but it does not light up "heard you".
    for talk in ["Gestern hat Vivo das richtig gut gemacht.", "Ich habe Vivo gestern ausprobiert, das war nützlich.", "Die Vivo Smartphones sind beliebt."]:
        wake = find_wake(talk)
        assert wake is not None and wake.kind == "middle" and not wake.strong, talk
        assert not hears_wake(talk)
    assert hears_wake("Vivo, fass zusammen")
    assert hears_wake("Mach das rückgängig, Vivo")
    assert not hears_wake("Wir reden über das Video")


def test_hears_the_usual_mishearings_and_ignores_other_talk():
    for heard in ["Wiwo, fass zusammen", "Viwo fass zusammen", "vivo: fass zusammen", "Vi vo, fass zusammen", "Vi-vo, fass zusammen", "Bivo, fass zusammen", "Vivó, fass zusammen"]:
        assert find_command(heard) == "fass zusammen", heard
    # Speech-to-text writes the name right (it is a key term), so other words are not widened into it.
    for talk in ["Wir reden über das Video von gestern", "Viva la vida", "Vivaldi läuft im Hintergrund", "Das ist eine FIFO-Queue", "Die Vivos kommen",
                 "Vivo's Idee war gut", "Das Vivo-Handy ist neu", "Vito kommt später", "Wie wo war das?", "Vivi macht das"]:
        assert find_command(talk) is None, talk


def test_wake_word_alone_waits_for_the_next_sentence():
    assert find_command("Vivo.") == ""
    assert find_command("Okay, Vivo.") == ""


def test_collects_a_command_said_in_several_pieces():
    c = CommandCollector(quiet_open_s=1.5, quiet_done_s=1.0)
    c.feed("lena", "Lena", "Vivo, schreib aufs Whiteboard", now=0.0)
    c.feed("lena", "Lena", "Release am dritten Dezember", now=1.0)
    assert c.due(now=2.0) == []
    [cmd] = c.due(now=2.6)
    assert cmd.speaker == "Lena"
    assert cmd.speaker_id == "lena"
    assert cmd.command == "schreib aufs Whiteboard Release am dritten Dezember"
    assert cmd.heard == "Vivo, schreib aufs Whiteboard Release am dritten Dezember"
    assert c.due(now=10) == []


def test_a_finished_sentence_is_acted_on_sooner_than_an_unfinished_one():
    c = CommandCollector(quiet_open_s=1.5, quiet_done_s=1.0)
    c.feed("lena", "Lena", "Vivo, mach das rückgängig.", now=0.0)
    assert c.due(now=0.9) == []
    assert len(c.due(now=1.05)) == 1
    c.feed("jonas", "Jonas", "Vivo, schreib auf", now=5.0)
    assert c.due(now=6.2) == []
    assert len(c.due(now=6.6)) == 1


def test_wake_word_then_a_pause_then_the_command():
    c = CommandCollector()
    c.feed("lena", "Lena", "Vivo.", now=0.0)
    assert c.due(now=3.0) == []
    c.feed("lena", "Lena", "Mach das rückgängig", now=4.0)
    [cmd] = c.due(now=6.0)
    assert cmd.command == "Mach das rückgängig"
    assert cmd.heard == "Vivo. Mach das rückgängig"


def test_a_lone_wake_word_expires():
    c = CommandCollector()
    c.feed("lena", "Lena", "Vivo", now=0.0)
    assert c.due(now=9.0) == []
    c.feed("lena", "Lena", "Wir machen weiter", now=10.0)
    assert c.due(now=12.0) == []


def test_other_speakers_do_not_join_a_command():
    c = CommandCollector()
    c.feed("lena", "Lena", "Vivo, notier", now=0.0)
    c.feed("jonas", "Jonas", "Ich hab Hunger", now=0.5)
    [cmd] = c.due(now=2.0)
    assert cmd.command == "notier"


def test_a_sentence_ending_in_the_name_is_complete_and_takes_nothing_after_it():
    c = CommandCollector()
    c.feed("lena", "Lena", "Notier das bitte, Vivo.", now=0.0, span=(0.0, 2.0))
    c.feed("lena", "Lena", "Und dann der nächste Punkt.", now=0.5, span=(2.2, 3.5))
    [cmd] = c.due(now=2.0)
    assert cmd.command == "Notier das bitte"
    assert cmd.kind == "end"


def test_talk_after_a_finished_command_is_left_out_by_the_real_pause_not_by_when_it_arrived():
    # The second sentence arrives late because it is long; what counts is how long the speaker was silent before it.
    c = CommandCollector(join_done_s=1.2)
    c.feed("lena", "Lena", "Vivo, notier die Zahlen.", now=1.0, span=(0.0, 1.0))
    c.feed("lena", "Lena", "Dann kommen wir zum nächsten Punkt, der Planung für das nächste Jahr.", now=8.0, span=(2.5, 7.5))
    [cmd] = c.due(now=9.0)
    assert cmd.command == "notier die Zahlen."
    # Straight after (a short real pause), it still belongs to the command.
    c.feed("lena", "Lena", "Vivo, notier die Zahlen.", now=20.0, span=(10.0, 11.0))
    c.feed("lena", "Lena", "Und die Termine.", now=21.0, span=(11.5, 12.5))
    [cmd] = c.due(now=23.0)
    assert cmd.command == "notier die Zahlen. Und die Termine."


def test_an_unfinished_sentence_waits_longer_for_the_rest():
    c = CommandCollector(join_open_s=3.0)
    c.feed("lena", "Lena", "Vivo, leg eine Aufgabe an", now=1.0, span=(0.0, 1.0))
    c.feed("lena", "Lena", "Anna bucht den Raum.", now=5.0, span=(3.5, 5.0))
    [cmd] = c.due(now=7.0)
    assert cmd.command == "leg eine Aufgabe an Anna bucht den Raum."


def test_the_answer_to_a_question_counts_without_the_name():
    c = CommandCollector()
    c.expect_followup("lena", now=0.0, window_s=10)
    c.feed("jonas", "Jonas", "Release auf Montag", now=1.0)
    assert c.due(now=3.0) == []
    c.feed("lena", "Lena", "Release auf Montag verschieben.", now=2.0)
    [cmd] = c.due(now=4.0)
    assert (cmd.speaker, cmd.command, cmd.kind) == ("Lena", "Release auf Montag verschieben.", "follow")
    # Used up: ordinary talk afterwards is ordinary talk.
    c.feed("lena", "Lena", "Und noch was anderes", now=5.0)
    assert c.due(now=8.0) == []


def test_the_window_for_an_answer_closes():
    c = CommandCollector()
    c.expect_followup("lena", now=0.0, window_s=10)
    c.feed("lena", "Lena", "Release auf Montag", now=11.0)
    assert c.due(now=14.0) == []


def test_the_same_command_heard_twice_through_another_microphone_runs_once():
    c = CommandCollector(dedupe_s=5)
    c.feed("lena", "Lena", "Vivo, notier die Zahlen", now=0.0)
    c.feed("jonas", "Jonas", "Vivo, notier die Zahlen.", now=0.3)
    assert len(c.due(now=2.0)) == 1


def test_the_echo_is_found_even_when_the_words_differ_a_little():
    c = CommandCollector(dedupe_s=5)
    c.feed("lena", "Lena", "Vivo, notier die Zahlen", now=0.0)
    c.feed("jonas", "Jonas", "Vivo, notiere die Zahlen.", now=0.3)
    assert len(c.due(now=2.0)) == 1


def test_a_person_saying_the_same_again_is_not_taken_for_an_echo():
    # After "that did not work" people repeat themselves at once, and it has to work.
    c = CommandCollector(dedupe_s=5)
    c.feed("lena", "Lena", "Vivo, fass zusammen", now=0.0)
    assert len(c.due(now=2.0)) == 1
    c.feed("lena", "Lena", "Vivo, fass zusammen", now=4.0)
    assert len(c.due(now=6.0)) == 1


def test_two_different_commands_at_the_same_time_both_run():
    c = CommandCollector()
    c.feed("lena", "Lena", "Vivo, notier die Zahlen", now=0.0)
    c.feed("jonas", "Jonas", "Vivo, mach das rückgängig", now=0.3)
    assert len(c.due(now=2.0)) == 2


@pytest.mark.parametrize("text,now", [("", 0.0), ("   ", 0.0)])
def test_empty_text_changes_nothing(text, now):
    c = CommandCollector()
    c.feed("lena", "Lena", text, now=now)
    assert not c.pending()


def test_speech_that_is_still_going_on_keeps_the_command_open():
    # The second half of the sentence is still being said when the quiet time of the first would be up.
    c = CommandCollector(quiet_done_s=0.9)
    c.feed("lena", "Lena", "Vivo, schreib aufs Whiteboard.", now=1.0, span=(0.0, 1.0))
    c.activity("lena", now=1.6, span=(1.3, 1.8))   # a half-finished transcript of the next words
    assert c.due(now=2.0) == []
    c.activity("lena", now=2.4, span=(1.3, 2.9))
    assert c.due(now=3.1) == []
    c.feed("lena", "Lena", "Release am dritten Dezember.", now=3.5, span=(1.3, 3.4))
    [cmd] = c.due(now=4.5)
    assert cmd.command == "schreib aufs Whiteboard. Release am dritten Dezember."


def test_talk_after_a_real_pause_does_not_hold_the_command_back():
    c = CommandCollector(quiet_done_s=0.9, join_done_s=1.2)
    c.feed("lena", "Lena", "Vivo, mach das rückgängig.", now=1.0, span=(0.0, 1.0))
    c.activity("lena", now=1.7, span=(3.5, 3.8))   # starts 2.5 s after: other talk
    [cmd] = c.due(now=1.95)
    assert cmd.command == "mach das rückgängig."


def test_other_people_talking_does_not_hold_it_back_either():
    c = CommandCollector(quiet_done_s=0.9)
    c.feed("lena", "Lena", "Vivo, mach das rückgängig.", now=1.0, span=(0.0, 1.0))
    c.activity("jonas", now=1.5, span=(1.1, 1.4))
    assert len(c.due(now=1.95)) == 1


def test_the_command_says_when_it_was_spoken():
    c = CommandCollector()
    c.feed("lena", "Lena", "Vivo, schreib auf", now=1.0, wall=100.0)
    c.feed("lena", "Lena", "Release am Montag.", now=2.0, wall=102.0)
    [cmd] = c.due(now=4.0)
    assert (cmd.started_wall, cmd.ended_wall) == (100.0, 102.0)


def test_words_that_follow_straight_on_after_a_command_that_has_just_gone_on_are_the_rest_of_it():
    # The recogniser's second half arrives while the model is still working on the first.
    c = CommandCollector(quiet_done_s=1.2, join_done_s=1.2)
    c.feed("lena", "Lena", "Vivo, schreib aufs Whiteboard.", now=1.0, span=(0.0, 1.0), wall=10.0)
    [first] = c.due(now=2.3)
    assert first.command == "schreib aufs Whiteboard."
    c.feed("lena", "Lena", "Release am dritten Dezember.", now=4.0, span=(1.5, 3.0), wall=13.0)
    [rest] = c.due(now=5.5)
    assert (rest.kind, rest.command, rest.started_wall) == ("continue", "Release am dritten Dezember.", 13.0)


def test_talk_after_a_real_pause_is_not_the_rest_of_a_command():
    c = CommandCollector(quiet_done_s=1.2, join_done_s=1.2)
    c.feed("lena", "Lena", "Vivo, mach das rückgängig.", now=1.0, span=(0.0, 1.0))
    c.due(now=2.3)
    c.feed("lena", "Lena", "Und jetzt etwas ganz anderes.", now=6.0, span=(4.0, 5.5))
    assert c.due(now=8.0) == []


def test_only_the_same_person_and_only_once():
    c = CommandCollector()
    c.feed("lena", "Lena", "Vivo, schreib aufs Whiteboard.", now=1.0, span=(0.0, 1.0))
    c.due(now=2.3)
    c.feed("jonas", "Jonas", "Release am Montag.", now=3.0, span=(1.5, 2.5))
    assert c.due(now=5.0) == []
    c.feed("lena", "Lena", "Release am Montag.", now=3.5, span=(1.5, 2.5))
    assert len(c.due(now=5.0)) == 1
    # Not twice for the same pause: what comes after a real pause is something else again.
    c.feed("lena", "Lena", "Und noch etwas.", now=9.0, span=(6.0, 6.5))
    assert c.due(now=11.0) == []


def test_the_rest_of_a_command_is_only_taken_for_a_while():
    c = CommandCollector(continue_s=30)
    c.feed("lena", "Lena", "Vivo, schreib aufs Whiteboard.", now=1.0, span=(0.0, 1.0))
    c.due(now=2.3)
    c.feed("lena", "Lena", "Release am Montag.", now=60.0, span=(1.5, 2.5))
    assert c.due(now=62.0) == []


def test_knows_while_an_answer_to_its_question_may_still_come():
    collector = CommandCollector()
    assert not collector.awaiting_answer(100.0)
    collector.expect_followup("lena", 100.0)
    assert collector.awaiting_answer(110.0)
    assert not collector.awaiting_answer(116.0)
