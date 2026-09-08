export type CameraConnection = { stop(options?: { notifyPeer?: boolean }): void };
export async function connectCamera(token: string, role: 'phone' | 'viewer', stream: MediaStream | null, onStream: (stream: MediaStream) => void, onStatus: (status: string) => void): Promise<CameraConnection> {
  const response = await fetch('/api/camera/config', { method: 'GET', headers: { Authorization: `Bearer ${token}` }, referrerPolicy: 'same-origin' });
  if (!response.ok) throw new Error('Pairing expired or unauthorized. Create a new pairing link.');
  const config = await response.json();
  let stopped = false, ws: WebSocket, pc: RTCPeerConnection, retry: ReturnType<typeof setTimeout> | undefined, attempts = 0;
  const connect = () => {
    if (stopped) return;
    onStatus('Connecting');
    pc = new RTCPeerConnection({ iceServers: config.iceServers });
    const pending: RTCIceCandidateInit[] = [];
    if (stream) stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.ontrack = event => onStream(event.streams[0] || new MediaStream([event.track]));
    pc.onconnectionstatechange = () => {
      onStatus(pc.connectionState === 'connected' ? 'Live' : pc.connectionState);
      if (pc.connectionState === 'failed' && ws.readyState === WebSocket.OPEN) ws.close(4000, 'Retry media connection');
    };
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/camera?token=${encodeURIComponent(token)}&role=${role}`);
    const send = (value: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); };
    pc.onicecandidate = event => { if (event.candidate) send({ type: 'candidate', candidate: event.candidate.toJSON() }); };
    let offering = false;
    const offer = async () => { if (role !== 'phone' || offering) return; offering = true; try { if (pc.signalingState !== 'stable') await pc.setLocalDescription({type:'rollback'}); await pc.setLocalDescription(await pc.createOffer({iceRestart:true})); send({ type: 'offer', sdp: pc.localDescription!.sdp }); } finally { offering = false; } };
    ws.onmessage = async event => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'ready') { attempts = 0; onStatus('Waiting for peer'); if (message.peerConnected) await offer(); }
        if (message.type === 'peer-connected') { if (role === 'phone') await offer(); }
        if (message.type === 'offer' || message.type === 'answer') {
          await pc.setRemoteDescription({ type: message.type, sdp: message.sdp });
          for (const candidate of pending.splice(0)) await pc.addIceCandidate(candidate);
          if (message.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); send({ type: 'answer', sdp: pc.localDescription!.sdp }); }
        }
        if (message.type === 'candidate' && message.candidate) { if (pc.remoteDescription) await pc.addIceCandidate(message.candidate); else pending.push(message.candidate); }
        if (message.type === 'peer-disconnected') { onStatus('Peer disconnected — waiting for reconnect'); if (role === 'viewer') { pc.close(); ws.close(); } }
        if (message.type === 'stop') { stopped = true; clearTimeout(retry); stream?.getTracks().forEach(track => track.stop()); onStatus('Stopped by peer'); pc.close(); ws.close(); }
      } catch (error) { onStatus(`Connection error: ${String(error)}`); }
    };
    ws.onclose = event => { pc.close(); if (stopped) return; if (event.code === 4003 || event.code === 4001 || event.code === 1008) { onStatus(event.reason || 'Pairing unavailable or expired. Create a new pairing.'); stream?.getTracks().forEach(track => track.stop()); return; } onStatus('Disconnected — retrying'); retry = setTimeout(connect, Math.min(10_000, 1500 * ++attempts)); };
    ws.onerror = () => onStatus('Signaling unavailable; verify HTTPS and pairing link');
  };
  connect();
  return { stop(options) { stopped = true; clearTimeout(retry); if (options?.notifyPeer !== false && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' })); ws.close(); pc.close(); stream?.getTracks().forEach(track => track.stop()); onStatus('Stopped'); } };
}
