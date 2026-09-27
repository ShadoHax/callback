// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TargetAR } from '../src/components/ar/target-ar';
vi.mock('../src/lib/target-detector', () => ({ loadTargetDetector: vi.fn().mockResolvedValue({}), detectForeground: vi.fn().mockResolvedValue({status:'absent',message:'Hold steady'}), detectTarget:vi.fn(), detectTargets:vi.fn(), targetClass:()=>null, targetCropRect:vi.fn() }));
vi.mock('../src/lib/opencv-browser', () => ({loadOpenCV:vi.fn().mockResolvedValue({})}));
vi.mock('../src/lib/ar-target-tracker', () => ({createArTargetTracker:vi.fn()}));
vi.mock('../src/components/ar/object-overlay', () => ({ObjectOverlay:()=>null}));
afterEach(() => {cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();});
it('serializes live rear-camera recognition even without a COCO box, then stops on unmount', async () => {
  vi.useFakeTimers();
  const stop=vi.fn(); const getUserMedia=vi.fn().mockResolvedValue({getTracks:()=>[{stop}]});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia}});
  vi.stubGlobal('ResizeObserver', class {observe(){} disconnect(){}});
  vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
  Object.defineProperty(HTMLVideoElement.prototype,'videoWidth',{configurable:true,get:()=>640});
  Object.defineProperty(HTMLVideoElement.prototype,'videoHeight',{configurable:true,get:()=>480});
  const drawImage=vi.fn(); let sceneOffset=0;
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(() => ({drawImage,fillRect:vi.fn(),getImageData:(_x:number,_y:number,w:number,h:number)=>{
    const data=new Uint8ClampedArray(w*h*4); for(let i=0;i<data.length;i+=4){const value=((i/4)%2?70:170)+sceneOffset;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;}
    return {data,width:w,height:h};
  }}) as never);
  vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>callback(new Blob(['video-frame'],{type:'image/jpeg'})));
  let finishFirst!:()=>void;
  const onDetectedFrame=vi.fn().mockImplementationOnce(()=>new Promise<void>(resolve=>{finishFirst=resolve;})).mockResolvedValue(undefined);
  const mounted=render(<TargetAR target="" generalScan onDetectedFrame={onDetectedFrame} />);
  await act(async()=>{await vi.advanceTimersByTimeAsync(150);});
  await act(async()=>{await vi.advanceTimersByTimeAsync(1600);});
  expect(getUserMedia).toHaveBeenCalledWith({video:{facingMode:{ideal:'environment'}},audio:false});
  expect(onDetectedFrame).toHaveBeenCalledTimes(1);
  expect(onDetectedFrame).toHaveBeenCalledWith(expect.any(Blob),0,'scene');
  expect(drawImage.mock.calls.some(args=>args[0] instanceof HTMLVideoElement)).toBe(true);
  sceneOffset=40;
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
  expect(onDetectedFrame).toHaveBeenCalledTimes(1);
  await act(async()=>{finishFirst(); await vi.advanceTimersByTimeAsync(400);});
  expect(onDetectedFrame).toHaveBeenCalledTimes(2);
  mounted.unmount(); expect(stop).toHaveBeenCalled();
});
