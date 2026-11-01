package com.github.curiousoddman.curious.chat.event.payload;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

import java.util.List;

/**
 * Plain {@link UserNotificationPayload}: a title, some text lines, and a level.
 */
@Getter
@RequiredArgsConstructor
public class SimpleUserNotificationPayload implements UserNotificationPayload {
    private final String            title;
    private final List<String>      description;
    private final NotificationLevel notificationLevel;

    public static SimpleUserNotificationPayload error(String title, String... lines) {
        return new SimpleUserNotificationPayload(title, List.of(lines), NotificationLevel.ERROR);
    }
}
