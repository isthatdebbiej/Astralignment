"""Bounded subprocess output and cancellable full video validation."""
import subprocess
import threading
import time

def inspect_video(filename, cancelled=None, timeout=600):
    import av
    deadline=time.monotonic()+timeout
    with av.open(str(filename), options={"err_detect":"explode"}) as container:
        if not container.streams.video:
            raise ValueError("No video stream")
        stream=container.streams.video[0]
        stream.codec_context.thread_count=1
        if stream.codec_context.width*stream.codec_context.height>7680*4320:
            raise ValueError("Video exceeds supported decoded-frame dimensions")
        count=0
        for frame in container.decode(stream):
            if cancelled is not None and cancelled.is_set():
                raise ValueError("Media validation cancelled")
            if time.monotonic()>deadline:
                raise ValueError("Media validation timed out")
            count+=1
            if count>1000000:
                raise ValueError("Video exceeds frame admission limit")
        if count==0:
            raise ValueError("No decodable video frames")
        duration=float(stream.duration*stream.time_base) if stream.duration is not None and stream.time_base is not None else None
        return {"frames":count,"duration":duration}

def run_media(command, cancelled=None, timeout=600):
    process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    buffers=[bytearray(),bytearray()]
    overflow=threading.Event()
    def drain(pipe,index):
        while True:
            block=pipe.read(4096)
            if not block:break
            if len(buffers[index])+len(block)>1024*1024:
                overflow.set()
            else:buffers[index].extend(block)
        pipe.close()
    threads=[threading.Thread(target=drain,args=(pipe,index),daemon=True) for index,pipe in enumerate((process.stdout,process.stderr))]
    for thread in threads:thread.start()
    deadline=time.monotonic()+timeout
    try:
        while process.poll() is None:
            if overflow.is_set():raise ValueError("Media command exceeded its output limit")
            if cancelled is not None and cancelled.is_set():raise ValueError("Media validation cancelled")
            if time.monotonic()>deadline:raise ValueError("Media validation timed out")
            time.sleep(.05)
        if process.returncode!=0:raise ValueError(bytes(buffers[1]).decode(errors="replace")[:2000] or "Media decode failed")
        return bytes(buffers[0])
    finally:
        if process.poll() is None:process.kill()
        process.wait()
        for thread in threads:thread.join(timeout=2)
