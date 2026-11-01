package com.github.curiousoddman.curious.chat.event.model;

import com.github.curiousoddman.curious.chat.event.payload.UserNotificationPayload;
import lombok.Getter;
import org.springframework.context.ApplicationEvent;

import java.util.List;

/**
 * Replaces all notifications of one source with a new list. An empty list removes them all. Used
 * by the project validation: it checks again after each change, so the old results must go.
 */
@Getter
public class UserNotificationsReplacedEvent extends ApplicationEvent {
    private final String                        sourceKey;
    private final List<UserNotificationPayload> payloads;

    public UserNotificationsReplacedEvent(Object source, String sourceKey, List<UserNotificationPayload> payloads) {
        super(source);
        this.sourceKey = sourceKey;
        this.payloads = List.copyOf(payloads);
    }
}
