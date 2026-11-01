package com.github.curiousoddman.curious.chat;

import com.github.curiousoddman.curious.chat.preloader.AnimatedPreloader;
import com.sun.javafx.application.LauncherImpl;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Main {
    static void main(String[] args) {
        LauncherImpl.launchApplication(JavafxApplication.class, AnimatedPreloader.class, args);
    }
}
