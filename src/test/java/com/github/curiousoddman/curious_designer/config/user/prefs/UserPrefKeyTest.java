package com.github.curiousoddman.curious_designer.config.user.prefs;

import com.github.curiousoddman.curious.chat.config.user.prefs.UserPrefKey;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import static org.junit.jupiter.api.Assertions.assertFalse;

class UserPrefKeyTest {

    @EnumSource(UserPrefKey.class)
    @ParameterizedTest
    void userPrefsTest(UserPrefKey key) {
        String k = key.getKey();
        assertFalse(k.contains("="), "Equal sign is key value separator");
        assertFalse(k.contains("\n"), "Newline character is line separator in file");
    }
}