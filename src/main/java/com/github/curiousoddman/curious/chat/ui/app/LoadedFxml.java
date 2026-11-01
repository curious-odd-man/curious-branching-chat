package com.github.curiousoddman.curious.chat.ui.app;

import javafx.scene.layout.Region;

public record LoadedFxml<T>(Region parent, T controller) {
}
