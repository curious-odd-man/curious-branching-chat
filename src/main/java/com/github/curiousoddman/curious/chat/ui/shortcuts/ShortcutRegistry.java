package com.github.curiousoddman.curious.chat.ui.shortcuts;

import com.github.curiousoddman.curious.chat.util.TimeProvider;
import jakarta.annotation.PostConstruct;
import javafx.scene.input.KeyEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Service
@RequiredArgsConstructor
public class ShortcutRegistry {

    private static final String UNBOUND_SENTINEL = "NONE";

    private final TimeProvider timeProvider;

    private final Map<ShortcutAction, ShortcutKey> overrides         = new ConcurrentHashMap<>();
    private final Map<ShortcutKey, ShortcutAction> actionsOnShortcut = new HashMap<>();

    @PostConstruct
    public void load() {
        // FIXME:
//        for (var record : repository.findAll()) {
//            ShortcutAction.fromId(record.getActionId())
//                          .ifPresentOrElse(action -> overrides.put(action, parse(record.getKeyCombination())),
//                                  () -> log.warn("Saved shortcut for unknown action id '{}' ignored (stale after a rename/removal?)",
//                                          record.getActionId()));
//        }
        updateActionsMap();
    }

    private void updateActionsMap() {
        actionsOnShortcut.clear();
        for (ShortcutAction action : ShortcutAction.values()) {
            String      name               = action.name();
            ShortcutKey defaultCombination = action.getDefaultCombination();
            ShortcutKey override           = overrides.get(action);
            ShortcutKey actualShortcut = Optional.ofNullable(override)
                                                 .orElse(defaultCombination);
            actionsOnShortcut.put(actualShortcut, action);
        }
    }

    private Optional<ShortcutKey> parse(String stored) {
        if (UNBOUND_SENTINEL.equals(stored)) {
            return Optional.empty();
        }
        try {
            return Optional.of(ShortcutKey.parse(stored));
        } catch (Exception e) {
            log.warn("Could not parse saved key combination '{}', ignoring", stored, e);
            return Optional.empty();
        }
    }

    public ShortcutKey resolve(ShortcutAction action) {
        return overrides.getOrDefault(action, action.getDefaultCombination());
    }

    public Optional<ShortcutAction> resolve(KeyEvent event) {
        return Optional.ofNullable(
                actionsOnShortcut.get(ShortcutKey.from(event))
        );
    }

    public record UpdateResult(Optional<ShortcutAction> bumpedAction) {
    }

    /**
     * Rebinds {@code action} to {@code newCombination}, persisting it. If another action was
     * already using that exact combination, that other action is unbound (see class javadoc) and
     * returned in the result so the caller can warn about it.
     */
    public UpdateResult updateBinding(ShortcutAction action, ShortcutKey newCombination) {
        ShortcutAction bumped = null;
        for (ShortcutAction other : ShortcutAction.values()) {
            if (other != action && resolve(other).equals(newCombination)) {
                bumped = other;
                break;
            }
        }

        var now = timeProvider.now();
        if (bumped != null) {
            //repository.upsert(bumped.name(), UNBOUND_SENTINEL, now);
            overrides.remove(bumped);
        }
        //repository.upsert(action.name(), newCombination.toString(), now);
        overrides.put(action, newCombination);

        updateActionsMap();

        return new UpdateResult(Optional.ofNullable(bumped));
    }

    public void resetToDefault(ShortcutAction action) {
        //repository.delete(action.name());
        overrides.remove(action);
        updateActionsMap();
    }
}
