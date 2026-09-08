"""Pure facade validation tests; not evidence of native Linux execution."""
import math
import threading
from types import SimpleNamespace
import pytest
from sim.dimos_service import NativeService, admitted_commands


def test_native_http_command_admission_is_strict_and_fills_stop():
    assert admitted_commands({"commands": {"g1_a": [.3, .4]}}) == {
        "g1_a": [.3, .4], "g1_b": [0., 0.]}
    for payload in [None, {}, {"commands": {}, "extra": 1}, {"commands": {"other": [0, 0]}},
                    {"commands": {"g1_a": [True, 0]}}, {"commands": {"g1_a": [math.nan, 0]}},
                    {"commands": {"g1_a": [.7, .1]}}, {"commands": {"g1_a": [0, 0, 0]}}]:
        with pytest.raises(ValueError):
            admitted_commands(payload)


def test_pose_receipt_reads_wire_zero_stamp_without_inventing_wall_time():
    # Shape fixture only; native encode/decode is separately exercised in Linux smoke.
    service = NativeService.__new__(NativeService)
    service._guard = threading.RLock()
    service._received, service._counts, service._poses = {}, {}, {}
    message = SimpleNamespace(
        pose=SimpleNamespace(position=SimpleNamespace(x=1., y=2., z=.8),
                             orientation=SimpleNamespace(w=1., x=0., y=0., z=0.)),
        header=SimpleNamespace(stamp=SimpleNamespace(sec=0, nsec=0), frame_id="astra/world"))
    service._receive("g1_a_pose", message)
    assert service._poses["g1_a"]["sim_time"] == 0.0
    assert service._poses["g1_a"]["position"] == [1., 2., .8]
    assert service._counts == {"g1_a_pose": 1}
