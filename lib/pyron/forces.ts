export function applyForces(
particles: Array<[number, number, number]>,
energy: number
) {
return particles.map(([x, y, z]) => {
const drift = Math.max(0.001, energy * 0.01);

return [
x + (Math.random() - 0.5) * drift,
y + (Math.random() - 0.5) * drift,
z + (Math.random() - 0.5) * drift,
] as [number, number, number];
});
}