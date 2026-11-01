package com.github.curiousoddman.curious.chat.ui.controller.services;

import com.github.curiousoddman.curious.chat.event.model.UserNotificationEvent;
import com.github.curiousoddman.curious.chat.event.model.UserNotificationsReplacedEvent;
import com.github.curiousoddman.curious.chat.event.payload.NotificationLevel;
import com.github.curiousoddman.curious.chat.event.payload.UserNotificationPayload;
import com.github.curiousoddman.curious.chat.ui.FxmlLoader;
import com.github.curiousoddman.curious.chat.ui.FxmlView;
import com.github.curiousoddman.curious.chat.ui.app.LoadedFxml;
import com.github.curiousoddman.curious.chat.ui.app.bundle.NotificationMenuItemBundle;
import com.github.curiousoddman.curious.chat.ui.controller.custom.NotificationMenuItemController;
import com.github.curiousoddman.curious.chat.ui.styles.CssClasses;
import javafx.event.ActionEvent;
import javafx.geometry.Bounds;
import javafx.scene.Node;
import javafx.scene.control.Button;
import javafx.scene.layout.VBox;
import javafx.stage.Popup;
import javafx.stage.Window;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.kordamp.ikonli.javafx.FontIcon;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;


import static com.sun.javafx.util.Utils.runOnFxThread;
import static org.kordamp.ikonli.bootstrapicons.BootstrapIcons.EXCLAMATION_CIRCLE_FILL;
import static org.kordamp.ikonli.bootstrapicons.BootstrapIcons.EXCLAMATION_TRIANGLE_FILL;

@Slf4j
@Component
@RequiredArgsConstructor
public class NotificationsService {
    private static final double PANEL_WIDTH      = 320;
    private static final double GAP_BELOW_BUTTON = 4;

    private final Popup popup = new Popup();

    private final NotificationInbox inbox = new NotificationInbox();

    private final FxmlLoader fxmlLoader;

    private Button notificationsMenu;

    public void initialize(Button notificationsMenu) {
        this.notificationsMenu = notificationsMenu;

        popup.setAutoHide(true);   // closes automatically on outside click / focus loss
        popup.setHideOnEscape(true);

        notificationsMenu.setOnAction(this::onNotificationsOpenClick);
        updateNotification(); // notifications may have come before the button existed
    }

    private void onNotificationsOpenClick(ActionEvent actionEvent) {
        if (popup.isShowing()) {
            popup.hide();
            return;
        }
        showPopup();
    }

    /**
     * Builds the panel from the current {@code inbox} and shows it, or — if it is already
     * showing — replaces its content and re-measures/repositions it in place. Called on open, and
     * again from a notification's own dismiss button so the panel updates immediately instead of
     * waiting for the next open (see the dismiss lambda in {@link #buildPanel()}).
     */
    private void showPopup() {
        Node panel = buildPanel();
        popup.getContent()
             .setAll(panel); // setAll, not add: clears any panel left over from a previous open.

        // Measure the panel without showing it yet, so we can place it in one go with no flicker.
        panel.applyCss();
        double popupWidth  = panel.prefWidth(-1);
        double popupHeight = panel.prefHeight(popupWidth);

        Window window = notificationsMenu.getScene()
                                         .getWindow();
        Bounds buttonBounds = notificationsMenu.localToScreen(notificationsMenu.getBoundsInLocal());

        // Open down and to the left of the button: right edge of the panel lines up with the
        // button's right edge, top edge just below the button.
        double x = buttonBounds.getMaxX() - popupWidth;
        double y = buttonBounds.getMaxY() + GAP_BELOW_BUTTON;

        // Never leave the window bounds (assumes the window is large enough for the panel).
        double windowMinX = window.getX();
        double windowMaxX = window.getX() + window.getWidth();
        double windowMaxY = window.getY() + window.getHeight();
        x = Math.clamp(x, windowMinX, windowMaxX - popupWidth);
        y = Math.min(y, windowMaxY - popupHeight);

        if (popup.isShowing()) {
            popup.setX(x);
            popup.setY(y);
        } else {
            popup.show(window, x, y);
        }
    }

    private Node buildPanel() {
        VBox vBox = new VBox();
        vBox.setPrefWidth(PANEL_WIDTH);
        vBox.getStylesheets()
            .setAll("/styles/default.css"); // this node is built in Java, not loaded from FXML, so
        // it needs its own stylesheet — see FxmlLoader.load.
        vBox.getStyleClass()
            .add(CssClasses.NOTIFICATION_PANEL);
        for (UserNotificationPayload payload : inbox.payloads()) {
            LoadedFxml<NotificationMenuItemController> loaded = fxmlLoader.load(
                    FxmlView.NOTIFICATIONS_MENU_ITEM,
                    new NotificationMenuItemBundle(
                            getGraphic(payload.getNotificationLevel()),
                            payload.getTitle(),
                            payload.getDescription(),
                            () -> {
                                inbox.remove(payload);
                                updateNotification();
                                if (popup.isShowing()) {
                                    if (inbox.isEmpty()) {
                                        popup.hide();
                                    } else {
                                        showPopup();
                                    }
                                }
                            }
                    )
            );
            vBox.getChildren()
                .add(loaded.parent());
        }
        return vBox;
    }

    @EventListener
    public void onUserNotificationEvent(UserNotificationEvent event) {
        inbox.add(event.getPayload());

        updateNotification();
    }

    @EventListener
    public void onUserNotificationsReplacedEvent(UserNotificationsReplacedEvent event) {
        inbox.replaceSource(event.getSourceKey(), event.getPayloads());

        updateNotification();
        runOnFxThread(() -> {
            if (popup.isShowing()) {
                if (inbox.isEmpty()) {
                    popup.hide();
                } else {
                    showPopup();
                }
            }
        });
    }

    private void updateNotification() {
        runOnFxThread(() -> {
            if (notificationsMenu == null) {
                return;
            }
            notificationsMenu.setVisible(!inbox.isEmpty());
            // getGraphic already applies the level's CSS class
            inbox.highestLevel()
                 .ifPresent(level -> notificationsMenu.setGraphic(getGraphic(level)));
            if (!inbox.isEmpty()) {
                notificationsMenu.setText(inbox.size() + "");
            }
        });
    }

    private String getCssStyle(NotificationLevel notificationLevel) {
        return switch (notificationLevel) {
            case WARNING -> CssClasses.WARNING_NOTIFICATION_ICON;
            case ERROR -> CssClasses.ERROR_NOTIFICATION_ICON;
        };
    }

    private FontIcon getGraphic(NotificationLevel notificationLevel) {
        FontIcon icon = switch (notificationLevel) {
            case WARNING -> new FontIcon(EXCLAMATION_TRIANGLE_FILL);
            case ERROR -> new FontIcon(EXCLAMATION_CIRCLE_FILL);
        };
        icon.getStyleClass()
            .add(getCssStyle(notificationLevel));
        return icon;
    }
}