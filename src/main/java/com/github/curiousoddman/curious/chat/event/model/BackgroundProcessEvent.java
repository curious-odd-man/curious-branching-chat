package com.github.curiousoddman.curious.chat.event.model;

import com.github.curiousoddman.curious.chat.event.payload.BackgroundProcessPayload;
import com.github.curiousoddman.curious.chat.event.types.BackgroundProcessEventType;
import lombok.Getter;
import org.springframework.context.ApplicationEvent;

@Getter
public class BackgroundProcessEvent extends ApplicationEvent {
    private final BackgroundProcessEventType eventType;
    private final BackgroundProcessPayload   payload;

    public BackgroundProcessEvent(Object source, BackgroundProcessEventType eventType, BackgroundProcessPayload payload) {
        super(source);
        this.eventType = eventType;
        this.payload = payload;
    }

    public boolean isTerminal() {
        return eventType.isTerminal();
    }
}