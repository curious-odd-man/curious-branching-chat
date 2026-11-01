package com.github.curiousoddman.curious.chat.ui.controller.services;

import com.github.curiousoddman.curious.chat.event.payload.NotificationLevel;
import com.github.curiousoddman.curious.chat.event.payload.UserNotificationPayload;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * The notifications the user has not dismissed yet: add, dismiss, how many, and which severity
 * the notification button should show (the highest of all of them). Kept free of the popup and
 * button so it can be tested on its own.
 */
public final class NotificationInbox {

    private final List<UserNotificationPayload> payloads = new ArrayList<>();

    public void add(UserNotificationPayload payload) {
        payloads.add(payload);
    }

    /**
     * Removes every notification of {@code sourceKey} and adds {@code replacement} (may be empty).
     */
    public void replaceSource(String sourceKey, List<UserNotificationPayload> replacement) {
        payloads.removeIf(payload -> sourceKey.equals(payload.getSourceKey()));
        payloads.addAll(replacement);
    }

    /**
     * Dismisses one notification (by identity/equality, as {@code List#remove} does).
     *
     * @return whether it was present
     */
    public boolean remove(UserNotificationPayload payload) {
        return payloads.remove(payload);
    }

    public boolean isEmpty() {
        return payloads.isEmpty();
    }

    public int size() {
        return payloads.size();
    }

    /**
     * A snapshot, oldest first — safe to iterate while a dismiss callback changes the inbox.
     */
    public List<UserNotificationPayload> payloads() {
        return List.copyOf(payloads);
    }

    /**
     * Highest severity present ({@code ERROR} beats {@code WARNING}); empty when there are none.
     */
    public Optional<NotificationLevel> highestLevel() {
        return payloads.stream()
                       .map(UserNotificationPayload::getNotificationLevel)
                       .max(Comparator.naturalOrder());
    }
}
