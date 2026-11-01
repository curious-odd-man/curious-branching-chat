package com.github.curiousoddman.curious.chat.ui;

import com.github.curiousoddman.curious.chat.ui.controller.custom.NotificationMenuItemController;
import com.github.curiousoddman.curious.chat.ui.controller.screen.LibraryController;

public record FxmlView<T>(String fxmlPath, Class<T> controllerClass) {
    public static final FxmlView<LibraryController>              LIBRARY                 = new FxmlView<>("/fxml/library.fxml", LibraryController.class);
    public static final FxmlView<NotificationMenuItemController> NOTIFICATIONS_MENU_ITEM = new FxmlView<>("/fxml/notification_menu_item.fxml", NotificationMenuItemController.class);

}
