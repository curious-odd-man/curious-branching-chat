package com.github.curiousoddman.curious.chat.event.model;

import com.github.curiousoddman.curious.chat.event.payload.UserNotificationPayload;
import lombok.Getter;
import org.springframework.context.ApplicationEvent;

@Getter
public class UserNotificationEvent extends ApplicationEvent {
    private final UserNotificationPayload payload;

    public UserNotificationEvent(Object source, UserNotificationPayload payload) {
        super(source);
        this.payload = payload;
    }
}
