// Run legacy movement/forces at their intended 60 Hz, independently of display refresh.
export class FixedStepClock {
  constructor(now = 0, step = 1 / 60) { this.step = step; this.reset(now); }
  reset(now) { this.lastTime = now; this.accumulator = 0; }
  advance(now, update) {
    const elapsed = Math.max(0, Math.min(0.25, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator + 1e-10 >= this.step) {
      this.accumulator -= this.step;
      update(this.step);
      steps++;
    }
    return steps;
  }
}
