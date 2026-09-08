import math
import platform
from types import SimpleNamespace

import pytest

from sim.dimos_bridge import AstralignmentBridge, admitted_twist
from sim.dimos_status import availability


def message(linear, angular=(0, 0, 0)):
    # Pure admission-unit fixture, explicitly not a native DimOS message.
    return SimpleNamespace(linear=SimpleNamespace(x=linear[0], y=linear[1], z=linear[2]),
                           angular=SimpleNamespace(x=angular[0], y=angular[1], z=angular[2]))


def test_missing_native_runtime_is_not_emulated():
    status = availability()
    assert status["active"] is False
    if platform.system() != "Linux":
        assert status["ready"] is False
        assert AstralignmentBridge is None


def test_native_velocity_admission_helper():
    assert admitted_twist(message([.3, .4, 0])) == [.3, .4]
    for linear, angular in [([math.nan, 0, 0], [0, 0, 0]), ([.8, 0, 0], [0, 0, 0]),
                            ([0, 0, .1], [0, 0, 0]), ([0, 0, 0], [0, 0, .1])]:
        with pytest.raises(ValueError):
            admitted_twist(message(linear, angular))
