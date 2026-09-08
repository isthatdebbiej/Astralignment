"""Real-container smoke evidence; no mocked DimOS classes or transport.

Default is observation only. --exercise-control is an explicitly mutating
trusted test fixture, not an Astra-generated coordinator or safety proof.
"""
import argparse
import json
import math
import os
import time

from .dimos_bridge import http_json


def wait_for(fn, timeout=20):
    deadline = time.monotonic()+timeout
    last = None
    while time.monotonic() < deadline:
        try:
            last = fn()
            if last:
                return last
        except Exception as exc:
            last = str(exc)
        time.sleep(.1)
    raise AssertionError(f"Timed out waiting for native evidence: {last}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8003")
    parser.add_argument("--sim-url", default=os.environ.get("SIM_URL", "http://sim:8001"))
    parser.add_argument("--exercise-control", action="store_true")
    args = parser.parse_args()
    # Exercise the real native wire codec even if the live world is not at 0.
    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
    from dimos.protocol.pubsub.impl.lcmpubsub import Topic
    from .dimos_service import native_pose_wire_type
    WirePoseStamped = native_pose_wire_type()
    assert str(Topic("/astra/g1_a_pose", WirePoseStamped)) == str(Topic("/astra/g1_a_pose", PoseStamped))
    zero_pose = PoseStamped(frame_id="astra/world")
    zero_pose.ts = 0.0
    zero_wire = WirePoseStamped.lcm_decode(zero_pose.lcm_encode())
    assert zero_wire.header.stamp.sec == 0 and zero_wire.header.stamp.nsec == 0
    native = wait_for(lambda: (s if (s := http_json(args.url, "/state"))["ready"] else None))
    assert native["version"] == "0.0.12" and native["worker_modules"] == 1
    assert native["source"] == "native-lcm-received"
    assert set(native["robots"]) == {"g1_a", "g1_b"}
    first_counts = native["received_counts"]
    def fresh_messages():
        state = http_json(args.url, "/state")
        return state if all(state["received_counts"][key] > count for key, count in first_counts.items()) else None
    fresh = wait_for(fresh_messages)
    sim = http_json(args.sim_url, "/state")
    assert fresh["tick"] <= sim["tick"]
    for robot in sim["robots"]:
        received = fresh["robots"][robot["id"]]
        assert received["frame_id"] == "astra/world"
        assert received["sim_time"] <= sim["sim_time"]
        assert all(math.isfinite(v) for v in received["position"]+received["quaternion"])
        # Exact pose check only when authoritative world was paused throughout.
        if sim["paused"] and fresh["tick"] == sim["tick"]:
            assert received["position"] == robot["position"]
            assert received["quaternion"] == robot["quaternion"]
    evidence = {"test": "native-dimos-observation", "passed": True,
                "native_zero_timestamp_codec": True,
                "counts": fresh["received_counts"], "tick": fresh["tick"],
                "control_enabled": fresh["bridge"]["control_enabled"]}
    if args.exercise_control:
        assert not native["bridge"]["control_enabled"], "Do not interrupt an existing native controller"
        before = http_json(args.sim_url, "/state")
        assert before["paused"], "Control smoke requires operator-paused world"
        initial = before["robots"][0]["position"]
        received_count = native["bridge"]["commands_received"]
        try:
            http_json(args.url, "/control", {"enabled": True})
            seen_command = False
            deadline = time.monotonic()+1.2
            while time.monotonic() < deadline:
                http_json(args.url, "/commands", {"commands": {"g1_a": [.35, 0.], "g1_b": [0., 0.]}})
                state = http_json(args.sim_url, "/state")
                seen_command |= any(abs(v) > .01 for v in state["robots"][0]["command"])
                time.sleep(.08)
            assert seen_command, "Native Twist never reached policy command"
            def expired_commands():
                state = http_json(args.sim_url, "/state")
                return state if all(abs(v) < 1e-9 for r in state["robots"] for v in r["command"]) else None
            after = wait_for(expired_commands, timeout=4)
            stats = http_json(args.url, "/state")["bridge"]
            assert stats["commands_received"] > received_count
            assert after["tick"] > before["tick"]
            displacement = math.dist(initial[:2], after["robots"][0]["position"][:2])
            assert displacement > .01, "Authoritative robot did not move"
            evidence["control_fixture"] = {"source": "trusted-test-fixture-not-Astra", "passed": True,
                "commands_received": stats["commands_received"]-received_count,
                "displacement_m": displacement, "expired_to_zero": True}
        finally:
            http_json(args.url, "/control", {"enabled": False})
            http_json(args.sim_url, "/pause", {})
    print(json.dumps(evidence, sort_keys=True))


if __name__ == "__main__":
    main()
