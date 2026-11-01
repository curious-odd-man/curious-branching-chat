package com.github.curiousoddman.curious.chat.util.async.jobs;

import com.github.curiousoddman.curious.chat.util.TimeProvider;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class JobFactory {
    private final TimeProvider timeProvider;
}
