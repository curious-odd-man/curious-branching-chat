package com.github.curiousoddman.curious.chat.preloader;

import javafx.application.Preloader;
import javafx.fxml.FXMLLoader;
import javafx.scene.Parent;
import javafx.scene.Scene;
import javafx.scene.image.Image;
import javafx.stage.Stage;

import static java.util.Objects.requireNonNull;

public class AnimatedPreloader extends Preloader {
    private Stage stage;

    @Override
    public void start(Stage primaryStage) throws Exception {
        this.stage = primaryStage;
        stage.getIcons()
             .addAll(
                     new Image(requireNonNull(getClass().getResourceAsStream("/icons/app-icon-16.png"))),
                     new Image(requireNonNull(getClass().getResourceAsStream("/icons/app-icon-32.png"))),
                     new Image(requireNonNull(getClass().getResourceAsStream("/icons/app-icon-64.png"))),
                     new Image(requireNonNull(getClass().getResourceAsStream("/icons/app-icon-128.png")))
             );

        Parent root = FXMLLoader.load(
                requireNonNull(getClass().getResource("/fxml/preloader.fxml"))
        );
        root.getStylesheets()
            .setAll("/styles/preloader.css");

        Scene scene = new Scene(root);
        primaryStage.setScene(scene);
        primaryStage.show();
    }

    @Override
    public void handleApplicationNotification(PreloaderNotification info) {
        if (info instanceof MainSceneVisible) {
            stage.hide();
        }
    }
}