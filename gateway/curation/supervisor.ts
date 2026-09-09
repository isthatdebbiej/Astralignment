import {spawn,type ChildProcess} from 'node:child_process';

/** Owns one native worker. Restart only after close, never alongside a dying child. */
export class WorkerSupervisor{
 private child:ChildProcess|undefined;
 private timer:ReturnType<typeof setTimeout>|undefined;
 private stopping=false;
 private failures=0;
 private started=0;
 private status='starting';
 private message='Waiting for the worker to contact the API.';
 constructor(private command:string,private args:string[],private env:NodeJS.ProcessEnv,private delayMs=1000,private maxRestarts=3){}
 get state(){return {status:this.status,message:this.message,can_restart:this.status==='failed',restart_count:this.failures,pid:this.child?.pid??null};}
 start(){
  if(this.stopping||this.child)return;
  this.status='starting';this.started=Date.now();
  const child=spawn(this.command,this.args,{env:this.env,stdio:['pipe','inherit','inherit'],windowsHide:true});this.child=child;
  child.once('spawn',()=>{this.status='running';this.message='Worker process started.';});
  child.once('error',e=>{this.message='Worker could not start: '+e.message;});
  child.once('close',(code,signal)=>{
   this.child=undefined;
   if(this.stopping){this.status='stopped';return;}
   if(Date.now()-this.started>60000)this.failures=0;
   if(this.failures>=this.maxRestarts){this.status='failed';this.message='Worker stopped after bounded restart attempts. Check Python dependencies and logs, then restart the worker.';return;}
   this.failures++;this.status='restarting';this.message=`Worker exited (${signal??code}); retry ${this.failures}/${this.maxRestarts}.`;
   this.timer=setTimeout(()=>{this.timer=undefined;this.start();},this.delayMs*2**(this.failures-1));
  });
 }
 restart(){if(this.status!=='failed')throw new Error('Worker is already active or restarting');this.failures=0;this.start();}
 async stop(){this.stopping=true;if(this.timer)clearTimeout(this.timer);const child=this.child;if(child)await new Promise<void>(resolve=>{child.once('close',()=>resolve());child.kill();});this.status='stopped';}
}
