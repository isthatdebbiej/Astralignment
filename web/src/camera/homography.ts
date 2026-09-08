/** Planar ground mapping only. Images use normalized coordinates; world uses centered XY meters. */
export type Point2 = [number, number];
export type Homography = [number, number, number, number, number, number, number, number, number];
export function transformPoint(h: Homography, [x,y]: Point2): Point2 {
  if (![x,y].every(Number.isFinite)) throw new Error('Point must be finite');
  const z = h[6]*x + h[7]*y + h[8];
  if (!Number.isFinite(z) || Math.abs(z) < 1e-10) throw new Error('Point lies on projective horizon');
  return [(h[0]*x + h[1]*y + h[2])/z, (h[3]*x + h[4]*y + h[5])/z];
}
function solve(source: Point2[], target: Point2[]): Homography {
  const a: number[][] = [];
  source.forEach(([x,y], i) => { const [u,v] = target[i]; a.push([x,y,1,0,0,0,-u*x,-u*y,u], [0,0,0,x,y,1,-v*x,-v*y,v]); });
  for (let col=0; col<8; col++) {
    let pivot=col;
    for (let row=col+1; row<8; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot=row;
    if (Math.abs(a[pivot][col]) < 1e-10) throw new Error('Degenerate floor calibration');
    [a[col],a[pivot]] = [a[pivot],a[col]];
    const scale=a[col][col]; for (let j=col; j<=8; j++) a[col][j]/=scale;
    for (let row=0; row<8; row++) if (row!==col) { const factor=a[row][col]; for(let j=col; j<=8; j++) a[row][j]-=factor*a[col][j]; }
  }
  return [...a.map(row=>row[8]),1] as Homography;
}
export function createFloorMapping(corners: Point2[], width: number, depth: number) {
  if (!Number.isFinite(width) || !Number.isFinite(depth) || width<=0 || depth<=0 || corners.length!==4 || !corners.every(p=>p.length===2 && p.every(n=>Number.isFinite(n)&&n>=0&&n<=1))) throw new Error('Invalid floor dimensions or normalized corners');
  const turns=corners.map((p,i)=>{const q=corners[(i+1)%4],r=corners[(i+2)%4];return (q[0]-p[0])*(r[1]-q[1])-(q[1]-p[1])*(r[0]-q[0]);});
  if (!turns.every(n=>n>0.0001) && !turns.every(n=>n< -0.0001)) throw new Error('Floor corners must form a convex quadrilateral in order');
  const world: Point2[]=[[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2]];
  const imageToWorld=solve(corners,world), worldToImage=solve(world,corners);
  return { imageToWorld, worldToImage, toWorld: (point: Point2)=>transformPoint(imageToWorld,point), toImage: (point: Point2)=>transformPoint(worldToImage,point) };
}
