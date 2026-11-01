package com.github.curiousoddman.curious.chat.util.async;

import javafx.application.Platform;
import lombok.RequiredArgsConstructor;

import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * Background-load-then-show-on-UI framework: {@code bg(...)} steps run on a virtual-thread
 * executor, {@code fx(...)} steps run on the FX application thread, and {@link #cancelledBy}
 * wires up a {@link CancellationToken.Snapshot} so stale work quietly stops applying its result
 * once superseded.
 * <p>
 * {@code cancelledBy} is optional — a {@code Flow} that never calls it is never cancelled, so
 * plain background-then-FX work (with no staleness concern) can use the same fluent chain.
 * <p>
 * Cancellation is silent: a step whose guard trips throws {@link CancellationException}, which
 * simply stops the chain — {@link #Flow::Step::onError} never sees it, so attaching an error handler for real
 * failures doesn't also have to filter out routine supersession.
 */
@RequiredArgsConstructor
public class Flow {
    private static final Executor BACKGROUND_EXECUTOR = Executors.newVirtualThreadPerTaskExecutor();
    private static final Executor FX_EXECUTOR         = Platform::runLater;

    private CancellationToken.Snapshot cancellationToken = new CancellationToken().snapshot();

    public static Flow begin() {
        return new Flow();
    }

    public Flow cancelledBy(CancellationToken.Snapshot cancellationToken) {
        this.cancellationToken = cancellationToken;
        return this;
    }

    public <T> Step<T> bg(Supplier<T> supplier) {
        return new Step<>(CompletableFuture.supplyAsync(() -> {
            checkGuard();
            return supplier.get();
        }, BACKGROUND_EXECUTOR));
    }

    public Step<Void> bg(Runnable runnable) {
        return bg(() -> {
            checkGuard();
            runnable.run();
            return null;
        });
    }

    /**
     * An FX-only guarded step, for cases with no background work — just a cancellation-checked
     * action on the FX thread (e.g. a stale-result guard on data that arrived some other way).
     */
    public Step<Void> fx(Runnable runnable) {
        return new Step<>(CompletableFuture.runAsync(() -> {
            checkGuard();
            runnable.run();
        }, FX_EXECUTOR));
    }

    private void checkGuard() {
        if (!cancellationToken.isValid()) {
            throw new CancellationException("Flow was cancelled");
        }
    }

    @RequiredArgsConstructor
    public class Step<T> {
        private final CompletableFuture<T> future;

        public Step<T> fx(Consumer<T> consumer) {
            return new Step<>(
                    future.thenApplyAsync(value -> {
                        checkGuard();
                        consumer.accept(value);
                        return value;
                    }, FX_EXECUTOR)
            );
        }

        public Step<T> fx(Runnable runnable) {
            return fx(v -> runnable.run());
        }

        public <R> Step<R> bg(Function<T, R> function) {
            return new Step<>(future.thenApplyAsync(v -> {
                checkGuard();
                return function.apply(v);
            }, BACKGROUND_EXECUTOR));
        }

        public <R> Step<R> bg(Supplier<R> supplier) {
            return bg(ignored -> supplier.get());
        }

        public <R> Step<R> bgAsync(Function<T, CompletionStage<R>> function) {
            return new Step<>(future.thenComposeAsync(v -> {
                checkGuard();
                return function.apply(v);
            }, BACKGROUND_EXECUTOR));
        }

        /**
         * Registers a handler for genuine failures. {@link CancellationException} (routine
         * supersession via {@link #cancelledBy}) is never passed to {@code handler} — it's
         * swallowed silently, same as if no handler were attached at all.
         */
        public CompletableFuture<T> onError(Consumer<Throwable> handler) {
            return future.exceptionally(ex -> {
                if (!isCancellation(ex)) {
                    FX_EXECUTOR.execute(() -> handler.accept(ex));
                }
                return null;
            });
        }

        private boolean isCancellation(Throwable ex) {
            Throwable cause = (ex instanceof CompletionException && ex.getCause() != null) ? ex.getCause() : ex;
            return cause instanceof CancellationException;
        }

        public CompletableFuture<T> run() {
            return future;
        }
    }
}
