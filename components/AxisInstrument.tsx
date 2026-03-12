'use client';

import React from 'react';
import { labelForEvent, modeLabel, stateColor } from '@/lib/axis-engine';
import { useAxisEngine } from '@/hooks/useAxisEngine';

const BG = '#0B0B0B';
const SURFACE = '#101010';
const TEXT = '#F5F5F5';
const MUTED = '#8D8D8D';
const LINE = '#2A2A2A';
const AXIS_GREEN = '#39FF14';

export default function AxisInstrument() {
const {
videoRef,
canvasRef,
wrapRef,
axisState,
detectionMode,
tilt,
stability,
windowMs,
driftPx,
history,
selectedEvent,
axisShape,
isHolding,
isCapturing,
nextCalibrationKey,
onHoldStart,
endCapture,
resetSession,
setSelectedPoint,
setSelectedEventId,
handleCanvasTap,
} = useAxisEngine();

return (
<main
style={{
minHeight: '100vh',
background: BG,
color: TEXT,
fontFamily: 'Inter, Arial, sans-serif',
}}
>
<div
style={{
width: '100%',
maxWidth: 980,
margin: '0 auto',
padding: '18px 14px 48px',
}}
>
<section
style={{
border: `1px solid ${LINE}`,
background: SURFACE,
}}
>
<div
ref={wrapRef}
style={{
position: 'relative',
aspectRatio: '9 / 16',
background: '#050505',
overflow: 'hidden',
}}
>
<video
ref={videoRef}
playsInline
muted
autoPlay
style={{
position: 'absolute',
inset: 0,
width: '100%',
height: '100%',
objectFit: 'cover',
filter: 'brightness(0.42) contrast(1.05) saturate(0.78)',
transform: 'scaleX(-1)',
}}
/>

<canvas
ref={canvasRef}
onClick={handleCanvasTap}
style={{
position: 'absolute',
inset: 0,
width: '100%',
height: '100%',
cursor: nextCalibrationKey ? 'crosshair' : 'default',
}}
/>

<div
style={{
position: 'absolute',
top: 12,
left: 12,
right: 12,
display: 'flex',
justifyContent: 'space-between',
alignItems: 'center',
pointerEvents: 'none',
}}
>
<div
style={{
color: stateColor(axisState),
fontSize: 13,
letterSpacing: '0.24em',
}}
>
STATE
</div>

<div
style={{
color: detectionMode === 'LOST' ? '#7A7A7A' : '#00FF9C',
fontSize: 12,
letterSpacing: '0.18em',
}}
>
QUALITY {modeLabel(detectionMode)}
</div>
</div>

<div
style={{
position: 'absolute',
left: 16,
bottom: 16,
display: 'grid',
gap: 4,
}}
>
<div
style={{
color: stateColor(axisState),
fontSize: 42,
lineHeight: 1,
fontWeight: 700,
letterSpacing: '-0.04em',
}}
>
{axisState}
</div>

<div
style={{
color: MUTED,
fontSize: 11,
letterSpacing: '0.28em',
}}
>
{detectionMode}
</div>
</div>
</div>

<div
style={{
borderTop: `1px solid ${LINE}`,
display: 'grid',
gridTemplateColumns: '1fr 1fr',
}}
>
{[
['STABILITY', `${Math.round(stability)}%`],
['WINDOW', `${Math.round(windowMs)} ms`],
['BODY AXIS', `${tilt.toFixed(1)}°`],
['DRIFT', `${driftPx.toFixed(1)} px`],
].map(([label, value], index) => (
<div
key={label}
style={{
padding: '18px 14px',
borderRight: index % 2 === 0 ? `1px solid ${LINE}` : undefined,
borderBottom: index < 2 ? `1px solid ${LINE}` : undefined,
}}
>
<div
style={{
color: MUTED,
fontSize: 11,
letterSpacing: '0.24em',
marginBottom: 8,
}}
>
{label}
</div>
<div style={{ fontSize: 28, letterSpacing: '-0.04em' }}>{value}</div>
</div>
))}
</div>

<div
style={{
borderTop: `1px solid ${LINE}`,
padding: 14,
display: 'grid',
gap: 12,
}}
>
<button
onMouseDown={onHoldStart}
onMouseUp={endCapture}
onMouseLeave={endCapture}
onTouchStart={onHoldStart}
onTouchEnd={endCapture}
style={{
appearance: 'none',
border: `1px solid ${isCapturing || isHolding ? AXIS_GREEN : LINE}`,
background: isCapturing ? 'rgba(57,255,20,0.08)' : 'transparent',
color: TEXT,
padding: '18px 16px',
fontSize: 18,
letterSpacing: '0.18em',
}}
>
{isCapturing ? 'CAPTURING' : 'HOLD TO CAPTURE'}
</button>

<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
<button
onClick={resetSession}
style={{
appearance: 'none',
border: `1px solid ${LINE}`,
background: 'transparent',
color: TEXT,
padding: '16px 14px',
fontSize: 14,
letterSpacing: '0.12em',
}}
>
RESET SESSION
</button>

<button
onClick={() =>
setSelectedPoint(
(nextCalibrationKey ?? 'leftBoundary') as
| 'leftBoundary'
| 'rightBoundary'
| 'target'
| 'playerStart'
)
}
style={{
appearance: 'none',
border: `1px solid ${LINE}`,
background: 'transparent',
color: TEXT,
padding: '16px 14px',
fontSize: 14,
letterSpacing: '0.12em',
}}
>
{nextCalibrationKey
? `SET ${nextCalibrationKey.replace(/([A-Z])/g, ' $1').toUpperCase()}`
: 'EDIT CALIBRATION'}
</button>
</div>

<div
style={{
color: MUTED,
fontSize: 12,
letterSpacing: '0.08em',
lineHeight: 1.7,
}}
>
LEFT BOUNDARY • RIGHT BOUNDARY • TARGET • PLAYER START
</div>
</div>
</section>

<section
style={{
marginTop: 18,
border: `1px solid ${LINE}`,
background: SURFACE,
}}
>
<div
style={{
padding: '16px 14px',
borderBottom: `1px solid ${LINE}`,
display: 'flex',
justifyContent: 'space-between',
alignItems: 'center',
}}
>
<div>
<div
style={{
color: MUTED,
fontSize: 11,
letterSpacing: '0.28em',
marginBottom: 6,
}}
>
SESSION
</div>
<div style={{ fontSize: 28, letterSpacing: '-0.04em' }}>AXIS HISTORY</div>
</div>

<div
style={{
color: stateColor(axisState),
fontSize: 13,
letterSpacing: '0.22em',
}}
>
{axisState}
</div>
</div>

<div style={{ padding: 14, borderBottom: `1px solid ${LINE}` }}>
<div
style={{
color: MUTED,
fontSize: 11,
letterSpacing: '0.28em',
marginBottom: 10,
}}
>
AXIS SHAPE
</div>

<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
{axisShape.length ? (
axisShape.map((item) => (
<button
key={item.id}
onClick={() => setSelectedEventId(item.id)}
style={{
appearance: 'none',
border: `1px solid ${stateColor(item.state)}`,
background: 'transparent',
color: stateColor(item.state),
padding: '10px 12px',
fontSize: 12,
letterSpacing: '0.16em',
}}
>
{item.state}
</button>
))
) : (
<div style={{ color: MUTED, fontSize: 14 }}>No movement captured yet.</div>
)}
</div>
</div>

<div style={{ padding: 14, borderBottom: `1px solid ${LINE}` }}>
<div
style={{
color: MUTED,
fontSize: 11,
letterSpacing: '0.28em',
marginBottom: 10,
}}
>
RECAP
</div>

{selectedEvent ? (
<div style={{ display: 'grid', gap: 8 }}>
<div
style={{
fontSize: 26,
color: stateColor(selectedEvent.state),
letterSpacing: '-0.04em',
}}
>
{selectedEvent.state}
</div>

<div style={{ color: MUTED, fontSize: 14 }}>{selectedEvent.at}</div>
<div style={{ color: MUTED, fontSize: 13, letterSpacing: '0.14em' }}>
{selectedEvent.mode}
</div>

<div
style={{
display: 'grid',
gridTemplateColumns: '1fr 1fr',
gap: 8,
marginTop: 6,
}}
>
{[
['Body Axis', `${selectedEvent.tilt.toFixed(1)}°`],
['Stability', `${Math.round(selectedEvent.stability)}%`],
['Window', `${Math.round(selectedEvent.windowMs)} ms`],
['Drift', `${selectedEvent.driftPx.toFixed(1)} px`],
].map(([label, value]) => (
<div
key={label}
style={{
border: `1px solid ${LINE}`,
padding: 12,
}}
>
<div
style={{
color: MUTED,
fontSize: 11,
letterSpacing: '0.18em',
marginBottom: 6,
}}
>
{label}
</div>
<div style={{ fontSize: 20 }}>{value}</div>
</div>
))}
</div>
</div>
) : (
<div style={{ color: MUTED }}>Capture a session to generate recap.</div>
)}
</div>

<div style={{ padding: 14, display: 'grid', gap: 10 }}>
{history.length ? (
history.map((item) => (
<button
key={item.id}
onClick={() => setSelectedEventId(item.id)}
style={{
appearance: 'none',
textAlign: 'left',
width: '100%',
border: `1px solid ${LINE}`,
background: 'transparent',
color: TEXT,
padding: 14,
}}
>
<div
style={{
display: 'flex',
justifyContent: 'space-between',
alignItems: 'center',
marginBottom: 10,
}}
>
<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
<span
style={{
width: 10,
height: 10,
borderRadius: '50%',
display: 'inline-block',
background: stateColor(item.state),
}}
/>
<span style={{ fontSize: 18 }}>{item.state}</span>
</div>

<span
style={{
color: stateColor(item.state),
fontSize: 12,
letterSpacing: '0.16em',
}}
>
{item.state}
</span>
</div>

<div style={{ color: MUTED, fontSize: 13, marginBottom: 10 }}>{item.at}</div>
<div style={{ color: TEXT, fontSize: 15 }}>{labelForEvent(item)}</div>
</button>
))
) : (
<div style={{ color: MUTED, padding: '4px 0 10px' }}>Axis History will appear here.</div>
)}
</div>
</section>
</div>
</main>
);
}