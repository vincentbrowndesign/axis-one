import { create } from "zustand";

type PyronState = {
bank: number;
pressure: number;
energy: number;
live: boolean;
setBank: (v: number) => void;
setPressure: (v: number) => void;
setEnergy: (v: number) => void;
setLive: (v: boolean) => void;
};

export const usePyronStore = create<PyronState>((set) => ({
bank: 0,
pressure: 0,
energy: 0,
live: false,
setBank: (v) => set({ bank: v }),
setPressure: (v) => set({ pressure: v }),
setEnergy: (v) => set({ energy: v }),
setLive: (v) => set({ live: v }),
}));