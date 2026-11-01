package com.github.curiousoddman.curious.chat.event.payload;

import java.util.List;

public interface UserNotificationPayload {

    String getTitle();

    List<String> getDescription();

    NotificationLevel getNotificationLevel();

    /**
     * Which part of the program owns this notification, or {@code null}. A new set of
     * notifications from one source replaces the old set of that source (see
     * {@code UserNotificationsReplacedEvent}).
     */
    default String getSourceKey() {
        return null;
    }
}
