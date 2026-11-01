package com.github.curiousoddman.curious.chat.event.payload;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

import java.util.List;

/**
 * A notification that belongs to a source (for example the project validation). A new set from the
 * same source replaces the old one.
 */
@Getter
@RequiredArgsConstructor
public class SourcedUserNotificationPayload implements UserNotificationPayload {
    private final String            sourceKey;
    private final String            title;
    private final List<String>      description;
    private final NotificationLevel notificationLevel;
}
