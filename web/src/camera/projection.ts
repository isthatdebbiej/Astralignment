import type { CameraCalibration } from '../../../contracts/index';
import { createFloorMapping, type Point2 } from './homography';

type V3=[number,number,number];
const dot=(a:V3,b:V3)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const scale=(a:V3,s:number)=>a.map(n=>n*s) as V3;
const length=(a:V3)=>Math.hypot(...a);
const cross=(a:V3,b:V3):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(a:V3)=>{const n=length(a);if(n<1e-9)throw new Error('Degenerate camera axes');return scale(a,1/n);};

/** Estimated pinhole lens: centered principal point, square pixels, no distortion.
 * Combined WORLD -> clip matrix; use an identity Three.Camera world transform.
 * Elevated geometry depends on the assumed vertical FOV, not just the measured floor.
 */
export function estimateCameraProjection(calibration:CameraCalibration,verticalFovDegrees:number,options:{near?:number;far?:number}={}) {
  if(!Number.isFinite(verticalFovDegrees)||verticalFovDegrees<15||verticalFovDegrees>140)throw new Error('Vertical FOV must be 15–140 degrees');
  const iw=calibration.frame_width,ih=calibration.frame_height;
  if(!Number.isFinite(iw)||!Number.isFinite(ih)||iw<=0||ih<=0)throw new Error('Calibration frame dimensions are required');
  const near=options.near??.05,far=options.far??1000;
  if(!(near>0&&far>near&&Number.isFinite(far)))throw new Error('Invalid clipping planes');
  const h=createFloorMapping(calibration.corners,calibration.width,calibration.depth).worldToImage;
  const fy=.5/Math.tan(verticalFovDegrees*Math.PI/360),fx=fy*ih/iw;
  const kInverse=(a:V3):V3=>[(a[0]-.5*a[2])/fx,(a[1]-.5*a[2])/fy,a[2]];
  let a=kInverse([h[0],h[3],h[6]]),b=kInverse([h[1],h[4],h[7]]),t=kInverse([h[2],h[5],h[8]]);
  const multiplier=(t[2]<0?-1:1)*2/(length(a)+length(b));
  a=scale(a,multiplier);b=scale(b,multiplier);t=scale(t,multiplier);
  const r1=unit(a),r2=unit(b.map((n,i)=>n-dot(b,r1)*r1[i]) as V3),r3=unit(cross(r1,r2));
  const cameraPosition:V3=[-dot(r1,t),-dot(r2,t),-dot(r3,t)];
  if(cameraPosition[2]<=.01)throw new Error('Calibration faces below the floor. Check corner order and fixed camera.');
  const rowX:V3=[r1[0],r2[0],r3[0]],rowY:V3=[r1[1],r2[1],r3[1]],rowZ:V3=[r1[2],r2[2],r3[2]];
  const A=(far+near)/(far-near),B=-2*far*near/(far-near);
  const rows=[ [...scale(rowX,2*fx),2*fx*t[0]], [...scale(rowY,-2*fy),-2*fy*t[1]], [...scale(rowZ,A),A*t[2]+B], [...rowZ,t[2]] ];
  const worldToClip=Array.from({length:16},(_,i)=>rows[i%4][Math.floor(i/4)]);
  const project=(point:V3):Point2=>{
    const z=dot(rowZ,point)+t[2];if(z<=near)throw new Error('Floor is behind or too close to the estimated camera');
    return [fx*(dot(rowX,point)+t[0])/z+.5,fy*(dot(rowY,point)+t[1])/z+.5];
  };
  const world:V3[]=[[-calibration.width/2,-calibration.depth/2,0],[calibration.width/2,-calibration.depth/2,0],[calibration.width/2,calibration.depth/2,0],[-calibration.width/2,calibration.depth/2,0]];
  const squared=world.reduce((sum,p,i)=>{const uv=project(p);return sum+((uv[0]-calibration.corners[i][0])*iw)**2+((uv[1]-calibration.corners[i][1])*ih)**2;},0);
  return {worldToClip,cameraPosition,reprojectionRmsPixels:Math.sqrt(squared/4),assumedVerticalFovDegrees:verticalFovDegrees,project};
}

/** Exact contain letterbox; apply the same rectangle to video and transparent overlay. */
export function containVideoRect(containerWidth:number,containerHeight:number,imageWidth:number,imageHeight:number){
  if(![containerWidth,containerHeight,imageWidth,imageHeight].every(n=>Number.isFinite(n)&&n>0))throw new Error('Positive video and container dimensions required');
  const factor=Math.min(containerWidth/imageWidth,containerHeight/imageHeight),width=imageWidth*factor,height=imageHeight*factor;
  return {x:(containerWidth-width)/2,y:(containerHeight-height)/2,width,height};
}

/** Lens estimate from floor consistency. A flat fit is ambiguous, never a measured lens. */
export function fitCameraProjection(calibration:CameraCalibration) {
  const samples:ReturnType<typeof estimateCameraProjection>[]=[];
  for(let fov=15;fov<=120;fov+=1)try{samples.push(estimateCameraProjection(calibration,fov));}catch{/* invalid pose */}
  if(!samples.length)throw new Error('No above-floor camera fits these ordered corners');
  samples.sort((a,b)=>a.reprojectionRmsPixels-b.reprojectionRmsPixels);
  let best=samples[0];
  for(let fov=Math.max(15,best.assumedVerticalFovDegrees-1);fov<=Math.min(120,best.assumedVerticalFovDegrees+1);fov+=.05){try{const p=estimateCameraProjection(calibration,fov);if(p.reprojectionRmsPixels<best.reprojectionRmsPixels)best=p;}catch{/* invalid pose */}}
  const distant=samples.filter(p=>Math.abs(p.assumedVerticalFovDegrees-best.assumedVerticalFovDegrees)>=10);
  const contrast=distant.length?Math.min(...distant.map(p=>p.reprojectionRmsPixels))-best.reprojectionRmsPixels:0;
  const fitWeak=contrast<.5||best.assumedVerticalFovDegrees<16||best.assumedVerticalFovDegrees>119;
  // An almost flat family of lenses has no identifiable optimum; stable labeled default.
  if(contrast<.5)best=estimateCameraProjection(calibration,60);
  return {...best,estimatedFovDegrees:best.assumedVerticalFovDegrees,fitWeak};
}
