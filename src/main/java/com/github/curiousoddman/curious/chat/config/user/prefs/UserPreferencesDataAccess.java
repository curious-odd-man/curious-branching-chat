package com.github.curiousoddman.curious.chat.config.user.prefs;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class UserPreferencesDataAccess {
    private final Map<String, String> valuesCache = new HashMap<>();

    public void setUserPref(UserPrefKey userPrefKey, String s) {
        valuesCache.put(userPrefKey.getKey(), s);
    }

    public String getUserPref(UserPrefKey key, String defaultValue) {
        return valuesCache.getOrDefault(key.getKey(), defaultValue);
    }

    @PostConstruct
    public void postContruct() {
        Path propsFile = file();
        if (Files.exists(propsFile)) {
            try {
                List<String> lines = Files.readAllLines(propsFile);
                for (String line : lines) {
                    String[] split = line.split("=", 2);
                    String   key   = split[0];
                    String   value = split[1];
                    validateAndReportKey(key);
                    String oldValue = valuesCache.put(key, value);
                    if (oldValue != null) {
                        log.warn("Duplicate key `{}` found. Last value `{}` wins", key, value);
                    }
                }
            } catch (IOException e) {
                log.error("Failed reading props file", e);
            }
        }
    }

    private static void validateAndReportKey(String key) {
        if (Arrays.stream(UserPrefKey
                          .values())
                  .map(UserPrefKey::getKey)
                  .noneMatch(k -> k.equals(key))) {
            log.warn("Unknown key found {}", key);
        }
    }

    @PreDestroy
    public void preDestroyBean() {
        log.info("Saving {} values to file... ", valuesCache.size());
        List<String> lines = new ArrayList<>(valuesCache.size());
        valuesCache.forEach((k, v) -> lines.add("%s=%s".formatted(k, v)));
        try {
            Path propsFile = file();
            Files.createDirectories(propsFile.getParent());
            Files.write(propsFile, lines, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
            log.info("Saved...");
        } catch (IOException e) {
            log.error("Failed to save user prefs", e);
        }
    }

    private Path file() {
        //  return appPaths.appHomeDir()
        //      .resolve("prefs.properties");
        return null;
    }
}
