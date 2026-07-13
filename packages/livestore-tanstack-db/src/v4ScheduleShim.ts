/**
 * Effect v4 snapshot polyfill.
 *
 * The LiveStore snapshot's `@livestore/utils/dist/effect/Schedule.js`
 * exports `exponentialBackoff10Sec`, which is built via
 * `Schedule.bothLeft(Schedule.during(Duration.seconds(10)))`. The
 * `both`/`bothLeft`/`bothRight`/`bothWith` helpers were removed in
 * the upcoming Effect v4 release in favour of `Schedule.max([...])`
 * — see https://github.com/Effect-TS/effect-smol/pull/2551.
 *
 * Effect 4.0.0-beta.98 already ships `Schedule.max`. So this shim is
 * trivial: alias the old names to the new `max` shape. `bothLeft(b)`
 * historically meant "run both, output of `self`, delay = max of the
 * two", which is exactly `max([self, b])`.
 *
 * Once the LiveStore snapshot is republished against the next Effect
 * beta, this shim becomes a no-op and can be deleted.
 */
import { Schedule } from "effect";
import type { Schedule as ScheduleInterface } from "effect/Schedule";

// `Schedule` is both an interface and a namespace in Effect v4. The
// default `import { Schedule }` resolves to the namespace; we use the
// type-only import for the interface.
type ScheduleType<Output, Input = unknown, Err = never, Env = never> = ScheduleInterface<
  Output,
  Input,
  Err,
  Env
>;

/** Patch Schedule to expose the removed `both*` helpers in terms of `max`. */
const patch = (): void => {
  const sched = Schedule as unknown as Record<string, unknown>;
  if (typeof sched.bothLeft === "function") return; // already patched

  sched.bothLeft =
    <A, _B>(other: ScheduleType<A>) =>
    <X>(self: ScheduleType<X>): ScheduleType<X> =>
      Schedule.max([self, other]) as unknown as ScheduleType<X>;

  // `both` / `bothRight` / `bothWith` are also gone in the upcoming
  // Effect v4 release. The LiveStore snapshot doesn't reference them
  // today, but shim them defensively for future snapshots.
  sched.both = <A, B>(a: ScheduleType<A>, b: ScheduleType<B>) => Schedule.max([a, b]) as unknown;
  sched.bothRight =
    <A, _B>(other: ScheduleType<A>) =>
    <X>(self: ScheduleType<X>): ScheduleType<X> =>
      Schedule.max([self, other]) as unknown as ScheduleType<X>;
  sched.bothWith = <A, B, C>(
    _f: (a: A, b: B) => C,
  ): ((args_0: ScheduleType<B>, args_1?: ScheduleType<A>) => ScheduleType<C>) => {
    const fn = (other: ScheduleType<B>, self?: ScheduleType<A>): ScheduleType<C> => {
      const a = self ?? (other as unknown as ScheduleType<A>);
      return Schedule.max([a, other]) as unknown as ScheduleType<C>;
    };
    return fn as never;
  };
};

patch();

export {};
