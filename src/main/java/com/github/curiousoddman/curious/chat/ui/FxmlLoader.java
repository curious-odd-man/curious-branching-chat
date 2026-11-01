package com.github.curiousoddman.curious.chat.ui;

import com.github.curiousoddman.curious.chat.ui.app.LoadedFxml;
import javafx.fxml.FXMLLoader;
import javafx.scene.Parent;
import javafx.scene.layout.AnchorPane;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;
import lombok.RequiredArgsConstructor;
import lombok.SneakyThrows;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.util.ResourceBundle;

@Slf4j
@Component
@RequiredArgsConstructor
public class FxmlLoader {
    private final ApplicationContext context;

    @SneakyThrows
    public <T> LoadedFxml<T> load(FxmlView<T> fxmlPath, ResourceBundle resourceBundle) {
        FXMLLoader loader = new FXMLLoader();
        loader.setControllerFactory(context::getBean);
        InputStream fxmlStream = getClass().getResourceAsStream(fxmlPath.fxmlPath());
        if (fxmlStream == null) {
            throw new IllegalStateException("Cannot find FXML: " + fxmlPath.fxmlPath());
        }
        loader.setResources(resourceBundle);
        loader.setClassLoader(context.getClassLoader());
        Region parent = loader.load(fxmlStream);
        parent.getStylesheets()
              .setAll("/styles/default.css");
        return new LoadedFxml<>(
                parent,
                loader.getController()
        );
    }

    public <T> LoadedFxml<T> loadFxmlAndAttachToParent(Pane parent, FxmlView<T> view) {
        return loadFxmlAndAttachToParent(parent, view, null);
    }

    public <T> LoadedFxml<T> loadFxmlAndAttachToParent(Pane parent, FxmlView<T> view, ResourceBundle resourceBundle) {
        LoadedFxml<T> loaded   = load(view, resourceBundle);
        Parent        viewPane = loaded.parent();
        AnchorPane.setTopAnchor(viewPane, 0.0);
        AnchorPane.setBottomAnchor(viewPane, 0.0);
        AnchorPane.setLeftAnchor(viewPane, 0.0);
        AnchorPane.setRightAnchor(viewPane, 0.0);
        parent.getChildren()
              .setAll(viewPane);
        return loaded;
    }
}
