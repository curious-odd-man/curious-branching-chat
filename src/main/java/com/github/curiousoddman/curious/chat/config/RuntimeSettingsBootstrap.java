package com.github.curiousoddman.curious.chat.config;

import lombok.experimental.UtilityClass;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Properties;

@Slf4j
@UtilityClass
public class RuntimeSettingsBootstrap {

    private static Path file() {
        return Path.of(System.getProperty("user.home"), ".cdesigner", "runtime-settings.properties");
    }

    /**
     * Loads whatever overrides have been saved. Returns an empty (never null) {@link Properties}
     * if the file doesn't exist yet or can't be read, so a fresh install just falls back to
     * {@code application.yaml} defaults. Return type is {@link Properties} (rather than a
     * {@code Map<String, String>}) so it can be passed straight to
     * {@code SpringApplicationBuilder#properties(Properties)}.
     */
    public static Properties loadOverrides() {
        Path       path  = file();
        Properties props = new Properties();
        if (!Files.isRegularFile(path)) {
            return props;
        }
        try (var in = Files.newInputStream(path)) {
            props.load(in);
        } catch (IOException e) {
            log.warn("Could not read runtime settings file at {}, using defaults", path, e);
        }
        return props;
    }

    /**
     * Merges {@code updates} into whatever is already saved and writes the file back. Passing a
     * {@code null} value for a key removes that override (falls back to the yaml default again).
     */
    public static void save(Map<String, String> updates) {
        Path path = file();
        try {
            Files.createDirectories(path.getParent());
        } catch (IOException e) {
            log.error("Could not create settings directory {}", path.getParent(), e);
            return;
        }

        Properties props = new Properties();
        if (Files.isRegularFile(path)) {
            try (var in = Files.newInputStream(path)) {
                props.load(in);
            } catch (IOException e) {
                log.warn("Could not read existing runtime settings file at {}, overwriting", path, e);
            }
        }

        updates.forEach((k, v) -> {
            if (v == null) {
                props.remove(k);
            } else {
                props.setProperty(k, v);
            }
        });

        try (var out = Files.newOutputStream(path)) {
            props.store(out, "curiousDesigner runtime settings - restart-required overrides. Edit via Settings screen.");
        } catch (IOException e) {
            log.error("Could not write runtime settings file at {}", path, e);
        }
    }
}
