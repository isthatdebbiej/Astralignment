"""Internal HTTP gateway to actual DimOS worker + native typed LCM messages.

No model inference, physics, credentials, Docker socket, or host code execution.
HTTP control is trusted-network-only and disabled until POST /control.
"""
import copy
import json
import math
import os
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .dimos_status import availability


def native_pose_wire_type():
    from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
    from dimos_lcm.geometry_msgs import PoseStamped as WirePoseStamped

    class SimulationPoseWire(WirePoseStamped):
        # DimOS includes msg_name in the actual LCM channel string. Generated
        # bindings use a different name; retain the wrapper's exact topic id.
        msg_name = PoseStamped.msg_name

        @classmethod
        def lcm_decode(cls, data):
            # Generated bindings resolve annotated field types on their exact
            # declaring class. Delegate to that class, not inherited cls.
            return WirePoseStamped.lcm_decode(data)
    return SimulationPoseWire


def admitted_commands(payload):
    if not isinstance(payload, dict) or set(payload) != {"commands"}:
        raise ValueError("Expected only a commands object")
    commands = payload["commands"]
    if not isinstance(commands, dict) or set(commands) - {"g1_a", "g1_b"}:
        raise ValueError("Unknown robot id")
    result = {"g1_a": [0., 0.], "g1_b": [0., 0.]}
    for robot_id, velocity in commands.items():
        if not isinstance(velocity, list) or len(velocity) != 2:
            raise ValueError("Commands must be [vx, vy] in world metres/second")
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in velocity):
            raise ValueError("Velocity must be finite numeric XY")
        if math.hypot(*velocity) > .7:
            raise ValueError("Velocity norm exceeds 0.7 m/s")
        result[robot_id] = velocity
    return result


class NativeService:
    def __init__(self, sim_url):
        if not availability()["ready"]:
            raise RuntimeError(availability()["reason"])
        from dimos.core.coordination.module_coordinator import ModuleCoordinator
        from dimos.core.global_config import GlobalConfig
        from dimos.core.transport import LCMTransport
        from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
        from dimos.msgs.geometry_msgs.Twist import Twist
        from dimos.msgs.std_msgs.Int32 import Int32
        from .dimos_bridge import AstralignmentBridge

        self._guard = threading.RLock()
        self._control_guard = threading.Lock()
        self._received = {}
        self._counts = {}
        self._poses = {}
        self._tick = None
        self._transports = []
        self._unsubscribers = []
        self._publishers = {}
        self._Twist = Twist
        wire_pose_type = native_pose_wire_type()
        config = GlobalConfig(n_workers=1)
        self.coordinator = ModuleCoordinator(g=config)
        self.coordinator.start()
        try:
            self.bridge = self.coordinator.deploy(AstralignmentBridge, global_config=config,
                                                  sim_url=sim_url, allow_control=False)
            channels = [("g1_a_pose", PoseStamped), ("g1_b_pose", PoseStamped),
                        ("world_tick", Int32), ("g1_a_command", Twist), ("g1_b_command", Twist)]
            for name, message_type in channels:
                # The module's transport is serialized to the separate DimOS worker.
                self.bridge.set_transport(name, LCMTransport("/astra/"+name, message_type))
                # DimOS 0.0.12's convenience PoseStamped.lcm_decode turns a
                # legitimate zero timestamp into time.time(). Decode the same
                # native wire schema directly, preserving epoch-zero sim time.
                wire_type = wire_pose_type if name.endswith("_pose") else message_type
                local = LCMTransport("/astra/"+name, wire_type)
                self._transports.append(local)
                if name.endswith("_command"):
                    self._publishers[name.removesuffix("_command")] = local
                else:
                    self._unsubscribers.append(local.subscribe(lambda msg, n=name: self._receive(n, msg)))
            self.coordinator.start_all_modules()
        except BaseException:
            self.close()
            raise

    def _receive(self, name, message):
        with self._guard:
            self._received[name] = time.monotonic()
            self._counts[name] = self._counts.get(name, 0)+1
            if name == "world_tick":
                self._tick = int(message.data)
            else:
                p, q = message.pose.position, message.pose.orientation
                self._poses[name.removesuffix("_pose")] = {
                    "position": [p.x, p.y, p.z], "quaternion": [q.w, q.x, q.y, q.z],
                    "sim_time": message.header.stamp.sec+message.header.stamp.nsec/1_000_000_000,
                    "frame_id": message.header.frame_id}

    def state(self):
        bridge = self.bridge.status()
        with self._guard:
            ages = {name: time.monotonic()-received for name, received in self._received.items()}
            ready = (len(ages) == 3 and max(ages.values()) < 2 and bridge["error"] is None)
            return {"ready": ready, "version": availability()["version"],
                    "source": "native-lcm-received", "transport": "DimOS LCMTransport",
                    "worker_modules": self.coordinator.n_modules, "bridge": bridge,
                    "received_counts": dict(self._counts), "receive_age_seconds": ages,
                    "tick": self._tick, "robots": copy.deepcopy(self._poses),
                    "atomic_snapshot": False}

    def control(self, enabled):
        if type(enabled) is not bool:
            raise ValueError("enabled must be boolean")
        with self._control_guard:
            return self.bridge.set_control(enabled)

    def commands(self, payload):
        admitted = admitted_commands(payload)
        with self._control_guard:
            if not self.bridge.status()["control_enabled"]:
                raise PermissionError("Enable DimOS control explicitly first")
            for robot_id, velocity in admitted.items():
                self._publishers[robot_id].broadcast(None, self._Twist(linear=[*velocity, 0.], angular=[0., 0., 0.]))
        return {"published": admitted, "source": "native-lcm", "ttl_seconds": .3,
                "acknowledgement": "published; bridge.commands_received proves native receipt"}

    def close(self):
        self.coordinator.stop()
        for unsubscribe in self._unsubscribers:
            if callable(unsubscribe):
                unsubscribe()
        for transport in self._transports:
            transport.stop()


def make_handler(service):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, value):
            body = json.dumps(value, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path not in ("/health", "/state"):
                return self.reply(404, {"error": "Unknown route"})
            try:
                state = service.state()
                self.reply(200 if state["ready"] or self.path == "/state" else 503, state)
            except Exception as exc:
                self.reply(503, {"ready": False, "error": str(exc)})

        def do_POST(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096:
                    return self.reply(413, {"error": "JSON body must be 1..4096 bytes"})
                payload = json.loads(self.rfile.read(length))
                if self.path == "/commands":
                    result = service.commands(payload)
                elif self.path == "/control":
                    if not isinstance(payload, dict) or set(payload) != {"enabled"}:
                        raise ValueError("Expected only enabled boolean")
                    result = service.control(payload["enabled"])
                else:
                    return self.reply(404, {"error": "Unknown route"})
                self.reply(200, result)
            except PermissionError as exc:
                self.reply(409, {"error": str(exc)})
            except (ValueError, TypeError) as exc:
                self.reply(422, {"error": str(exc)})
            except Exception as exc:
                self.reply(503, {"error": str(exc)})

        def log_message(self, fmt, *args):
            if self.path != "/health":
                super().log_message(fmt, *args)
    return Handler


def main():
    service = NativeService(os.environ.get("SIM_URL", "http://sim:8001"))
    server = ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("DIMOS_PORT", "8003"))), make_handler(service))
    def stop(_signum, _frame):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        service.close()


if __name__ == "__main__":
    main()
