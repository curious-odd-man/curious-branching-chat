package com.github.curiousoddman.curious.chat.config.user.prefs;

import javafx.stage.Stage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;


@Slf4j
@Service
@RequiredArgsConstructor
public class UserPreferencesService {
    public static final double DEFAULT_WINDOW_X               = 100;
    public static final double DEFAULT_WINDOW_Y               = 100;
    public static final double DEFAULT_WINDOW_WIDTH           = 1920;
    public static final double DEFAULT_WINDOW_HEIGHT          = 1080;
    public static final double DEFAULT_BLUEPRINT_TEXT_SIZE_PX = 12;

    private final UserPreferencesDataAccess userPreferencesDataAccess;

    public void saveWindowState(Stage stage) {
        if (!stage.isMaximized()) {
            userPreferencesDataAccess.setUserPref(UserPrefKey.WINDOW_X, String.valueOf(stage.getX()));
            userPreferencesDataAccess.setUserPref(UserPrefKey.WINDOW_Y, String.valueOf(stage.getY()));
            userPreferencesDataAccess.setUserPref(UserPrefKey.WINDOW_WIDTH, String.valueOf(stage.getWidth()));
            userPreferencesDataAccess.setUserPref(UserPrefKey.WINDOW_HEIGHT, String.valueOf(stage.getHeight()));
        }
        userPreferencesDataAccess.setUserPref(UserPrefKey.WINDOW_MAXIMIZED, String.valueOf(stage.isMaximized()));
        log.info("Window state saved (maximized={})", stage.isMaximized());
    }

    public void restoreWindowState(Stage stage) {
        stage.setX(getDouble(UserPrefKey.WINDOW_X, DEFAULT_WINDOW_X));
        stage.setY(getDouble(UserPrefKey.WINDOW_Y, DEFAULT_WINDOW_Y));
        stage.setWidth(getDouble(UserPrefKey.WINDOW_WIDTH, DEFAULT_WINDOW_WIDTH));
        stage.setHeight(getDouble(UserPrefKey.WINDOW_HEIGHT, DEFAULT_WINDOW_HEIGHT));
        stage.setMaximized(getBoolean(UserPrefKey.WINDOW_MAXIMIZED, false));
        log.info("Window state restored");
    }

    private double getDouble(UserPrefKey key, double defaultValue) {
        String raw = userPreferencesDataAccess.getUserPref(key, null);
        if (raw == null) {
            return defaultValue;
        }
        try {
            return Double.parseDouble(raw);
        } catch (NumberFormatException e) {
            log.warn("Corrupt pref [{}]='{}', using default {}", key.getKey(), raw, defaultValue);
            return defaultValue;
        }
    }

    private int getInt(UserPrefKey key, int defaultValue) {
        return (int) Math.round(getDouble(key, defaultValue));
    }

    private boolean getBoolean(UserPrefKey key, boolean defaultValue) {
        String raw = userPreferencesDataAccess.getUserPref(key, null);
        if (raw == null) {
            return defaultValue;
        }
        return Boolean.parseBoolean(raw);
    }
}
