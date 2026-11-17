"use client";

import { useEffect, useEffectEvent } from "react";

export function useTimeout(run: () => void, delay: number | null): void {
  const onTimeout = useEffectEvent(run);
  useEffect(() => {
    if (delay === null) return undefined;
    const id = setTimeout(() => onTimeout(), delay);
    return () => clearTimeout(id);
  }, [delay]);
}

export function useInterval(run: () => void, delay: number | null): void {
  const onTick = useEffectEvent(run);
  useEffect(() => {
    if (delay === null) return undefined;
    const id = setInterval(() => onTick(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

export function useAnimationFrame(run: (time: number) => void, running: boolean): void {
  const onFrame = useEffectEvent(run);
  useEffect(() => {
    if (!running) return undefined;
    let id = requestAnimationFrame(function frame(time) {
      id = requestAnimationFrame(frame);
      onFrame(time);
    });
    return () => cancelAnimationFrame(id);
  }, [running]);
}
