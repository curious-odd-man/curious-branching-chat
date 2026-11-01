package com.github.curiousoddman.curious.chat.ui.util;

import javafx.event.EventType;
import javafx.scene.Node;
import javafx.scene.Scene;
import javafx.scene.control.ButtonBase;
import javafx.scene.input.MouseEvent;
import javafx.scene.input.PickResult;
import lombok.extern.slf4j.Slf4j;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Debug-level log of every mouse click on a {@link Scene}: what was hit, and whether the event was
 * consumed before it reached the scene. Install once per scene with {@link #install}.
 * <p>
 * Each click event gets one "hit" line (capturing phase, before any handler runs) and, only if
 * no handler consumed the event, one "unconsumed" line (bubbling phase, at the scene). A press
 * with a "hit" line and no "unconsumed" line was consumed by a handler. JavaFX has no API that
 * names that handler, so the "hit" line lists the nodes on the path that have a handler set
 * ({@code onMouse*} or {@code onAction}); handlers added with {@code addEventHandler} are not listed.
 * <p>
 * Enable with logger level DEBUG for this class. When DEBUG is off the cost is one flag check per event.
 */
@Slf4j
public final class ClickLogger {

    private static final Set<EventType<MouseEvent>> LOGGED_TYPES = Set.of(
            MouseEvent.MOUSE_PRESSED,
            MouseEvent.MOUSE_RELEASED,
            MouseEvent.MOUSE_CLICKED
    );

    private static final int MAX_USER_DATA_CHARS = 120;

    private ClickLogger() {
    }

    public static void install(Scene scene, String sceneName) {
        AtomicInteger sequence = new AtomicInteger();

        scene.addEventFilter(MouseEvent.ANY, event -> {
            if (!log.isDebugEnabled() || !LOGGED_TYPES.contains(event.getEventType())) {
                return;
            }
            try {
                log.debug("click #{} [{}] {} {} at scene=({}, {}) target={} pick={} handlersOnPath={}",
                        sequence.incrementAndGet(), sceneName, event.getEventType()
                                                                    .getName(), event.getButton(),
                        round(event.getSceneX()), round(event.getSceneY()),
                        describePath(event.getTarget() instanceof Node node ? node : null),
                        describePick(event.getPickResult()),
                        handlersOnPath(event));
            } catch (RuntimeException e) {
                log.debug("click log failed", e); // a logging problem must never break the UI
            }
        });

        scene.addEventHandler(MouseEvent.ANY, event -> {
            if (log.isDebugEnabled() && LOGGED_TYPES.contains(event.getEventType())) {
                log.debug("click #{} [{}] {} reached the scene unconsumed",
                        sequence.get(), sceneName, event.getEventType()
                                                        .getName());
            }
        });
    }

    private static String describePath(Node node) {
        if (node == null) {
            return "none";
        }
        List<String> labels = new ArrayList<>();
        for (Node current = node; current != null; current = current.getParent()) {
            labels.add(label(current));
        }
        return String.join(" < ", labels);
    }

    private static String describePick(PickResult pick) {
        if (pick == null || pick.getIntersectedNode() == null) {
            return "none";
        }
        Node node = pick.getIntersectedNode();
        String point = pick.getIntersectedPoint() == null ? "" : String.format(" point=(%.1f, %.1f, %.1f)",
                pick.getIntersectedPoint()
                    .getX(), pick.getIntersectedPoint()
                                 .getY(), pick.getIntersectedPoint()
                                              .getZ());
        String userData = node.getUserData() == null ? "" : " userData=" + shorten(node.getUserData());
        return describePath(node) + point + userData;
    }

    /**
     * Nodes on the target's and the pick's parent path that have a handler for this event type.
     */
    private static List<String> handlersOnPath(MouseEvent event) {
        List<String> found = new ArrayList<>();
        collectHandlers(event.getTarget() instanceof Node node ? node : null, event.getEventType(), found);
        PickResult pick = event.getPickResult();
        if (pick != null && pick.getIntersectedNode() != event.getTarget()) {
            collectHandlers(pick.getIntersectedNode(), event.getEventType(), found);
        }
        return found;
    }

    private static void collectHandlers(Node start, EventType<?> type, List<String> found) {
        for (Node current = start; current != null; current = current.getParent()) {
            if (type == MouseEvent.MOUSE_PRESSED && current.getOnMousePressed() != null) {
                found.add(label(current) + ".onMousePressed");
            } else if (type == MouseEvent.MOUSE_RELEASED && current.getOnMouseReleased() != null) {
                found.add(label(current) + ".onMouseReleased");
            } else if (type == MouseEvent.MOUSE_CLICKED && current.getOnMouseClicked() != null) {
                found.add(label(current) + ".onMouseClicked");
            }
            if (type == MouseEvent.MOUSE_CLICKED && current instanceof ButtonBase button && button.getOnAction() != null) {
                found.add(label(current) + ".onAction");
            }
        }
    }

    private static String label(Node node) {
        String name = node.getClass()
                          .getSimpleName();
        if (name.isEmpty()) {
            name = node.getClass()
                       .getName();
        }
        return node.getId() == null ? name : name + "#" + node.getId();
    }

    private static String shorten(Object userData) {
        String text = userData instanceof String ? (String) userData : userData.getClass()
                                                                               .getSimpleName() + userData;
        return text.length() <= MAX_USER_DATA_CHARS ? text : text.substring(0, MAX_USER_DATA_CHARS) + "...";
    }

    private static long round(double value) {
        return Math.round(value);
    }
}
