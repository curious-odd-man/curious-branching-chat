package com.github.curiousoddman.curious.chat.ui.controller.screen;

import com.github.curiousoddman.curious.chat.config.user.prefs.UserPreferencesService;
import com.github.curiousoddman.curious.chat.event.model.BackgroundProcessEvent;
import com.github.curiousoddman.curious.chat.event.payload.BackgroundProcessPayload;
import com.github.curiousoddman.curious.chat.event.types.BackgroundProcessEventType;
import com.github.curiousoddman.curious.chat.ui.FxmlLoader;
import com.github.curiousoddman.curious.chat.ui.controller.services.NotificationsService;
import com.github.curiousoddman.curious.chat.ui.shortcuts.ShortcutRegistry;
import com.github.curiousoddman.curious.chat.ui.util.AlertHelper;
import com.github.curiousoddman.curious.chat.util.async.DelayedAction;
import com.github.curiousoddman.curious.chat.util.async.jobs.JobManager;
import javafx.beans.InvalidationListener;
import javafx.event.ActionEvent;
import javafx.fxml.FXML;
import javafx.fxml.Initializable;
import javafx.scene.Scene;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.Menu;
import javafx.scene.control.ProgressBar;
import javafx.scene.layout.BorderPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.StackPane;
import javafx.stage.Stage;
import lombok.RequiredArgsConstructor;
import lombok.SneakyThrows;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.net.URL;
import java.util.Optional;
import java.util.ResourceBundle;
import java.util.concurrent.TimeUnit;

import static com.sun.javafx.util.Utils.runOnFxThread;
import static javafx.scene.control.ProgressIndicator.INDETERMINATE_PROGRESS;

@Lazy
@Slf4j
@Component
@RequiredArgsConstructor
public class LibraryController implements Initializable {
    private final FxmlLoader             fxmlLoader;
    private final JobManager             jobManager;
    private final NotificationsService   notificationsService;
    private final ShortcutRegistry       shortcutRegistry;
    private final UserPreferencesService userPreferencesService;

    // ── FXML nodes ────────────────────────────────────────────────────────────
    @FXML
    public Menu        recentProjectsMenu;
    @FXML
    public HBox        backgroundProgressContainer;
    @FXML
    public Label       backgroundProcessTitleLabel;
    @FXML
    public Button      backgroundProcessCancelButton;
    @FXML
    public StackPane   backgroundProgressBarContainer;
    @FXML
    public ProgressBar backgroundProgressBar;
    @FXML
    public Label       backgroundProgressLabel;
    @FXML
    public Label       backgroundProgressDescription;
    @FXML
    public Button      notificationsMenu;
    @FXML
    public BorderPane  rootBorderPane;

    private Scene scene;

    @Override
    @SneakyThrows
    public void initialize(URL location, ResourceBundle resources) {
        rootBorderPane.sceneProperty()
                      .addListener((_, _, newScene) -> {
                          if (newScene != null) {
                              scene = newScene;
                          }
                      });

        notificationsService.initialize(notificationsMenu);
    }

    // ── Window / split-pane preferences ──────────────────────────────────────
    public void setUserPrefs(Stage primaryStage) {
        DelayedAction delayedSaveWindowSize = new DelayedAction(500, TimeUnit.MILLISECONDS);
        InvalidationListener invalidationListener = _ ->
                delayedSaveWindowSize.reSchedule(() ->
                        userPreferencesService.saveWindowState(primaryStage));

        primaryStage.widthProperty()
                    .addListener(invalidationListener);
        primaryStage.heightProperty()
                    .addListener(invalidationListener);
        primaryStage.xProperty()
                    .addListener(invalidationListener);
        primaryStage.yProperty()
                    .addListener(invalidationListener);
        primaryStage.maximizedProperty()
                    .addListener(invalidationListener);
    }

    // ── Background process events ─────────────────────────────────────────────

    @EventListener
    public void onBackgroundProcessEvent(BackgroundProcessEvent event) {
        boolean                  terminal = event.isTerminal();
        BackgroundProcessPayload payload  = event.getPayload();

        runOnFxThread(() -> {
            backgroundProcessTitleLabel.setText(payload.getProcessName());
            backgroundProgressContainer.setVisible(!terminal);
            backgroundProgressBar.setProgress(payload.hasProgress()
                    ? payload.getProgressNormalized()
                    : INDETERMINATE_PROGRESS);
            backgroundProgressLabel.setText(payload.hasProgress() ? payload.getProgressText() : "");
            backgroundProgressDescription.setText(payload.getProgressDetails());
        });

        if (event.getEventType() != BackgroundProcessEventType.ENDED) {
        }
    }

    @FXML
    public void onCancelBackgroundJob(ActionEvent ignoredActionEvent) {
        jobManager.interruptCurrentJob();
    }


    @FXML
    public void onSave(ActionEvent ignoredActionEvent) {
        Optional<String> label = AlertHelper.promptText(notificationsMenu, "Save design",
                "Describe this change (saved to the design's history)", "Design changes");
        if (label.isEmpty()) {
            return;
        }
    }

    // ── Open / New (step 12) ─────────────────────────────────────────────────

    @FXML
    public void onOpenDesign(ActionEvent ignoredActionEvent) {
    }

    @FXML
    public void onNewDesign(ActionEvent ignoredActionEvent) {
    }

    @FXML
    public void onShowShortcuts(ActionEvent ignoredActionEvent) {
    }
}
