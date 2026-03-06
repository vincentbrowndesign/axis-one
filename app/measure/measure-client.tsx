"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type FormState = "Out of Control" | "In Rhythm" | "In Control";
type SignalState = "Chaotic" | "Reactive" | "Clean";
type EnergyState = "Off" | "On" | "High";

type MotionSample = {
t: number;
motion: number;
};

type Reading = {
form: FormState;
signal: SignalState;
energy: EnergyState;
transitions: number;
windows: number;
charge: number;
storedCharge: number;
startedAt: number;
endedAt: number;
};

const STORAGE_KEY = "axis_sessions_v1";
const CHARGE_KEY = "axis_charge_v1";

function magnitude(x:number,y:number,z:number){
return Math.sqrt(x*x + y*y + z*z)
}

function variance(values:number[]){
if(values.length===0) return 0
const mean = values.reduce((a,b)=>a+b,0)/values.length
return values.reduce((sum,v)=>sum + (v-mean)*(v-mean),0)/values.length
}

function getStoredCharge(){
if(typeof window==="undefined") return 0
const raw = localStorage.getItem(CHARGE_KEY)
return raw ? Number(raw) : 0
}

function setStoredCharge(v:number){
if(typeof window==="undefined") return
localStorage.setItem(CHARGE_KEY,String(v))
}

function saveSession(r:Reading){
if(typeof window==="undefined") return
const raw = localStorage.getItem(STORAGE_KEY)
const sessions = raw ? JSON.parse(raw) : []
sessions.unshift(r)
localStorage.setItem(STORAGE_KEY,JSON.stringify(sessions))
}

function computeReading(samples:MotionSample[],started:number,ended:number):Reading{

const motions = samples.map(s=>{
const deadZone = 1.2
return s.motion < deadZone ? 0 : s.motion
})

const totalMotion = motions.reduce((a,b)=>a+b,0)
const avgMotion = motions.length ? totalMotion/motions.length : 0

let transitions = 0
let windows = 0

const threshold = Math.max(2.5,avgMotion*1.8)

let prevAbove=false
let lastWindow=-9999

for(let i=0;i<motions.length;i++){

const motion = motions[i]
const t = samples[i]?.t ?? 0

const above = motion>threshold

if(above && !prevAbove){

transitions++

if(t-lastWindow>500){
windows++
}

lastWindow=t
}

prevAbove=above
}

const motionVar = variance(motions)

let energy:EnergyState="Off"

if(totalMotion>2000) energy="High"
else if(totalMotion>500) energy="On"

let form:FormState="In Rhythm"
let signal:SignalState="Reactive"

if(energy==="Off"){
form="In Control"
signal="Clean"
transitions=0
windows=0
}
else{

if(motionVar>18 && transitions>4){
form="Out of Control"
}
else if(motionVar<6 && transitions>=1){
form="In Control"
}

if(windows<=1 && transitions<=1){
signal="Clean"
}
else if(motionVar>14 || transitions>10){
signal="Chaotic"
}
else{
signal="Reactive"
}

}

const base =
totalMotion*0.02 +
transitions*0.8 +
windows*0.6

const formMult =
form==="Out of Control"?0.9:
form==="In Rhythm"?1:
1.1

const signalMult =
signal==="Chaotic"?0.9:
signal==="Reactive"?1:
1.1

const charge = Math.max(
1,
Math.round(base*formMult*signalMult)
)

const storedCharge = getStoredCharge() + charge

return{
form,
signal,
energy,
transitions,
windows,
charge,
storedCharge,
startedAt:started,
endedAt:ended
}
}

export default function MeasureClient(){

const [isLive,setIsLive]=useState(false)
const [reading,setReading]=useState<Reading|null>(null)
const [storedCharge,setStoredChargeState]=useState(0)
const [elapsed,setElapsed]=useState(0)

const samplesRef = useRef<MotionSample[]>([])
const startedRef = useRef<number>(0)
const motionHandler = useRef<((e:DeviceMotionEvent)=>void)|null>(null)

useEffect(()=>{
setStoredChargeState(getStoredCharge())
},[])

useEffect(()=>{

if(!isLive) return

const timer=setInterval(()=>{
setElapsed(Date.now()-startedRef.current)
},100)

return ()=>clearInterval(timer)

},[isLive])

async function startLive(){

samplesRef.current=[]
startedRef.current=Date.now()
setElapsed(0)
setReading(null)

if(
typeof DeviceMotionEvent!=="undefined" &&
typeof (DeviceMotionEvent as any).requestPermission==="function"
){
const res=await (DeviceMotionEvent as any).requestPermission()

if(res!=="granted") return
}

motionHandler.current=(e:DeviceMotionEvent)=>{

const ax = e.accelerationIncludingGravity?.x ?? 0
const ay = e.accelerationIncludingGravity?.y ?? 0
const az = e.accelerationIncludingGravity?.z ?? 0

const gx = e.rotationRate?.alpha ?? 0
const gy = e.rotationRate?.beta ?? 0
const gz = e.rotationRate?.gamma ?? 0

const aMag = magnitude(ax,ay,az)
const gMag = magnitude(gx,gy,gz)/50

const motion = aMag + gMag

samplesRef.current.push({
t:Date.now()-startedRef.current,
motion
})
}

window.addEventListener("devicemotion",motionHandler.current,true)

setIsLive(true)
}

function stopLive(){

if(motionHandler.current){
window.removeEventListener("devicemotion",motionHandler.current,true)
}

const ended = Date.now()

const r = computeReading(
samplesRef.current,
startedRef.current,
ended
)

setStoredCharge(r.storedCharge)
setStoredChargeState(r.storedCharge)

saveSession(r)

setReading(r)
setIsLive(false)
}

function format(ms:number){
const s=Math.floor(ms/1000)
const m=Math.floor(s/60)
const sec=s%60
return `${m}:${sec.toString().padStart(2,"0")}`
}

const batteryFill = useMemo(()=>{
return Math.min(
100,
Math.round((storedCharge/500)*100)
)
},[storedCharge])

return(
<div style={{padding:30,fontFamily:"sans-serif"}}>

<h1>Axis Measure</h1>

<h3>Stored Charge</h3>

<div
style={{
width:220,
height:20,
border:"1px solid white",
marginBottom:10
}}
>
<div
style={{
width:`${batteryFill}%`,
height:"100%",
background:"limegreen"
}}
/>
</div>

<p>{storedCharge}</p>

{!isLive &&
<button onClick={startLive}>
On
</button>
}

{isLive &&
<div>
<p>LIVE</p>
<p>{format(elapsed)}</p>

<button onClick={stopLive}>
Off
</button>
</div>
}

{reading &&
<div style={{marginTop:30}}>

<h2>Reading</h2>

<p>Form: {reading.form}</p>
<p>Signal: {reading.signal}</p>
<p>Energy: {reading.energy}</p>

<p>Transitions: {reading.transitions}</p>
<p>Windows: {reading.windows}</p>

<p>Charge +{reading.charge}</p>
<p>Stored Charge {reading.storedCharge}</p>

</div>
}

</div>
)
}