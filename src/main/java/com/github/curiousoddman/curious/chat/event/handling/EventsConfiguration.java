package com.github.curiousoddman.curious.chat.event.handling;


import com.github.curiousoddman.curious.chat.event.model.BackgroundProcessEvent;

import java.util.Set;

public class EventsConfiguration {
    static final Set<Class<?>> IGNORE_LOGGING_CLASSES = Set.of(
            BackgroundProcessEvent.class
    );
    static final Set<Class<?>> SKIP_LOG_NO_LISTENERS  = Set.of(
            // the menu and the history window listen to it, and they are not in every context
    );

    public boolean shouldSkipLog(Object event) {
        Class<?> currentEventClass = event.getClass();
        return IGNORE_LOGGING_CLASSES.contains(currentEventClass);
    }
}
