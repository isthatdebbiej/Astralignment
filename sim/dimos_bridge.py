"""Optional genuine DimOS Module + typed LCM streams for the live simulation.

Pinned API references and Ubuntu setup are in DIMOS.md. This module never
pretends DimOS exists when absent, and never owns or advances physics.
"""
import argparse
import json
import math
import threading
import time
import uuid
from urllib.request import Request, urlopen

from .dimos_status import PINNED_DIMOS_VERSION, availability


def http_json(base_url, path, payload=None):
    body = None if payload is None else json.dumps(payload, allow_nan=False).encode("utf-8")
    request = Request(base_url.rstrip("/")+path, data=body, headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=2) as response:
        return json.loads(response.read())


def admitted_twist(message):
    """The bridge accepts world XY linear velocity only; no root pose writes."""
    vx, vy, vz = float(message.linear.x), float(message.linear.y), float(message.linear.z)
    angular = [float(message.angular.x), float(message.angular.y), float(message.angular.z)]
    if not all(math.isfinite(value) for value in [vx, vy, vz, *angular]):
        raise ValueError("Native command contains a nonfinite velocity")
    if abs(vz) > 1e-9 or any(abs(value) > 1e-9 for value in angular):
        raise ValueError("Bridge accepts world XY velocity; vertical/angular commands are unsupported")
    if math.hypot(vx, vy) > .7:
        raise ValueError("Native command exceeds 0.7 m/s")
    return [vx, vy]


# No fake replacement Module, Stream, transport, or message class is supplied.
AstralignmentBridge = None
if availability()["ready"]:
    from reactivex.disposable import Disposable

    from dimos.core.core import rpc
    from dimos.core.module import Module, ModuleConfig
    from dimos.core.stream import In, Out
    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
    from dimos.msgs.geometry_msgs.Twist import Twist
    from dimos.msgs.std_msgs.Int32 import Int32

    class AstralignmentBridgeConfig(ModuleConfig):
        sim_url: str = "http://127.0.0.1:8001"
        allow_control: bool = False
        frequency_hz: float = 20.0

    class AstralignmentBridge(Module):
        config: AstralignmentBridgeConfig
        g1_a_pose: Out[PoseStamped]
        g1_b_pose: Out[PoseStamped]
        world_tick: Out[Int32]
        g1_a_command: In[Twist]
        g1_b_command: In[Twist]

        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self._bridge_id = str(uuid.uuid4())
            self._stop = threading.Event()
            self._guard = threading.RLock()
            self._thread = None
            self._commands = {"g1_a": ([0., 0.], 0.), "g1_b": ([0., 0.], 0.)}
            self._stats = {"bridge_id": self._bridge_id, "version": PINNED_DIMOS_VERSION,
                           "source": "dimos-native", "ticks_published": 0, "commands_received": 0,
                           "commands_rejected": 0, "last_sim_tick": 0, "error": None,
                           "control_enabled": self.config.allow_control}

        @rpc
        def start(self):
            self._stop.clear()
            super().start()
            self.register_disposable(Disposable(self.g1_a_command.subscribe(lambda msg: self._accept("g1_a", msg))))
            self.register_disposable(Disposable(self.g1_b_command.subscribe(lambda msg: self._accept("g1_b", msg))))
            if self.config.allow_control:
                http_json(self.config.sim_url, "/run", {"mode": "external"})
            self._thread = threading.Thread(target=self._poll, name="astra-dimos-bridge", daemon=True)
            self._thread.start()

        def _accept(self, robot_id, message):
            with self._guard:
                try:
                    if not self.config.allow_control:
                        raise ValueError("Bridge launched in observation-only mode")
                    self._commands[robot_id] = (admitted_twist(message), time.monotonic())
                    self._stats["commands_received"] += 1
                except ValueError as exc:
                    self._stats["commands_rejected"] += 1
                    self._stats["error"] = str(exc)

        def _poll(self):
            while not self._stop.is_set():
                started = time.monotonic()
                try:
                    state = http_json(self.config.sim_url, "/state")
                    for robot in state["robots"]:
                        w, x, y, z = robot["quaternion"]
                        pose = PoseStamped(frame_id="astra/world", position=robot["position"], orientation=[x, y, z, w])
                        pose.ts = state["sim_time"]
                        getattr(self, robot["id"]+"_pose").publish(pose)
                    self.world_tick.publish(Int32(state["tick"]))
                    with self._guard:
                        self._stats["ticks_published"] += 1
                        self._stats["last_sim_tick"] = state["tick"]
                        self._stats["error"] = None
                        commands = {rid: velocity if started-received < .3 else [0., 0.]
                                    for rid, (velocity, received) in self._commands.items()}
                    if self.config.allow_control and not state["paused"] and state["mode"] == "external":
                        http_json(self.config.sim_url, "/commands", {"commands": commands, "ttl_seconds": .3})
                    http_json(self.config.sim_url, "/dimos/heartbeat", self.status())
                except Exception as exc:
                    with self._guard:
                        self._stats["error"] = str(exc)
                self._stop.wait(max(.005, 1/max(self.config.frequency_hz, 1)-(time.monotonic()-started)))

        @rpc
        def status(self):
            with self._guard:
                return dict(self._stats)

        @rpc
        def stop(self):
            self._stop.set()
            if self._thread:
                self._thread.join(timeout=3)
            if self.config.allow_control:
                try:
                    http_json(self.config.sim_url, "/commands", {"commands": {}, "ttl_seconds": .02})
                except Exception:
                    pass
            super().stop()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sim-url", default="http://127.0.0.1:8001")
    parser.add_argument("--allow-control", action="store_true")
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args()
    status = availability()
    if args.status:
        print(json.dumps(status))
        return
    if not status["ready"] or AstralignmentBridge is None:
        parser.exit(2, status["reason"]+"\n")

    from dimos.core.coordination.module_coordinator import ModuleCoordinator
    from dimos.core.transport import LCMTransport
    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
    from dimos.msgs.geometry_msgs.Twist import Twist
    from dimos.msgs.std_msgs.Int32 import Int32

    coordinator = ModuleCoordinator()
    coordinator.start()
    try:
        bridge = coordinator.deploy(AstralignmentBridge, sim_url=args.sim_url, allow_control=args.allow_control)
        for name, message_type in [("g1_a_pose", PoseStamped), ("g1_b_pose", PoseStamped), ("world_tick", Int32),
                                   ("g1_a_command", Twist), ("g1_b_command", Twist)]:
            getattr(bridge, name).transport = LCMTransport("/astra/"+name, message_type)
        coordinator.start_all_modules()
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        coordinator.stop()


if __name__ == "__main__":
    main()
