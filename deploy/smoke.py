"""Read-only container smoke check; run inside the sim container."""
import json
import urllib.request

def get(path):
    with urllib.request.urlopen('http://127.0.0.1:8001' + path, timeout=10) as response:
        return json.load(response)

health = get('/health')
model = get('/model')
state = get('/state')
assert health.get('ok'), health
assert model['episode_id'] == state['episode_id']
assert model['scene_epoch'] == state['scene_epoch']
print(json.dumps({'healthy': True, 'episode_bound': True,
                  'robots': len(state.get('robots', [])),
                  'scene_epoch': state['scene_epoch']}))
