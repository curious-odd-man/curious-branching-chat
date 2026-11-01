package com.github.curiousoddman.curious.chat.preloader;

import javafx.animation.KeyFrame;
import javafx.animation.Timeline;
import javafx.fxml.FXML;
import javafx.scene.control.Label;
import javafx.scene.control.ProgressBar;
import javafx.scene.layout.VBox;
import javafx.util.Duration;

public class PreloaderController {

    @FXML
    private ProgressBar progressBar;

    @FXML
    private Label percentageLabel;

    @FXML
    private Label operationLabel;

    @FXML
    private Label modelStatus;

    @FXML
    private VBox geometryStep;

    @FXML
    private VBox materialsStep;

    @FXML
    private VBox componentsStep;

    @FXML
    private VBox rendererStep;

    @FXML
    private VBox workspaceStep;

    @FXML
    private Label geometryStatus;

    @FXML
    private Label materialsStatus;

    @FXML
    private Label componentsStatus;

    @FXML
    private Label rendererStatus;

    @FXML
    private Label workspaceStatus;

    @FXML
    private javafx.scene.layout.StackPane modelPane;

    private FurniturePreview furniture;

    @FXML
    public void initialize() {

        furniture = new FurniturePreview(520, 320);

        modelPane.getChildren()
                 .add(furniture);

        startAnimation();
    }

    private void startAnimation() {

        Timeline timeline = new Timeline(

                keyFrame(
                        0,
                        "Starting CAD system",
                        0.0
                ),

                keyFrame(
                        900,
                        "Initializing geometry engine...",
                        0.18
                ),

                keyFrame(
                        1700,
                        "Loading material library...",
                        0.35
                ),

                keyFrame(
                        2500,
                        "Loading furniture components...",
                        0.52
                ),

                keyFrame(
                        3400,
                        "Initializing 3D renderer...",
                        0.70
                ),

                keyFrame(
                        4200,
                        "Loading constraint solver...",
                        0.84
                ),

                keyFrame(
                        5000,
                        "Preparing design workspace...",
                        0.96
                ),

                keyFrame(
                        5600,
                        "READY",
                        1.0
                )
        );

        timeline.play();
    }

    private KeyFrame keyFrame(
            double millis,
            String text,
            double progress) {

        return new KeyFrame(
                Duration.millis(millis),
                event -> update(text, progress)
        );
    }

    private void update(
            String text,
            double progress) {

        operationLabel.setText(text);

        percentageLabel.setText(
                String.format(
                        "%d%%",
                        Math.round(progress * 100)
                )
        );

        progressBar.setProgress(progress);

        furniture.setBuildProgress(progress);

        updateSteps(progress);

        if (progress >= 1) {
            modelStatus.setText("DESIGN ENVIRONMENT READY");
        }
    }

    private void updateSteps(double progress) {

        updateStep(
                geometryStep,
                geometryStatus,
                progress >= 0.18,
                progress >= 0.35
        );

        updateStep(
                materialsStep,
                materialsStatus,
                progress >= 0.35,
                progress >= 0.52
        );

        updateStep(
                componentsStep,
                componentsStatus,
                progress >= 0.52,
                progress >= 0.70
        );

        updateStep(
                rendererStep,
                rendererStatus,
                progress >= 0.70,
                progress >= 0.96
        );

        updateStep(
                workspaceStep,
                workspaceStatus,
                progress >= 0.96,
                progress >= 1
        );
    }

    private void updateStep(
            VBox step,
            Label status,
            boolean active,
            boolean complete) {

        step.getStyleClass()
            .removeAll(
                    "step-active",
                    "step-complete"
            );

        if (complete) {

            step.getStyleClass()
                .add("step-complete");
            status.setText("READY");

        } else if (active) {

            step.getStyleClass()
                .add("step-active");
            status.setText("LOADING");

        } else {

            status.setText("WAITING");
        }
    }
}