package com.github.curiousoddman.curious_designer.ui.controller.services;

import com.github.curiousoddman.curious.chat.event.payload.NotificationLevel;
import com.github.curiousoddman.curious.chat.event.payload.UserNotificationPayload;
import com.github.curiousoddman.curious.chat.ui.controller.services.NotificationInbox;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class NotificationInboxTest {

    private record SourcedPayload(String source, String title) implements UserNotificationPayload {
        @Override
        public String getTitle() {
            return title;
        }

        @Override
        public List<String> getDescription() {
            return List.of();
        }

        @Override
        public NotificationLevel getNotificationLevel() {
            return NotificationLevel.ERROR;
        }

        @Override
        public String getSourceKey() {
            return source;
        }
    }

    private record Payload(String title, NotificationLevel level) implements UserNotificationPayload {
        @Override
        public String getTitle() {
            return title;
        }

        @Override
        public List<String> getDescription() {
            return List.of();
        }

        @Override
        public NotificationLevel getNotificationLevel() {
            return level;
        }
    }

    private NotificationInbox inbox;

    @BeforeEach
    void setUp() {
        inbox = new NotificationInbox();
    }

    @Test
    void startsEmptyWithNoLevel() {
        assertThat(inbox.isEmpty()).isTrue();
        assertThat(inbox.size()).isEqualTo(0);
        assertThat(inbox.highestLevel()).isEmpty();
    }

    @Test
    void countsWhatWasAdded() {
        inbox.add(new Payload("a", NotificationLevel.WARNING));
        inbox.add(new Payload("b", NotificationLevel.WARNING));

        assertThat(inbox.size()).isEqualTo(2);
        assertThat(inbox.isEmpty()).isFalse();
    }

    @Test
    void anErrorOutranksAnyNumberOfWarnings() {
        inbox.add(new Payload("w1", NotificationLevel.WARNING));
        inbox.add(new Payload("e", NotificationLevel.ERROR));
        inbox.add(new Payload("w2", NotificationLevel.WARNING));

        assertThat(inbox.highestLevel()).contains(NotificationLevel.ERROR);
    }

    @Test
    void onlyWarningsShowAsAWarning() {
        inbox.add(new Payload("w", NotificationLevel.WARNING));

        assertThat(inbox.highestLevel()).contains(NotificationLevel.WARNING);
    }

    @Test
    void dismissingTheOnlyErrorLowersTheSeverity() {
        Payload error = new Payload("e", NotificationLevel.ERROR);
        inbox.add(new Payload("w", NotificationLevel.WARNING));
        inbox.add(error);

        boolean removed = inbox.remove(error);

        assertThat(removed).isTrue();
        assertThat(inbox.highestLevel()).contains(NotificationLevel.WARNING);
    }

    @Test
    void dismissingTheLastOneEmptiesTheInbox() {
        Payload only = new Payload("w", NotificationLevel.WARNING);
        inbox.add(only);

        inbox.remove(only);

        assertThat(inbox.isEmpty()).isTrue();
        assertThat(inbox.highestLevel()).isEmpty();
    }

    @Test
    void dismissingSomethingNotThereChangesNothing() {
        inbox.add(new Payload("w", NotificationLevel.WARNING));

        assertThat(inbox.remove(new Payload("other", NotificationLevel.ERROR))).isFalse();
        assertThat(inbox.size()).isEqualTo(1);
    }

    @Test
    void theSnapshotKeepsOrderAndIsUnaffectedByLaterChanges() {
        Payload first  = new Payload("first", NotificationLevel.WARNING);
        Payload second = new Payload("second", NotificationLevel.ERROR);
        inbox.add(first);
        inbox.add(second);

        List<UserNotificationPayload> snapshot = inbox.payloads();
        inbox.remove(first);

        assertThat(snapshot).containsExactly(first, second);
        assertThat(inbox.payloads()).containsExactly(second);
    }

    @Test
    void replaceSourceRemovesOldNotificationsOfThatSourceOnly() {
        UserNotificationPayload other = new Payload("other", NotificationLevel.WARNING);
        inbox.add(other);
        inbox.add(new SourcedPayload("validation", "old"));

        inbox.replaceSource("validation", List.of(new SourcedPayload("validation", "new")));

        assertThat(inbox.payloads()).hasSize(2)
                                    .extracting(UserNotificationPayload::getTitle)
                                    .containsExactly("other", "new");
    }

    @Test
    void replaceSourceWithAnEmptyListClearsTheSource() {
        inbox.add(new SourcedPayload("validation", "old"));

        inbox.replaceSource("validation", List.of());

        assertThat(inbox.isEmpty()).isTrue();
    }
}
