package com.github.curiousoddman.curious.chat.ui.util;

import javafx.animation.ScaleTransition;
import javafx.scene.Node;
import javafx.scene.control.Tooltip;
import javafx.stage.Stage;
import javafx.util.Duration;
import lombok.experimental.UtilityClass;
import lombok.extern.slf4j.Slf4j;

/**
 * Small helper shared by modal dialog controllers (Add Files, Rescan Roots, ...) that each used
 * to repeat the same "cast my scene's window to a Stage and close it" snippet in their own
 * {@code close()} method.
 */
@Slf4j
@UtilityClass
public class UiUtils {
    /**
     * Closes the {@link Stage} that owns {@code anyNodeInScene}. Intended for "Cancel"/"OK"
     * buttons on a dialog loaded into its own {@code Stage} (see {@code FxmlLoader} usages that
     * call {@code new Stage()} + {@code stage.setScene(...)}).
     */
    public static void closeWindowOf(Node anyNodeInScene) {
        Stage stage = (Stage) anyNodeInScene.getScene()
                                            .getWindow();
        stage.close();
    }

    public static void registerHoverTooltip(Tooltip sharedTooltip, String text, Node... nodes) {
        for (Node node : nodes) {
            node.setOnMouseEntered(e -> {
                sharedTooltip.setText(text);
                Tooltip.install(node, sharedTooltip);
            });

            node.setOnMouseExited(e -> Tooltip.uninstall(node, sharedTooltip));
        }
    }

    public static void fxManage(boolean manage, Node... nodes) {
        for (Node node : nodes) {
            node.setVisible(manage);
            node.setManaged(manage);
        }
    }

    public static void fxManage(Node... parent) {
        fxManage(true, parent);
    }

    public static void fxUnmanage(Node... parent) {
        fxManage(false, parent);
    }

    public static void fxToggleClass(Node node, String styleClass, boolean active) {
        if (active) {
            if (!node.getStyleClass()
                     .contains(styleClass)) {
                node.getStyleClass()
                    .add(styleClass);
            }
        } else {
            node.getStyleClass()
                .remove(styleClass);
        }
    }

    public static void registerZoomInOnHover(Node... nodes) {
        for (Node node : nodes) {
            ScaleTransition zoomIn = new ScaleTransition(Duration.millis(120), node);
            zoomIn.setToX(1.05);
            zoomIn.setToY(1.05);

            node.setOnMouseEntered(event -> zoomIn.playFromStart());

            ScaleTransition zoomOut = new ScaleTransition(Duration.millis(120), node);
            zoomOut.setToX(1.0);
            zoomOut.setToY(1.0);

            node.setOnMouseExited(event -> zoomOut.playFromStart());
        }
    }
}
