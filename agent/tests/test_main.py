from tavio_assistant.main import leave_reason

MIN = 60.0


def test_stays_while_it_is_used_and_leaves_when_nobody_has_asked_for_a_while():
    assert leave_reason(now=19 * MIN, started=0, last_used=0, idle_s=20 * MIN, max_s=120 * MIN) is None
    assert leave_reason(now=21 * MIN, started=0, last_used=0, idle_s=20 * MIN, max_s=120 * MIN) is not None
    assert leave_reason(now=90 * MIN, started=0, last_used=80 * MIN, idle_s=20 * MIN, max_s=120 * MIN) is None


def test_leaves_after_the_longest_stay_even_while_used():
    assert leave_reason(now=121 * MIN, started=0, last_used=120 * MIN, idle_s=20 * MIN, max_s=120 * MIN) is not None
