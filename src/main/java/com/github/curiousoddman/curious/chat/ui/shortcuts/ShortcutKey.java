package com.github.curiousoddman.curious.chat.ui.shortcuts;

import javafx.scene.input.KeyCode;
import javafx.scene.input.KeyEvent;

import java.util.Locale;

public record ShortcutKey(
        KeyCode code,
        boolean shift,
        boolean ctrl,
        boolean alt,
        boolean meta
) {

    public static ShortcutKey of(KeyCode code) {
        return new ShortcutKey(code, false, false, false, false);
    }

    public static ShortcutKey shift(KeyCode code) {
        return new ShortcutKey(code, true, false, false, false);
    }

    public static ShortcutKey ctrl(KeyCode code) {
        return new ShortcutKey(code, false, true, false, false);
    }

    public static ShortcutKey alt(KeyCode code) {
        return new ShortcutKey(code, false, false, true, false);
    }

    public static ShortcutKey meta(KeyCode code) {
        return new ShortcutKey(code, false, false, false, true);
    }

    public static ShortcutKey ctrlShift(KeyCode code) {
        return new ShortcutKey(code, true, true, false, false);
    }

    public static ShortcutKey ctrlAlt(KeyCode code) {
        return new ShortcutKey(code, false, true, true, false);
    }

    public static ShortcutKey ctrlMeta(KeyCode code) {
        return new ShortcutKey(code, false, true, false, true);
    }

    public static ShortcutKey shiftAlt(KeyCode code) {
        return new ShortcutKey(code, true, false, true, false);
    }

    public static ShortcutKey shiftMeta(KeyCode code) {
        return new ShortcutKey(code, true, false, false, true);
    }

    public static ShortcutKey altMeta(KeyCode code) {
        return new ShortcutKey(code, false, false, true, true);
    }

    public static ShortcutKey ctrlShiftAlt(KeyCode code) {
        return new ShortcutKey(code, true, true, true, false);
    }

    public static ShortcutKey ctrlShiftMeta(KeyCode code) {
        return new ShortcutKey(code, true, true, false, true);
    }

    public static ShortcutKey ctrlAltMeta(KeyCode code) {
        return new ShortcutKey(code, false, true, true, true);
    }

    public static ShortcutKey shiftAltMeta(KeyCode code) {
        return new ShortcutKey(code, true, false, true, true);
    }

    public static ShortcutKey ctrlShiftAltMeta(KeyCode code) {
        return new ShortcutKey(code, true, true, true, true);
    }

    public static ShortcutKey from(KeyEvent event) {
        return new ShortcutKey(
                event.getCode(),
                event.isShiftDown(),
                event.isControlDown(),
                event.isAltDown(),
                event.isMetaDown()
        );
    }

    @Override
    public String toString() {
        StringBuilder result = new StringBuilder();

        if (ctrl) {
            result.append("Ctrl+");
        }
        if (alt) {
            result.append("Alt+");
        }
        if (shift) {
            result.append("Shift+");
        }
        if (meta) {
            result.append("Meta+");
        }

        result.append(code.getName());

        return result.toString();
    }

    public static ShortcutKey parse(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Shortcut cannot be empty");
        }

        boolean shift = false;
        boolean ctrl  = false;
        boolean alt   = false;
        boolean meta  = false;

        String[] parts = value.split("\\+");

        if (parts.length == 0) {
            throw new IllegalArgumentException("Invalid shortcut: " + value);
        }

        String keyPart = parts[parts.length - 1].trim();

        for (int i = 0; i < parts.length - 1; i++) {
            switch (parts[i].trim()
                            .toLowerCase(Locale.ROOT)) {
                case "ctrl", "control" -> ctrl = true;
                case "shift" -> shift = true;
                case "alt" -> alt = true;
                case "meta", "cmd", "command" -> meta = true;
                default -> throw new IllegalArgumentException(
                        "Unknown modifier: " + parts[i]
                );
            }
        }

        KeyCode code = parseKeyCode(keyPart);

        return new ShortcutKey(code, shift, ctrl, alt, meta);
    }

    private static KeyCode parseKeyCode(String value) {
        String normalized = value.trim()
                                 .toUpperCase(Locale.ROOT);

        for (KeyCode code : KeyCode.values()) {
            if (code.getName()
                    .equalsIgnoreCase(value)
                    || code.name()
                           .equalsIgnoreCase(normalized)) {
                return code;
            }
        }

        throw new IllegalArgumentException("Unknown key: " + value);
    }
}