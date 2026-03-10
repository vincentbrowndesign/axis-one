"use client";



import React, { useEffect, useMemo, useRef, useState } from "react";

import {

  Activity,

  RotateCcw,

  Play,

  Pause,

  Trophy,

  TimerReset,

  Radar,

  Target,

  Zap,

} from "lucide-react";

import {

  AxisState,

  SignalType,

  SessionEvent,

  RunSummary,

  TrailPoint,

  SIGNALS,

  RUN_SECONDS,

  FIELD_SIZE,

  CENTER,

  TRAIL_LIMIT,

  STORAGE_KEY,

} from "@/lib/axis-types";

import {

  clamp,

  round,

  avg,

  scoreReaction,

  scoreRecovery,

  scoreStability,

  deriveAxisState,

  signalToPosition,

  formatStateLabel,

  loadRunHistory,

  saveRunHistory,

  buildRunSummary,

} from "@/lib/axis-scoring";



export default function AxisRunInstrument() {

  const [isRunning, setIsRunning] = useState(false);

  const [isPaused, setIsPaused] = useState(false);

  const [timeLeft, setTimeLeft] = useState(RUN_SECONDS);

  const [activeSignal, setActiveSignal] = useState<SignalType | null>(null);

  const [signalBornAt, setSignalBornAt] = useState<number | null>(null);

  const [signalCount, setSignalCount] = useState(0);

  const [events, setEvents] = useState<SessionEvent[]>([]);

  const [history, setHistory] = useState<RunSummary[]>([]);



  const [centerPoint, setCenterPoint] = useState({ x: CENTER, y: CENTER });

  const [trail, setTrail] = useState<TrailPoint[]>([]);

  const [stability, setStability] = useState(0.92);

  const [axisTilt, setAxisTilt] = useState(0);

  const [state, setState] = useState<AxisState>("AXIS");



  const intervalRef = useRef<number | null>(null);

  const motionRef = useRef<number | null>(null);

  const nextSignalTimeoutRef = useRef<number | null>(null);

  const recoveryStartRef = useRef<number | null>(null);

  const latestPointRef = useRef({ x: CENTER, y: CENTER });

  const lastStateRef = useRef<AxisState>("AXIS");

  const eventsRef = useRef<SessionEvent[]>([]);

  const isRunningRef = useRef(false);

  const isPausedRef = useRef(false);

  const stabilityRef = useRef(0.92);



  useEffect(() => {

    setHistory(loadRunHistory());

  }, []);



  useEffect(() => {

    latestPointRef.current = centerPoint;

    lastStateRef.current = state;

    stabilityRef.current = stability;

  }, [centerPoint, state, stability]);



  useEffect(() => {

    eventsRef.current = events;

  }, [events]);



  useEffect(() => {

    isRunningRef.current = isRunning;

    isPausedRef.current = isPaused;

  }, [isRunning, isPaused]);



  const liveMetrics = useMemo(() => {

    const hits = events.filter((e) => e.success).length;

    const misses = events.filter((e) => !e.success).length;

    const reaction = round(avg(events.map((e) => e.reactionMs)) || 0);

    const recovery = round(avg(events.map((e) => e.recoveryMs)) || 0);

    const avgStability = round(avg(events.map((e) => e.stabilityAtTap)) || stability, 2);

    const consistency = events.length

      ? round((events.filter((e) => e.stateAtTap === "AXIS").length / events.length) * 100)

      : round(scoreStability(stability));



    const score = round(

      scoreStability(avgStability) * 0.35 +

        scoreReaction(reaction || 700) * 0.25 +

        scoreRecovery(recovery || 1200) * 0.2 +

        consistency * 0.2,

      0,

    );



    return {

      hits,

      misses,

      reaction,

      recovery,

      avgStability,

      consistency,

      score,

    };

  }, [events, stability]);



  function clearScheduled() {

    if (intervalRef.current) window.clearInterval(intervalRef.current);

    if (motionRef.current) window.clearInterval(motionRef.current);

    if (nextSignalTimeoutRef.current) window.clearTimeout(nextSignalTimeoutRef.current);

    intervalRef.current = null;

    motionRef.current = null;

    nextSignalTimeoutRef.current = null;

  }



  function finishRun(collectedEvents: SessionEvent[]) {

    clearScheduled();

    setIsRunning(false);

    setIsPaused(false);

    setActiveSignal(null);

    setSignalBornAt(null);



    const summary = buildRunSummary(collectedEvents, stabilityRef.current);



    setHistory((prev) => {

      const next = [summary, ...prev].slice(0, 12);

      saveRunHistory(next);

      return next;

    });

  }



  function resetRun() {

    clearScheduled();

    setIsRunning(false);

    setIsPaused(false);

    setTimeLeft(RUN_SECONDS);

    setActiveSignal(null);

    setSignalBornAt(null);

    setSignalCount(0);

    setEvents([]);

    eventsRef.current = [];

    setCenterPoint({ x: CENTER, y: CENTER });

    setTrail([]);

    setStability(0.92);

    stabilityRef.current = 0.92;

    setAxisTilt(0);

    setState("AXIS");

    recoveryStartRef.current = null;

  }



  function pushSignal(delay = 900) {

    if (!isRunningRef.current || isPausedRef.current) return;

    if (nextSignalTimeoutRef.current) window.clearTimeout(nextSignalTimeoutRef.current);



    nextSignalTimeoutRef.current = window.setTimeout(() => {

      const next = SIGNALS[Math.floor(Math.random() * SIGNALS.length)];

      setActiveSignal(next);

      setSignalBornAt(performance.now());

      setSignalCount((v) => v + 1);

      recoveryStartRef.current = performance.now();



      nextSignalTimeoutRef.current = window.setTimeout(() => {

        const miss: SessionEvent = {

          id: crypto.randomUUID(),

          signal: next,

          reactionMs: 999,

          stateAtTap: lastStateRef.current,

          stabilityAtTap: round(stabilityRef.current, 2),

          recoveryMs: 1400,

          success: false,

        };



        setEvents((prev) => {

          const updated = [miss, ...prev];

          eventsRef.current = updated;

          return updated;

        });



        setActiveSignal(null);

        setSignalBornAt(null);

        pushSignal(700 + Math.random() * 1300);

      }, 1800);

    }, delay);

  }



  function startMotionLoop() {

    motionRef.current = window.setInterval(() => {

      setCenterPoint((prev) => {

        const driftStrength = activeSignal ? 18 : 8;

        const dx = (Math.random() - 0.5) * driftStrength;

        const dy = (Math.random() - 0.5) * driftStrength + (activeSignal === "PASS" ? 5 : 0);

        const nextX = clamp(prev.x + dx, CENTER - 175, CENTER + 175);

        const nextY = clamp(prev.y + dy, CENTER - 175, CENTER + 175);



        const dist = Math.sqrt((nextX - CENTER) ** 2 + (nextY - CENTER) ** 2);

        const nextStability = clamp(1 - dist / 210, 0.1, 0.98);

        const nextTilt = clamp((nextX - CENTER) / 8, -16, 16);

        const nextState = deriveAxisState(nextX, nextY, CENTER);



        setStability(round(nextStability, 2));

        stabilityRef.current = round(nextStability, 2);

        setAxisTilt(round(nextTilt, 1));

        setState(nextState);

        setTrail((old) => [

          ...old.slice(-(TRAIL_LIMIT - 1)),

          { x: nextX, y: nextY, t: Date.now() },

        ]);



        return { x: nextX, y: nextY };

      });

    }, 120);

  }



  function startTimerLoop() {

    intervalRef.current = window.setInterval(() => {

      setTimeLeft((prev) => {

        if (prev <= 1) {

          finishRun(eventsRef.current);

          return 0;

        }

        return prev - 1;

      });

    }, 1000);

  }



  function startRun() {

    resetRun();

    setIsRunning(true);

    isRunningRef.current = true;

    setTimeLeft(RUN_SECONDS);

    startTimerLoop();

    startMotionLoop();

    pushSignal(1200);

  }



  function pauseRun() {

    if (!isRunningRef.current) return;

    setIsPaused(true);

    isPausedRef.current = true;

    clearScheduled();

  }



  function resumeRun() {

    if (!isRunningRef.current) return;

    setIsPaused(false);

    isPausedRef.current = false;

    startTimerLoop();

    startMotionLoop();

    pushSignal(500);

  }



  function answerSignal(signal: SignalType) {

    if (!isRunningRef.current || isPausedRef.current || !activeSignal || !signalBornAt) return;



    const reactionMs = Math.max(100, Math.round(performance.now() - signalBornAt));

    const stateNow = deriveAxisState(latestPointRef.current.x, latestPointRef.current.y, CENTER);

    const stabilityNow = stabilityRef.current;

    const correct = signal === activeSignal;



    const recoveryMs = recoveryStartRef.current

      ? Math.round(performance.now() - recoveryStartRef.current)

      : 700;



    const nextEvent: SessionEvent = {

      id: crypto.randomUUID(),

      signal: activeSignal,

      reactionMs,

      stateAtTap: stateNow,

      stabilityAtTap: round(stabilityNow, 2),

      recoveryMs,

      success: correct,

    };



    if (nextSignalTimeoutRef.current) window.clearTimeout(nextSignalTimeoutRef.current);



    setEvents((prev) => {

      const updated = [nextEvent, ...prev];

      eventsRef.current = updated;

      return updated;

    });



    setActiveSignal(null);

    setSignalBornAt(null);

    pushSignal(500 + Math.random() * 900);

  }



  useEffect(() => {

    return () => clearScheduled();

  }, []);



  const activeSignalPos = activeSignal ? signalToPosition(activeSignal, CENTER) : null;

  const bestRun = history.length ? Math.max(...history.map((r) => r.score)) : 0;



  return (

    <div className="min-h-screen w-full overflow-hidden bg-[#050816] text-white">

      <div className="relative mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 py-4 md:px-6 md:py-6">

        <div className="mb-4 flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur md:flex-row md:items-center md:justify-between">

          <div>

            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-white/50">

              <Radar className="h-3.5 w-3.5" /> Axis Instrument

            </div>

            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">Axis Run / Signal Field</h1>

            <p className="mt-1 max-w-2xl text-sm text-white/55 md:text-base">

              Full-screen stability instrument with signal prompts, motion trail, run scoring, and a portable performance layer.

            </p>

          </div>



          <div className="flex flex-wrap gap-2">

            {!isRunning ? (

              <button

                onClick={startRun}

                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white px-4 py-3 text-sm font-semibold text-black transition hover:scale-[1.02]"

              >

                <Play className="h-4 w-4" /> Start 60s Run

              </button>

            ) : isPaused ? (

              <button

                onClick={resumeRun}

                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white px-4 py-3 text-sm font-semibold text-black transition hover:scale-[1.02]"

              >

                <Play className="h-4 w-4" /> Resume

              </button>

            ) : (

              <button

                onClick={pauseRun}

                className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15"

              >

                <Pause className="h-4 w-4" /> Pause

              </button>

            )}



            <button

              onClick={resetRun}

              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"

            >

              <RotateCcw className="h-4 w-4" /> Reset

            </button>

          </div>

        </div>



        <div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(640px,1fr)_360px]">

          <div className="order-2 flex flex-col gap-4 xl:order-1">

            <MetricCard icon={<Activity className="h-4 w-4" />} label="State" value={formatStateLabel(state)} sub={`Stability ${round(stability * 100)} / 100`} />

            <MetricCard icon={<Target className="h-4 w-4" />} label="Run Score" value={String(liveMetrics.score || 0)} sub={`Best ${bestRun}`} />

            <MetricCard icon={<TimerReset className="h-4 w-4" />} label="Reaction" value={liveMetrics.reaction ? `${liveMetrics.reaction}ms` : "—"} sub={`Recovery ${liveMetrics.recovery || 0}ms`} />

            <MetricCard icon={<Zap className="h-4 w-4" />} label="Consistency" value={`${liveMetrics.consistency || 0}%`} sub={`Hits ${liveMetrics.hits} / Misses ${liveMetrics.misses}`} />



            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">

              <div className="text-[11px] uppercase tracking-[0.25em] text-white/45">Signal Controls</div>

              <div className="mt-4 grid grid-cols-2 gap-2">

                {SIGNALS.map((signal) => (

                  <button

                    key={signal}

                    onClick={() => answerSignal(signal)}

                    className={`rounded-2xl border px-4 py-4 text-sm font-semibold transition ${

                      activeSignal === signal

                        ? "border-white/50 bg-white text-black"

                        : "border-white/10 bg-white/5 text-white hover:bg-white/10"

                    }`}

                  >

                    {signal}

                  </button>

                ))}

              </div>

              <p className="mt-3 text-xs leading-5 text-white/45">

                Prototype input uses tap buttons for now. Later swap in camera pose, IMU, QR controller, or remote device control.

              </p>

            </div>

          </div>



          <div className="order-1 rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),rgba(255,255,255,0.02)_30%,rgba(0,0,0,0)_68%)] p-3 md:p-5 xl:order-2">

            <div className="relative flex h-full min-h-[680px] items-center justify-center overflow-hidden rounded-[2rem] border border-white/10 bg-[#070b1e]">

              <div className="absolute left-1/2 top-1/2 h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.03] blur-3xl" />

              <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] opacity-30" />



              <div className="relative" style={{ width: FIELD_SIZE, height: FIELD_SIZE }}>

                {[1, 2, 3, 4].map((ring) => {

                  const size = 120 + ring * 95;

                  return (

                    <div

                      key={ring}

                      className="absolute left-1/2 top-1/2 rounded-full border border-white/10"

                      style={{ width: size, height: size, transform: "translate(-50%, -50%)" }}

                    />

                  );

                })}



                <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/10" />

                <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/10" />



                <FieldLabel x={CENTER} y={36} label="SHOOT" active={activeSignal === "SHOOT"} />

                <FieldLabel x={CENTER} y={FIELD_SIZE - 36} label="PASS" active={activeSignal === "PASS"} />

                <FieldLabel x={42} y={CENTER} label="LEFT" active={activeSignal === "LEFT"} />

                <FieldLabel x={FIELD_SIZE - 42} y={CENTER} label="RIGHT" active={activeSignal === "RIGHT"} />



                {trail.map((point, i) => {

                  const alpha = (i + 1) / trail.length;

                  const size = 4 + alpha * 8;

                  return (

                    <div

                      key={`${point.t}-${i}`}

                      className="absolute rounded-full bg-white"

                      style={{

                        width: size,

                        height: size,

                        left: point.x - size / 2,

                        top: point.y - size / 2,

                        opacity: alpha * 0.35,

                        boxShadow: `0 0 ${8 + alpha * 18}px rgba(255,255,255,${alpha * 0.18})`,

                      }}

                    />

                  );

                })}



                {activeSignalPos && (

                  <>

                    <div

                      className="absolute rounded-full border border-white/50"

                      style={{

                        left: activeSignalPos.x - 28,

                        top: activeSignalPos.y - 28,

                        width: 56,

                        height: 56,

                        boxShadow: "0 0 28px rgba(255,255,255,0.25)",

                      }}

                    />

                    <div

                      className="absolute animate-ping rounded-full border border-white/30"

                      style={{

                        left: activeSignalPos.x - 28,

                        top: activeSignalPos.y - 28,

                        width: 56,

                        height: 56,

                      }}

                    />

                  </>

                )}



                <div

                  className="absolute origin-bottom rounded-full bg-white"

                  style={{

                    width: 3,

                    height: 168,

                    left: centerPoint.x - 1.5,

                    top: centerPoint.y - 122,

                    transform: `rotate(${axisTilt}deg)`,

                    boxShadow: "0 0 18px rgba(255,255,255,0.25)",

                  }}

                />



                <div

                  className="absolute rounded-full border border-white/60 bg-white"

                  style={{

                    width: 18,

                    height: 18,

                    left: centerPoint.x - 9,

                    top: centerPoint.y - 9,

                    boxShadow: "0 0 22px rgba(255,255,255,0.35)",

                  }}

                />



                <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 translate-y-[188px] flex-col items-center gap-2 text-center">

                  <div className="text-[11px] uppercase tracking-[0.35em] text-white/40">Live Instrument</div>

                  <div className="text-2xl font-semibold tracking-tight">{formatStateLabel(state)}</div>

                  <div className="text-sm text-white/55">Stability {round(stability * 100)} · Tilt {axisTilt}° · Signals {signalCount}</div>

                </div>



                <div className="absolute left-1/2 top-1/2 flex -translate