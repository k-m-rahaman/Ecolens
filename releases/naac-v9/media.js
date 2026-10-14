export function cameraConstraints({deviceId,facingMode='environment'}={}){
 return {video:{...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:facingMode}}),width:{ideal:960},height:{ideal:720},frameRate:{ideal:24,max:30}},audio:false};
}
export function captureGeometry(width,height,{scene='single',maxEdge=960}={}){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('IMAGE_INVALID');
 if(scene==='group'){
  const scale=Math.min(1,maxEdge/Math.max(width,height));
  return {x:0,y:0,w:width,h:height,width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
 }
 const side=Math.min(width,height)*.78;
 return {x:(width-side)/2,y:(height-side)/2,w:side,h:side,width:640,height:640};
}
export async function decodePhoto(file,{maxEdge=960,maxPixels=50000000,scope=globalThis}={}){
 let image,url;
 try{
  if(typeof scope.createImageBitmap==='function'){
   try{image=await scope.createImageBitmap(file);}catch{/* Some mobile formats need native Image decoding. */}
  }
  if(!image){
   if(typeof scope.Image!=='function')throw new Error('IMAGE_UNSUPPORTED');
   url=scope.URL.createObjectURL(file);image=new scope.Image();image.decoding='async';
   await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('IMAGE_INVALID'));image.src=url;});
  }
  const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight;
  if(!width||!height||width*height>maxPixels)throw new Error('IMAGE_TOO_LARGE');
  const scale=Math.min(1,maxEdge/Math.max(width,height));
  const canvas=scope.document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  return canvas;
 }finally{image?.close?.();if(url)scope.URL.revokeObjectURL(url);}
}
