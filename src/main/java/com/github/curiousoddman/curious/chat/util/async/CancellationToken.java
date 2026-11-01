package com.github.curiousoddman.curious.chat.util.async;

import java.util.concurrent.atomic.AtomicLong;

/**
 * Guards a unit of work against being superseded by a newer one.
 * <p>
 * Typical use: call {@link #snapshot()} (or {@link #cancelAndSnapshot()}, if this unit of work
 * should also invalidate any earlier one still in flight) when starting the work, then pass the
 * resulting {@link Snapshot} to {@link Flow#cancelledBy(Snapshot)} — or check
 * {@link Snapshot#isValid()} directly for guards that don't go through {@link Flow}. Call
 * {@link #cancel()} whenever a new unit of work should invalidate every {@link Snapshot} taken so
 * far.
 */
public class CancellationToken {
    private final AtomicLong generation = new AtomicLong();

    public Snapshot snapshot() {
        return new Snapshot(generation.get());
    }

    public void cancel() {
        generation.incrementAndGet();
    }

    /**
     * Cancels any snapshots taken so far, then returns a fresh, valid one for the new unit of
     * work — the usual way to kick off a load that should supersede whatever came before it.
     */
    public Snapshot cancelAndSnapshot() {
        cancel();
        return snapshot();
    }

    public class Snapshot {
        private final long value;

        private Snapshot(long value) {
            this.value = value;
        }

        public boolean isValid() {
            return generation.get() == value;
        }
    }
}
